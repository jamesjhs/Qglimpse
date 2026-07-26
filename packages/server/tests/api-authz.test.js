import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-api-authz-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse-authz.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.TURNSTILE_SITE_KEY = ''
process.env.TURNSTILE_SECRET_KEY = ''
process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD = 'ChangeMeRoot123!'
process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD = 'ChangeMeInstitution123!'

const { createApp } = await import('../dist/index.js')
const { getDb } = await import('../dist/db.js')
const auth = await import('../dist/auth.js')

const db = getDb()
const secondInstitutionInsert = db
  .prepare('INSERT INTO institutions (name, slug, timezone, kiosk_mode_enabled) VALUES (?, ?, ?, ?)')
  .run('Westside Clinic', 'westside-clinic', 'America/Los_Angeles', 0)
const secondInstitutionId = Number(secondInstitutionInsert.lastInsertRowid)

auth.registerUser({
  email: 'west-admin@example.com',
  password: 'Password1234!',
  role: 'institution_admin',
  institutionId: secondInstitutionId,
})
auth.registerUser({
  email: 'west-user@example.com',
  password: 'Password1234!',
  role: 'institution_user',
  institutionId: secondInstitutionId,
})
auth.registerUser({
  email: 'locked-user@example.com',
  password: 'TemporaryPassword123!',
  role: 'institution_user',
  institutionId: secondInstitutionId,
  mustChangePassword: true,
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
  const { response, body } = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      turnstileToken: 'dev-turnstile-pass',
    }),
  })
  assert.equal(response.status, 200)
  return body.token
}

test('root overview requires authentication', async () => {
  const { response } = await api('/api/root/overview')
  assert.equal(response.status, 401)
})

test('root can access root overview and SMTP settings', async () => {
  const rootToken = await login('root@quickglimpse.local', 'ChangeMeRoot123!')

  const rootOverview = await api('/api/root/overview', {
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(rootOverview.response.status, 200)
  assert.equal(rootOverview.body.trendlinesEnabled, false)

  const smtp = await api('/api/settings/smtp', {
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(smtp.response.status, 200)
  assert.equal(typeof smtp.body.secureLoginType, 'string')
})

test('password change validation returns a friendly warning', async () => {
  const rootToken = await login('root@quickglimpse.local', 'ChangeMeRoot123!')

  const result = await api('/api/auth/profile/password', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ currentPassword: 'ChangeMeRoot123!', newPassword: 'short' }),
  })

  assert.equal(result.response.status, 400)
  assert.equal(
    result.body.error,
    'Please enter a new password that is at least 10 characters long.',
  )
})

test('required password change accepts a new password after login', async () => {
  const lockedLogin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'locked-user@example.com',
      password: 'TemporaryPassword123!',
      turnstileToken: 'dev-turnstile-pass',
    }),
  })
  assert.equal(lockedLogin.response.status, 200)
  assert.equal(lockedLogin.body.mustChangePassword, true)

  const changed = await api('/api/auth/profile/password', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${lockedLogin.body.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ newPassword: 'PermanentPassword123!' }),
  })
  assert.equal(changed.response.status, 200)

  const session = auth.loginUser({
    email: 'locked-user@example.com',
    password: 'PermanentPassword123!',
  })
  assert.equal(session.mustChangePassword, false)
})

test('institution admin cannot access root-only routes', async () => {
  const adminToken = await login('institution-admin@quickglimpse.local', 'ChangeMeInstitution123!')

  const rootOverview = await api('/api/root/overview', {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert.equal(rootOverview.response.status, 403)

  const smtp = await api('/api/settings/smtp', {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert.equal(smtp.response.status, 403)
})

test('institution admin can only toggle kiosk mode for own institution', async () => {
  const westAdminToken = await login('west-admin@example.com', 'Password1234!')

  const forbiddenToggle = await api('/api/institutions/1/kiosk-mode', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(forbiddenToggle.response.status, 403)

  const allowedToggle = await api(`/api/institutions/${secondInstitutionId}/kiosk-mode`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(allowedToggle.response.status, 200)
  assert.equal(allowedToggle.body.id, secondInstitutionId)
  assert.equal(allowedToggle.body.kioskModeEnabled, 1)
})

test('institution user can view analytics for own institution only', async () => {
  const westUserToken = await login('west-user@example.com', 'Password1234!')

  const allowedAnalytics = await api(`/api/institutions/${secondInstitutionId}/analytics`, {
    headers: { Authorization: `Bearer ${westUserToken}` },
  })
  assert.equal(allowedAnalytics.response.status, 200)

  const forbiddenAnalytics = await api('/api/institutions/1/analytics', {
    headers: { Authorization: `Bearer ${westUserToken}` },
  })
  assert.equal(forbiddenAnalytics.response.status, 403)
})
