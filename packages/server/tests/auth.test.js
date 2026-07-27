import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-auth-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse-auth.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.TURNSTILE_SITE_KEY = ''
process.env.TURNSTILE_SECRET_KEY = ''
process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD = 'ChangeMeRoot123!'
process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD = 'ChangeMeInstitution123!'

const auth = await import('../dist/auth.js')
const { getDb } = await import('../dist/db.js')
auth.ensureSeedCredentials()
const db = getDb()

test('turnstile verification is disabled in local mode without a secret', async () => {
  const verified = await auth.verifyTurnstileToken('')
  assert.equal(verified.success, true)
})

test('registers and logs in a new institution user', () => {
  const user = auth.registerUser({
    email: 'new-user@example.com',
    password: 'Password1234!',
    role: 'institution_user',
    institutionId: 1,
  })
  assert.equal(user.email, 'new-user@example.com')

  const session = auth.loginUser({
    email: 'new-user@example.com',
    password: 'Password1234!',
  })

  assert.equal(typeof session.token, 'string')
  const authCheck = auth.authenticateSession(session.token)
  assert.equal(authCheck?.user.email, 'new-user@example.com')
})

test('logout revokes active session', () => {
  const session = auth.loginUser({
    email: 'root@quickglimpse.local',
    password: 'ChangeMeRoot123!',
  })

  assert.ok(auth.authenticateSession(session.token))
  auth.logoutSession(session.token)
  assert.equal(auth.authenticateSession(session.token), null)
})

test('authenticated use extends the session expiry window', () => {
  const user = auth.registerUser({
    email: 'sliding-session-user@example.com',
    password: 'Password1234!',
    role: 'institution_user',
    institutionId: 1,
  })
  const session = auth.loginUser({
    email: 'sliding-session-user@example.com',
    password: 'Password1234!',
  })
  const oldExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?').run(oldExpiry, user.id)

  const refreshed = auth.authenticateSession(session.token)
  const row = db
    .prepare('SELECT expires_at AS expiresAt FROM auth_sessions WHERE user_id = ?')
    .get(user.id)

  assert.ok(refreshed)
  assert.ok(new Date(refreshed.expiresAt).getTime() > new Date(oldExpiry).getTime())
  assert.equal(row.expiresAt, refreshed.expiresAt)
})

test('suspending user revokes sessions and blocks new login', () => {
  const user = auth.registerUser({
    email: 'lifecycle-user@example.com',
    password: 'Password1234!',
    role: 'institution_user',
    institutionId: 1,
  })

  const session = auth.loginUser({
    email: 'lifecycle-user@example.com',
    password: 'Password1234!',
  })
  assert.ok(auth.authenticateSession(session.token))

  auth.updateUserStatus(user.id, 'suspended')
  assert.equal(auth.authenticateSession(session.token), null)

  assert.throws(
    () =>
      auth.loginUser({
        email: 'lifecycle-user@example.com',
        password: 'Password1234!',
      }),
    /Account is suspended/,
  )
})

test('initial admin login command helper updates root credentials', () => {
  const admin = auth.ensureInitialAdminLogin({
    email: 'platform-admin@example.com',
    password: 'EvenBetterPassword123!',
  })
  assert.equal(admin.role, 'root')
  assert.equal(admin.email, 'platform-admin@example.com')

  assert.throws(
    () =>
      auth.loginUser({
        email: 'root@quickglimpse.local',
        password: 'ChangeMeRoot123!',
      }),
    /Invalid email or password/,
  )

  const session = auth.loginUser({
    email: 'platform-admin@example.com',
    password: 'EvenBetterPassword123!',
  })
  assert.equal(session.user.role, 'root')
  assert.equal(session.mustChangePassword, true)
})
