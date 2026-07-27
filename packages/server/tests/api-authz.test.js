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

test('create institution user validation explains temporary password requirements', async () => {
  const rootToken = await login('root@quickglimpse.local', 'ChangeMeRoot123!')

  const result = await api(`/api/institutions/${secondInstitutionId}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'short-password-user@example.com',
      password: 'short',
      role: 'institution_user',
    }),
  })

  assert.equal(result.response.status, 400)
  assert.equal(
    result.body.error,
    'Please enter a temporary password that is at least 10 characters long.',
  )
})

test('required password change accepts a new password after login', async () => {
  const lockedLogin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'locked-user@example.com',
      password: 'TemporaryPassword123!',
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

test('institution admin can inspect and update only own institution settings', async () => {
  const westAdminToken = await login('west-admin@example.com', 'Password1234!')

  const forbiddenRead = await api('/api/institutions/1', {
    headers: { Authorization: `Bearer ${westAdminToken}` },
  })
  assert.equal(forbiddenRead.response.status, 403)

  const allowedRead = await api(`/api/institutions/${secondInstitutionId}`, {
    headers: { Authorization: `Bearer ${westAdminToken}` },
  })
  assert.equal(allowedRead.response.status, 200)
  assert.equal(allowedRead.body.id, secondInstitutionId)

  const updated = await api(`/api/institutions/${secondInstitutionId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Westside Clinic',
      slug: 'westside-clinic',
      timezone: 'Europe/London',
      colorScheme: 'emerald',
      singleQuestionModeEnabled: true,
      qrModeEnabled: true,
      retentionDays: 45,
      kioskIdleResetSeconds: 30,
      kioskCompletionMessage: 'Thanks for visiting.',
    }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.timezone, 'Europe/London')
  assert.equal(updated.body.singleQuestionModeEnabled, 1)
  assert.equal(updated.body.qrModeEnabled, 1)
  assert.equal(updated.body.retentionDays, 45)
  assert.equal(updated.body.kioskIdleResetSeconds, 30)

  const forbiddenUpdate = await api('/api/institutions/1', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Downtown Clinic', slug: 'downtown-clinic', timezone: 'UTC' }),
  })
  assert.equal(forbiddenUpdate.response.status, 403)
})

test('institution user can manage own question bank only', async () => {
  const westUserToken = await login('west-user@example.com', 'Password1234!')

  const forbiddenUsers = await api(`/api/institutions/${secondInstitutionId}/users`, {
    headers: { Authorization: `Bearer ${westUserToken}` },
  })
  assert.equal(forbiddenUsers.response.status, 403)

  const forbiddenSettings = await api(`/api/institutions/${secondInstitutionId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${westUserToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Westside Clinic', slug: 'westside-clinic', timezone: 'UTC' }),
  })
  assert.equal(forbiddenSettings.response.status, 403)

  const forbiddenQuestions = await api('/api/institutions/1/questions', {
    headers: { Authorization: `Bearer ${westUserToken}` },
  })
  assert.equal(forbiddenQuestions.response.status, 403)

  const created = await api(`/api/institutions/${secondInstitutionId}/questions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${westUserToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      questionType: 'text',
      prompt: 'What should we improve?',
      options: [],
      includeInKiosk: true,
      isDemographic: false,
      displayOrder: 5,
    }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.institutionId, secondInstitutionId)

  const patched = await api(`/api/institutions/${secondInstitutionId}/questions/${created.body.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${westUserToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ includeInKiosk: false }),
  })
  assert.equal(patched.response.status, 200)
  assert.equal(patched.body.includeInKiosk, false)
})

test('institution admin can manage same-institution kiosk users but not root users', async () => {
  const westAdminToken = await login('west-admin@example.com', 'Password1234!')

  const created = await api(`/api/institutions/${secondInstitutionId}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'west-kiosk-managed@example.com',
      password: 'Password1234!',
      role: 'institution_kiosk',
    }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.mustChangePassword, false)

  const updated = await api(`/api/auth/users/${created.body.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'west-kiosk-renamed@example.com',
      role: 'institution_kiosk',
      institutionId: secondInstitutionId,
      status: 'suspended',
    }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.user.email, 'west-kiosk-renamed@example.com')
  assert.equal(updated.body.user.status, 'suspended')

  const forbiddenRootEdit = await api('/api/auth/users/1', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${westAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'root-renamed@example.com',
      role: 'root',
      institutionId: null,
      status: 'active',
    }),
  })
  assert.equal(forbiddenRootEdit.response.status, 403)

  const deleted = await api(`/api/auth/users/${created.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${westAdminToken}` },
  })
  assert.equal(deleted.response.status, 204)
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

test('root can suspend institution lifecycle and revoke scoped sessions', async () => {
  const rootToken = await login('root@quickglimpse.local', 'ChangeMeRoot123!')
  const westUserToken = await login('west-user@example.com', 'Password1234!')

  const suspended = await api(`/api/institutions/${secondInstitutionId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'suspended' }),
  })
  assert.equal(suspended.response.status, 200)
  assert.equal(suspended.body.status, 'suspended')
  assert.equal(suspended.body.kioskModeEnabled, 0)

  const revokedSession = await api(`/api/institutions/${secondInstitutionId}/analytics`, {
    headers: { Authorization: `Bearer ${westUserToken}` },
  })
  assert.equal(revokedSession.response.status, 401)

  const blockedLogin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'west-user@example.com',
      password: 'Password1234!',
    }),
  })
  assert.equal(blockedLogin.response.status, 401)
  assert.equal(blockedLogin.body.error, 'Institution is not active.')

  const reactivated = await api(`/api/institutions/${secondInstitutionId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'active' }),
  })
  assert.equal(reactivated.response.status, 200)
  assert.equal(reactivated.body.status, 'active')
})

test('root hard delete is safe and administrative actions are audited', async () => {
  const rootToken = await login('root@quickglimpse.local', 'ChangeMeRoot123!')

  const blockedDelete = await api(`/api/institutions/${secondInstitutionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(blockedDelete.response.status, 409)

  const created = await api('/api/institutions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Temporary Pilot',
      slug: 'temporary-pilot',
      timezone: 'UTC',
    }),
  })
  assert.equal(created.response.status, 201)

  const deleted = await api(`/api/institutions/${created.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(deleted.response.status, 204)

  const auditCounts = db
    .prepare(
      `SELECT action, COUNT(*) AS count
       FROM audit_events
       WHERE action IN ('institution_updated', 'institution_status_changed', 'question_created', 'question_updated', 'institution_deleted')
       GROUP BY action`,
    )
    .all()
  const countsByAction = new Map(auditCounts.map((row) => [row.action, row.count]))
  assert.ok(countsByAction.get('institution_updated') >= 1)
  assert.ok(countsByAction.get('institution_status_changed') >= 2)
  assert.ok(countsByAction.get('question_created') >= 1)
  assert.ok(countsByAction.get('question_updated') >= 1)
  assert.ok(countsByAction.get('institution_deleted') >= 1)
})

test('root can create edit deassign and remove users before deleting an institution', async () => {
  const rootToken = await login('root@quickglimpse.local', 'ChangeMeRoot123!')

  const institution = await api('/api/institutions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'User Managed Pilot',
      slug: 'user-managed-pilot',
      timezone: 'UTC',
    }),
  })
  assert.equal(institution.response.status, 201)

  const admin = await api(`/api/institutions/${institution.body.id}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'managed-admin@example.com',
      password: 'Password1234!',
      role: 'institution_admin',
    }),
  })
  assert.equal(admin.response.status, 201)

  const general = await api(`/api/institutions/${institution.body.id}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'managed-user@example.com',
      password: 'Password1234!',
      role: 'institution_user',
    }),
  })
  assert.equal(general.response.status, 201)

  const stillBlocked = await api(`/api/institutions/${institution.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(stillBlocked.response.status, 409)

  const deassigned = await api(`/api/auth/users/${general.body.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'managed-user-renamed@example.com',
      role: 'institution_user',
      institutionId: null,
      status: 'deactivated',
    }),
  })
  assert.equal(deassigned.response.status, 200)
  assert.equal(deassigned.body.user.institutionId, null)
  assert.equal(deassigned.body.user.status, 'deactivated')

  const invalidDeassign = await api(`/api/auth/users/${admin.body.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${rootToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'managed-admin@example.com',
      role: 'institution_admin',
      institutionId: null,
      status: 'active',
    }),
  })
  assert.equal(invalidDeassign.response.status, 400)

  const deletedAdmin = await api(`/api/auth/users/${admin.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(deletedAdmin.response.status, 204)

  const deletedDeassigned = await api(`/api/auth/users/${general.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(deletedDeassigned.response.status, 204)

  const deletedInstitution = await api(`/api/institutions/${institution.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${rootToken}` },
  })
  assert.equal(deletedInstitution.response.status, 204)

  const auditCounts = db
    .prepare(
      `SELECT action, COUNT(*) AS count
       FROM audit_events
       WHERE action IN ('user_updated', 'user_deleted')
       GROUP BY action`,
    )
    .all()
  const countsByAction = new Map(auditCounts.map((row) => [row.action, row.count]))
  assert.ok(countsByAction.get('user_updated') >= 1)
  assert.ok(countsByAction.get('user_deleted') >= 2)
})
