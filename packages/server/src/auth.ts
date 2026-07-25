import { createHash, randomBytes, randomInt } from 'node:crypto'
import { compareSync, hashSync } from 'bcryptjs'
import { getDb } from './db.js'
import { config } from './config.js'

export const userRoles = ['root', 'institution_admin', 'institution_user'] as const
export type UserRole = (typeof userRoles)[number]

export const userStatuses = ['active', 'suspended', 'deactivated'] as const
export type UserStatus = (typeof userStatuses)[number]

type UserRow = {
  id: number
  email: string
  role: UserRole
  status: UserStatus
  institutionId: number | null
  createdAt: string
  lastLoginAt: string | null
  deactivatedAt: string | null
  twoFaEnabled?: number
  mustChangePassword?: number
}

export type SessionUser = {
  id: number
  email: string
  role: UserRole
  status: UserStatus
  institutionId: number | null
}

export type SessionResult = {
  token: string
  expiresAt: string
  user: SessionUser
  mustChangePassword?: boolean
}

export type LoginResult =
  | { challengePending: true; email: string; expiresAt: string; preview: { otpCode: string } }
  | (SessionResult & { mustChangePassword: boolean })

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function mapUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    institutionId: row.institutionId,
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function generateSessionToken() {
  return randomBytes(32).toString('base64url')
}

function getSessionExpiryIso() {
  return new Date(Date.now() + config.sessionTtlMs).toISOString()
}

export async function verifyTurnstileToken(token: string, remoteIp?: string) {
  const trimmedToken = token.trim()
  if (!config.turnstile.secretKey) {
    return {
      success: trimmedToken === config.turnstile.devBypassToken,
      mode: 'dev' as const,
    }
  }

  const params = new URLSearchParams({
    secret: config.turnstile.secretKey,
    response: trimmedToken,
  })
  if (remoteIp) {
    params.set('remoteip', remoteIp)
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  if (!response.ok) {
    return {
      success: false,
      mode: 'remote' as const,
    }
  }

  const result = (await response.json()) as { success?: boolean }
  return {
    success: Boolean(result.success),
    mode: 'remote' as const,
  }
}

export function registerUser(input: {
  email: string
  password: string
  role: UserRole
  institutionId: number | null
  mustChangePassword?: boolean
}) {
  const db = getDb()
  const email = normalizeEmail(input.email)

  if (input.role !== 'root' && input.institutionId === null) {
    throw new Error('Institution users must be assigned to an institution.')
  }

  if (input.institutionId !== null) {
    const institution = db.prepare('SELECT id FROM institutions WHERE id = ?').get(input.institutionId) as { id: number } | undefined
    if (!institution) {
      throw new Error('Institution not found.')
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined
  if (existing) {
    throw new Error('A user with this email already exists.')
  }

  const passwordHash = hashSync(input.password, 12)
  const insertUser = db.prepare(
    'INSERT INTO users (email, role, status, institution_id) VALUES (?, ?, ?, ?)',
  )
  const result = insertUser.run(email, input.role, 'active', input.institutionId)
  const userId = Number(result.lastInsertRowid)

  db.prepare(
    'INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES (?, ?, ?)',
  ).run(userId, passwordHash, input.mustChangePassword ? 1 : 0)

  const createdUser = db
    .prepare(
      `SELECT id, email, role, status, institution_id AS institutionId, created_at AS createdAt,
              last_login_at AS lastLoginAt, deactivated_at AS deactivatedAt
       FROM users WHERE id = ?`,
    )
    .get(userId) as UserRow

  return mapUser(createdUser)
}

export function createSessionForUser(user: SessionUser) {
  const db = getDb()
  const token = generateSessionToken()
  const expiresAt = getSessionExpiryIso()

  db.prepare(
    'INSERT INTO auth_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
  ).run(user.id, hashToken(token), expiresAt)

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)

  return {
    token,
    expiresAt,
    user,
  }
}

export function loginUser(input: { email: string; password: string }) {
  const db = getDb()
  const email = normalizeEmail(input.email)

  const row = db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.role,
         u.status,
         u.institution_id AS institutionId,
         u.created_at AS createdAt,
         u.last_login_at AS lastLoginAt,
         u.deactivated_at AS deactivatedAt,
         u.two_fa_enabled AS twoFaEnabled,
         c.password_hash AS passwordHash,
         c.must_change_password AS mustChangePassword
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
       WHERE u.email = ?`,
    )
    .get(email) as (UserRow & { passwordHash: string }) | undefined

  if (!row || !compareSync(input.password, row.passwordHash)) {
    throw new Error('Invalid email or password.')
  }

  if (row.status !== 'active') {
    throw new Error(`Account is ${row.status}.`)
  }

  if (row.twoFaEnabled) {
    db.prepare(
      `DELETE FROM login_challenges
        WHERE datetime(expires_at) < datetime('now', '-1 day')
           OR consumed_at IS NOT NULL`,
    ).run()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const otpCode = `${randomInt(100000, 999999)}`
    db.prepare(
      `INSERT INTO login_challenges (email, method, otp_code_hash, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(email, 'email_code', createHash('sha256').update(otpCode).digest('hex'), expiresAt)
    return { challengePending: true as const, email, expiresAt, preview: { otpCode } }
  }

  return { ...createSessionForUser(mapUser(row)), mustChangePassword: Boolean(row.mustChangePassword) }
}

export function authenticateSession(token: string) {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT
         s.id AS sessionId,
         s.expires_at AS expiresAt,
         u.id,
         u.email,
         u.role,
         u.status,
         u.institution_id AS institutionId
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND datetime(s.expires_at) > datetime('now')`,
    )
    .get(hashToken(token)) as
    | {
        sessionId: number
        expiresAt: string
        id: number
        email: string
        role: UserRole
        status: UserStatus
        institutionId: number | null
      }
    | undefined

  if (!row || row.status !== 'active') {
    return null
  }

  return {
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      institutionId: row.institutionId,
    },
  }
}

export function logoutSession(token: string) {
  const db = getDb()
  db.prepare("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL")
    .run(hashToken(token))
}

export function listUsers() {
  const db = getDb()
  return db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.institution_id AS institutionId,
              u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
              u.deactivated_at AS deactivatedAt, u.two_fa_enabled AS twoFaEnabled,
              COALESCE(c.must_change_password, 0) AS mustChangePassword
       FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id
       ORDER BY u.id`,
    )
    .all()
}

export function updateUserStatus(id: number, status: UserStatus) {
  const db = getDb()
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: UserRole } | undefined
  if (!user) {
    throw new Error('User not found.')
  }

  if (user.role === 'root' && status !== 'active') {
    throw new Error('Root account cannot be disabled.')
  }

  db.prepare(
    `UPDATE users
        SET status = ?,
            deactivated_at = CASE WHEN ? = 'deactivated' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ?`,
  ).run(status, status, id)

  if (status !== 'active') {
    db.prepare("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL")
      .run(id)
  }

  return db
    .prepare(
      `SELECT id, email, role, status, institution_id AS institutionId, created_at AS createdAt,
              last_login_at AS lastLoginAt, deactivated_at AS deactivatedAt
       FROM users
       WHERE id = ?`,
    )
    .get(id) as UserRow
}

export function ensureSeedCredentials() {
  const db = getDb()
  const seedUsers = [
    {
      email: 'root@quickglimpse.local',
      password: config.seedCredentials.rootPassword,
      mustChangePassword: true,
    },
    {
      email: 'institution-admin@quickglimpse.local',
      password: config.seedCredentials.institutionAdminPassword,
      mustChangePassword: true,
    },
  ]

  for (const seedUser of seedUsers) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(seedUser.email) as { id: number } | undefined
    if (!user) {
      continue
    }

    const existingCredential = db
      .prepare('SELECT user_id FROM user_credentials WHERE user_id = ?')
      .get(user.id) as { user_id: number } | undefined

    if (!existingCredential) {
      db.prepare(
        'INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES (?, ?, ?)',
      ).run(user.id, hashSync(seedUser.password, 12), seedUser.mustChangePassword ? 1 : 0)
    }
  }
}

export function ensureInitialAdminLogin(input: {
  email: string
  password: string
  mustChangePassword?: boolean
}) {
  const db = getDb()
  const normalizedEmail = normalizeEmail(input.email)
  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }
  if (!input.password || input.password.length < 10) {
    throw new Error('Password must be at least 10 characters.')
  }

  const existingRoot = db
    .prepare(`SELECT id FROM users WHERE role = 'root' ORDER BY id LIMIT 1`)
    .get() as { id: number } | undefined

  const rootUserId = existingRoot
    ? existingRoot.id
    : Number(
        db
          .prepare(`INSERT INTO users (email, role, status, institution_id) VALUES (?, 'root', 'active', NULL)`)
          .run(normalizedEmail).lastInsertRowid,
      )

  const emailConflict = db
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .get(normalizedEmail, rootUserId) as { id: number } | undefined
  if (emailConflict) {
    throw new Error('A user with this email already exists.')
  }

  db.prepare(
    `UPDATE users
     SET email = ?,
         status = 'active',
         institution_id = NULL,
         deactivated_at = NULL
     WHERE id = ?`,
  ).run(normalizedEmail, rootUserId)

  const mustChangePassword = input.mustChangePassword ?? true
  const passwordHash = hashSync(input.password, 12)
  const existingCredential = db
    .prepare('SELECT user_id FROM user_credentials WHERE user_id = ?')
    .get(rootUserId) as { user_id: number } | undefined

  if (existingCredential) {
    db.prepare(
      `UPDATE user_credentials
       SET password_hash = ?, must_change_password = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
    ).run(passwordHash, mustChangePassword ? 1 : 0, rootUserId)
  } else {
    db.prepare(
      'INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES (?, ?, ?)',
    ).run(rootUserId, passwordHash, mustChangePassword ? 1 : 0)
  }

  db.prepare('UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(rootUserId)

  return db
    .prepare(
      `SELECT id, email, role, status, institution_id AS institutionId, created_at AS createdAt,
              last_login_at AS lastLoginAt, deactivated_at AS deactivatedAt
       FROM users
       WHERE id = ?`,
    )
    .get(rootUserId) as UserRow
}

export function changeOwnPassword(userId: number, currentPassword: string, newPassword: string) {
  const db = getDb()
  const row = db
    .prepare('SELECT password_hash FROM user_credentials WHERE user_id = ?')
    .get(userId) as { password_hash: string } | undefined
  if (!row || !compareSync(currentPassword, row.password_hash)) {
    throw new Error('Current password is incorrect.')
  }
  db.prepare(
    'UPDATE user_credentials SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
  ).run(hashSync(newPassword, 12), userId)
}

export function toggle2FA(targetUserId: number, enabled: boolean, requestingUser: SessionUser) {
  const db = getDb()
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as { id: number } | undefined
  if (!target) {
    throw new Error('User not found.')
  }
  if (requestingUser.role !== 'root' && requestingUser.id !== targetUserId) {
    throw new Error('You can only manage 2FA for yourself.')
  }
  db.prepare('UPDATE users SET two_fa_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, targetUserId)
}

export function updateUserEmail(userId: number, newEmail: string) {
  const db = getDb()
  const email = normalizeEmail(newEmail)
  const currentUser = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
  if (!currentUser) {
    throw new Error('User not found.')
  }
  if (email === currentUser.email) {
    return
  }
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .get(email, userId) as { id: number } | undefined
  if (existing) {
    throw new Error('This email is already in use.')
  }
  db.prepare('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?').run(email, userId)
}

export function confirmPasswordReset(token: string, newPassword: string) {
  const db = getDb()
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const challenge = db
    .prepare(
      `SELECT id, email FROM login_challenges
       WHERE method = 'password_reset'
         AND magic_token_hash = ?
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
    .get(tokenHash) as { id: number; email: string } | undefined
  if (!challenge) {
    throw new Error('Invalid or expired reset token.')
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(challenge.email) as { id: number } | undefined
  if (!user) {
    throw new Error('User not found.')
  }
  db.prepare(
    'UPDATE user_credentials SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
  ).run(hashSync(newPassword, 12), user.id)
  db.prepare('UPDATE login_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(challenge.id)
}

export function verifyOtpChallenge(email: string, code: string): SessionResult & { mustChangePassword: boolean } {
  const db = getDb()
  const normalizedEmail = normalizeEmail(email)
  const codeHash = createHash('sha256').update(code).digest('hex')
  const challenge = db
    .prepare(
      `SELECT id FROM login_challenges
       WHERE method = 'email_code'
         AND email = ?
         AND otp_code_hash = ?
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(normalizedEmail, codeHash) as { id: number } | undefined
  if (!challenge) {
    throw new Error('Invalid or expired code.')
  }
  const userRow = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.institution_id AS institutionId,
              COALESCE(c.must_change_password, 0) AS mustChangePassword
       FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id
       WHERE u.email = ? AND u.status = 'active'`,
    )
    .get(normalizedEmail) as {
      id: number
      email: string
      role: UserRole
      status: UserStatus
      institutionId: number | null
      mustChangePassword: number
    } | undefined
  if (!userRow) {
    throw new Error('User not found or inactive.')
  }
  db.prepare('UPDATE login_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(challenge.id)
  const session = createSessionForUser({
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    status: userRow.status,
    institutionId: userRow.institutionId,
  })
  return { ...session, mustChangePassword: Boolean(userRow.mustChangePassword) }
}

export function verifyMagicLinkChallenge(token: string): SessionResult {
  const db = getDb()
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const challenge = db
    .prepare(
      `SELECT id, email FROM login_challenges
       WHERE method = 'magic_link'
         AND magic_token_hash = ?
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(tokenHash) as { id: number; email: string } | undefined
  if (!challenge) {
    throw new Error('Invalid or expired magic link.')
  }
  const userRow = db
    .prepare(
      `SELECT id, email, role, status, institution_id AS institutionId
       FROM users WHERE email = ? AND status = 'active'`,
    )
    .get(challenge.email) as {
      id: number
      email: string
      role: UserRole
      status: UserStatus
      institutionId: number | null
    } | undefined
  if (!userRow) {
    throw new Error('User not found or inactive.')
  }
  db.prepare('UPDATE login_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(challenge.id)
  return createSessionForUser({
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    status: userRow.status,
    institutionId: userRow.institutionId,
  })
}
