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

const { createApp } = await import('../dist/index.js')
const services = await import('../dist/services.js')
const { getDb } = await import('../dist/db.js')

const db = getDb()
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

async function startKioskSession() {
  const created = await api('/api/kiosk/downtown-clinic/session', { method: 'POST' })
  assert.equal(created.response.status, 201)
  return created.body.sessionToken
}

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

test('institution interest endpoint requires a valid turnstile token', async () => {
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
  assert.equal(missingToken.response.status, 400)

  const accepted = await api('/api/institution-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, turnstileToken: 'dev-turnstile-pass' }),
  })
  assert.equal(accepted.response.status, 202)
  assert.deepEqual(accepted.body, { accepted: true })
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

test('creating a challenge invalidates prior active challenge of same method', () => {
  services.createLoginChallenge('user@example.com', 'email_code')
  services.createLoginChallenge('user@example.com', 'email_code')

  const active = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM login_challenges
       WHERE email = ? AND method = ? AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')`,
    )
    .get('user@example.com', 'email_code')
  assert.equal(active.count, 1)
})
