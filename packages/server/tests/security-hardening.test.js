import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-security-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse-security.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.TURNSTILE_SITE_KEY = ''
process.env.TURNSTILE_SECRET_KEY = ''
process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD = 'ChangeMeRoot123!'
process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD = 'ChangeMeInstitution123!'

const { createApp, redactForLog } = await import('../dist/index.js')
const services = await import('../dist/services.js')
const { getDb } = await import('../dist/db.js')
const auth = await import('../dist/auth.js')

const db = getDb()
const westInstitutionInsert = db
  .prepare('INSERT INTO institutions (name, slug, timezone, kiosk_mode_enabled) VALUES (?, ?, ?, ?)')
  .run('West Security Clinic', 'west-security-clinic', 'America/Los_Angeles', 1)
const westInstitutionId = Number(westInstitutionInsert.lastInsertRowid)
auth.registerUser({
  email: 'kiosk-security@example.com',
  password: 'Password1234!',
  role: 'institution_kiosk',
  institutionId: 1,
})
auth.registerUser({
  email: 'west-security-admin@example.com',
  password: 'Password1234!',
  role: 'institution_admin',
  institutionId: westInstitutionId,
})
const app = createApp()
const server = app.listen(0)
await new Promise((resolve) => {
  server.once('listening', resolve)
})
const port = Number(server.address().port)
const baseUrl = `http://127.0.0.1:${port}`

test.after(() => {
  server.close()
})

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  let body = {}
  if (response.status !== 204) {
    body = await response.json()
  }
  return { response, body }
}

async function login(email, password) {
  const loginResult = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(loginResult.response.status, 200)
  return loginResult.body.token
}

async function startKioskSession() {
  const token = await login('kiosk-security@example.com', 'Password1234!')
  const created = await api('/api/kiosk/downtown-clinic/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(created.response.status, 201)
  return created.body.sessionToken
}

test('security headers and request IDs are sent on health and API responses', async () => {
  const health = await api('/readyz', { headers: { 'X-Request-ID': 'phase8-request-123' } })
  assert.equal(health.response.status, 200)
  assert.equal(health.response.headers.get('x-request-id'), 'phase8-request-123')
  assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(health.response.headers.get('x-frame-options'), 'DENY')
  assert.equal(health.response.headers.get('x-permitted-cross-domain-policies'), 'none')
  assert.equal(health.response.headers.get('origin-agent-cluster'), '?1')
  assert.match(health.response.headers.get('content-security-policy') ?? '', /challenges\.cloudflare\.com/)

  const apiResponse = await api('/api/bootstrap')
  assert.equal(apiResponse.response.headers.get('cache-control'), 'no-store')
  assert.equal(apiResponse.response.headers.get('x-robots-tag'), 'noindex')
  assert.match(apiResponse.response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/)
})

test('structured logging redacts secrets without hiding status codes', () => {
  const redacted = redactForLog({
    statusCode: 401,
    password: 'secret-password',
    authorization: 'Bearer secret-token',
    nested: {
      sessionToken: 'secret-session',
      smtpPassword: 'secret-smtp',
      answerJson: '{"freeText":"sensitive"}',
    },
  })

  assert.deepEqual(redacted, {
    statusCode: 401,
    password: '[REDACTED]',
    authorization: '[REDACTED]',
    nested: {
      sessionToken: '[REDACTED]',
      smtpPassword: '[REDACTED]',
      answerJson: '[REDACTED]',
    },
  })
})

test('failed auth audit records have stable audit IDs', async () => {
  const failed = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'missing-security@example.com', password: 'nope' }),
  })
  assert.equal(failed.response.status, 401)

  const row = db
    .prepare("SELECT audit_id AS auditId FROM audit_events WHERE action = 'login_failed' ORDER BY id DESC LIMIT 1")
    .get()
  assert.match(row.auditId, /^[0-9a-f-]{36}$/)
})

test('auth challenge endpoint returns generic acceptance payload', async () => {
  const { response, body } = await api('/api/auth/challenges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'root@quickglimpse.local', method: 'magic_link' }),
  })
  assert.equal(response.status, 202)
  assert.deepEqual(body, { accepted: true })
})

test('password reset request response is consistent for existing and missing accounts', async () => {
  const existing = await api('/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'root@quickglimpse.local' }),
  })
  const missing = await api('/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'missing-user@example.com' }),
  })

  assert.equal(existing.response.status, 202)
  assert.equal(missing.response.status, 202)
  assert.deepEqual(existing.body, { accepted: true })
  assert.deepEqual(missing.body, { accepted: true })
})

test('institution interest endpoint is accepted when local Turnstile verification is disabled', async () => {
  const payload = {
    institutionName: 'Example College',
    contactName: 'Alex Contact',
    email: 'alex@example.edu',
    notes: 'Interested in visitor insight for reception areas.',
  }

  const missingToken = await api('/api/institution-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, turnstileToken: '' }),
  })
  assert.equal(missingToken.response.status, 202)

  const accepted = await api('/api/institution-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  assert.equal(accepted.response.status, 202)
  assert.deepEqual(accepted.body, { accepted: true })
})

test('staff bearer tokens cannot be misused to start kiosk sessions', async () => {
  const adminToken = await login('west-security-admin@example.com', 'Password1234!')
  const created = await api('/api/kiosk/west-security-clinic/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert.equal(created.response.status, 403)
  assert.equal(created.body.error, 'Kiosk account required.')
})

test('kiosk completion stores sanitized demographic data for prototype-pollution payloads', async () => {
  const sessionToken = await startKioskSession()
  const complete = await api('/api/kiosk/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: `{"sessionToken":"${sessionToken}","demographicData":{"__proto__":"polluted","age_group":"18_24"}}`,
  })
  assert.equal(complete.response.status, 200)

  const row = db
    .prepare('SELECT demographic_data AS demographicData FROM kiosk_sessions WHERE session_token = ?')
    .get(sessionToken)
  assert.ok(row?.demographicData)
  const demographicData = JSON.parse(row.demographicData)
  assert.equal(demographicData.age_group, '18_24')
  assert.equal(Object.prototype.hasOwnProperty.call(demographicData, '__proto__'), false)
})

test('kiosk answer writes are idempotent per session and question', async () => {
  const sessionToken = await startKioskSession()
  const session = db
    .prepare('SELECT id FROM kiosk_sessions WHERE session_token = ?')
    .get(sessionToken)
  assert.ok(session?.id)

  const first = await api('/api/kiosk/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken, questionKey: 'dup-check', answer: { value: 'first' } }),
  })
  const second = await api('/api/kiosk/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken, questionKey: 'dup-check', answer: { value: 'second' } }),
  })
  assert.equal(first.response.status, 200)
  assert.equal(second.response.status, 200)

  const rows = db
    .prepare('SELECT answer_json AS answerJson FROM responses WHERE kiosk_session_id = ? AND question_key = ?')
    .all(session.id, 'dup-check')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].answerJson, JSON.stringify({ value: 'second' }))
})

test('creating a challenge invalidates prior active challenge of same method', async () => {
  await services.createLoginChallenge('user@example.com', 'email_code')
  await services.createLoginChallenge('user@example.com', 'email_code')

  const active = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM login_challenges
       WHERE email = ? AND method = ? AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')`,
    )
    .get('user@example.com', 'email_code')
  assert.equal(active.count, 1)
})

test('QR API routes fail closed until single-use QR submission is implemented', async () => {
  const qrAttempt = await api('/api/guest/qr/reused-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'attempted replay' }),
  })

  assert.equal(qrAttempt.response.status, 404)
  assert.deepEqual(qrAttempt.body, { error: 'API route not found.' })
})

test('export route enforces institution scope before returning not implemented', async () => {
  const westAdminToken = await login('west-security-admin@example.com', 'Password1234!')

  const crossInstitution = await api('/api/institutions/1/export', {
    headers: { Authorization: `Bearer ${westAdminToken}` },
  })
  assert.equal(crossInstitution.response.status, 403)

  const ownInstitution = await api(`/api/institutions/${westInstitutionId}/export`, {
    headers: { Authorization: `Bearer ${westAdminToken}` },
  })
  assert.equal(ownInstitution.response.status, 501)
  assert.equal(ownInstitution.body.error, 'Exports are not implemented for this release.')
})

test('retention cleanup removes raw feedback, sessions, and expired challenges', () => {
  const oldSession = db
    .prepare(
      `INSERT INTO kiosk_sessions (institution_id, session_token, started_at)
       VALUES (?, ?, datetime('now', '-91 days'))`,
    )
    .run(1, 'old-retention-session')
  db.prepare(
    `INSERT INTO responses (institution_id, question_key, answer_json, kiosk_session_id, created_at)
     VALUES (?, ?, ?, ?, datetime('now', '-91 days'))`,
  ).run(1, 'retention-check', JSON.stringify({ value: 'expired' }), Number(oldSession.lastInsertRowid))
  db.prepare(
    `INSERT INTO login_challenges (email, method, otp_code_hash, expires_at, created_at)
     VALUES (?, ?, ?, datetime('now', '-1 day'), datetime('now', '-2 days'))`,
  ).run('expired-challenge@example.com', 'email_code', 'hash')

  const result = services.runRetentionCleanup()

  assert.ok(result.responses >= 1)
  assert.ok(result.kioskSessions >= 1)
  assert.ok(result.loginChallenges >= 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM responses WHERE question_key = 'retention-check'").get().count, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM kiosk_sessions WHERE session_token = 'old-retention-session'").get().count, 0)
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM login_challenges WHERE email = 'expired-challenge@example.com'").get().count,
    0,
  )
})
