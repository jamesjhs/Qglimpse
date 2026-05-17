import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-auth-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse-auth.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.TURNSTILE_SECRET_KEY = ''
process.env.TURNSTILE_DEV_BYPASS_TOKEN = 'dev-turnstile-pass'

const auth = await import('../dist/auth.js')
auth.ensureSeedCredentials()

test('turnstile dev bypass token is accepted in local mode', async () => {
  const verified = await auth.verifyTurnstileToken('dev-turnstile-pass')
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
