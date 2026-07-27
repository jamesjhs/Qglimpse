import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-auth-phase2-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse-auth-phase2.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.QUICKGLIMPSE_SESSION_IDLE_TTL_MS = '1000'
process.env.TURNSTILE_SITE_KEY = ''
process.env.TURNSTILE_SECRET_KEY = ''
process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD = 'ChangeMeRoot123!'
process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD = 'ChangeMeInstitution123!'

const { createApp } = await import('../dist/index.js')
const { getDb } = await import('../dist/db.js')
const auth = await import('../dist/auth.js')

const db = getDb()
auth.registerUser({
  email: 'kiosk-phase2@example.com',
  password: 'Password1234!',
  role: 'institution_kiosk',
  institutionId: 1,
})
auth.registerUser({
  email: 'twofa-phase2@example.com',
  password: 'Password1234!',
  role: 'institution_user',
  institutionId: 1,
})
auth.toggle2FA(4, true, { id: 1, email: 'root@quickglimpse.local', role: 'root', status: 'active', institutionId: null })

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
  const result = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(result.response.status, 200)
  return result.body
}

test('2FA login response contains no preview OTP while storing a challenge', async () => {
  const result = await login('twofa-phase2@example.com', 'Password1234!')

  assert.equal(result.challengePending, true)
  assert.equal('preview' in result, false)
  assert.equal('delivery' in result, false)

  const active = db
    .prepare(
      `SELECT COUNT(*) AS count FROM login_challenges
       WHERE email = ? AND method = 'email_code' AND consumed_at IS NULL`,
    )
    .get('twofa-phase2@example.com')
  assert.equal(active.count, 1)
})

test('role-aware login routes kiosk users to kiosk and blocks staff APIs', async () => {
  const session = await login('kiosk-phase2@example.com', 'Password1234!')
  assert.equal(session.user.role, 'institution_kiosk')
  assert.equal(session.redirectPath, '/kiosk')

  const staffApi = await api('/api/institutions/1/questions', {
    headers: { Authorization: `Bearer ${session.token}` },
  })
  assert.equal(staffApi.response.status, 403)

  const profileEdit = await api('/api/auth/profile', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: 'kiosk-edited@example.com' }),
  })
  assert.equal(profileEdit.response.status, 403)

  const passwordEdit = await api('/api/auth/profile/password', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ currentPassword: 'Password1234!', newPassword: 'Password5678!' }),
  })
  assert.equal(passwordEdit.response.status, 403)

  const twoFaEdit = await api(`/api/auth/users/${session.user.id}/2fa`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(twoFaEdit.response.status, 403)

  const kioskSession = await api('/api/kiosk/downtown-clinic/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
  })
  assert.equal(kioskSession.response.status, 201)
})

test('new login rotates old sessions and logout revokes the current session', async () => {
  const first = await login('root@quickglimpse.local', 'ChangeMeRoot123!')
  const second = await login('root@quickglimpse.local', 'ChangeMeRoot123!')

  const firstCheck = await api('/api/auth/session', {
    headers: { Authorization: `Bearer ${first.token}` },
  })
  assert.equal(firstCheck.response.status, 401)

  const secondCheck = await api('/api/auth/session', {
    headers: { Authorization: `Bearer ${second.token}` },
  })
  assert.equal(secondCheck.response.status, 200)

  const logout = await api('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${second.token}` },
  })
  assert.equal(logout.response.status, 204)

  const revokedCheck = await api('/api/auth/session', {
    headers: { Authorization: `Bearer ${second.token}` },
  })
  assert.equal(revokedCheck.response.status, 401)
})

test('idle sessions expire and failed login attempts are audited', async () => {
  const session = await login('institution-admin@quickglimpse.local', 'ChangeMeInstitution123!')
  db.prepare("UPDATE auth_sessions SET last_seen_at = datetime('now', '-10 minutes') WHERE user_id = ?").run(session.user.id)

  const expired = await api('/api/auth/session', {
    headers: { Authorization: `Bearer ${session.token}` },
  })
  assert.equal(expired.response.status, 401)

  const failed = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'institution-admin@quickglimpse.local',
      password: 'wrong-password',
    }),
  })
  assert.equal(failed.response.status, 401)

  const audit = db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'login_failed'").get()
  assert.ok(audit.count >= 1)
})

test('OTP verification consumes the challenge and creates a session', () => {
  const otpCode = '123456'
  db.prepare("UPDATE login_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE email = ? AND method = 'email_code'").run(
    'twofa-phase2@example.com',
  )
  db.prepare(
    `INSERT INTO login_challenges (email, method, otp_code_hash, expires_at)
     VALUES (?, 'email_code', ?, datetime('now', '+10 minutes'))`,
  ).run('twofa-phase2@example.com', createHash('sha256').update(otpCode).digest('hex'))

  const session = auth.verifyOtpChallenge('twofa-phase2@example.com', otpCode)
  assert.equal(session.user.email, 'twofa-phase2@example.com')
  assert.equal(typeof session.token, 'string')
})
