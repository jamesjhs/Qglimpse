import { createHash, randomBytes, randomInt } from 'node:crypto'
import { getDb } from './db.js'
import { authMethodOptions, demographicsTemplates, foundationChecklist } from './data/demographics.js'
import { config } from './config.js'
import {
  registerUser,
  userStatuses,
  type UserRole,
  type SessionResult,
} from './auth.js'

export type SmtpSettingsInput = {
  username: string
  password?: string
  sendAddress: string
  serverAddress: string
  port: number
  secureLoginType: 'none' | 'ssl' | 'starttls'
}

const parseOptions = (value: string) => JSON.parse(value) as string[]

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function listInstitutions() {
  const db = getDb()
  return db
    .prepare(
      'SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions ORDER BY name',
    )
    .all()
}

export function listDemographics() {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT template_key AS templateKey, question_type AS questionType, prompt, options_json AS optionsJson FROM question_templates ORDER BY id',
    )
    .all() as Array<{ templateKey: string; questionType: string; prompt: string; optionsJson: string }>

  return rows.map((row) => ({
    templateKey: row.templateKey,
    questionType: row.questionType,
    prompt: row.prompt,
    options: parseOptions(row.optionsJson),
  }))
}

export function getRootOverview() {
  const db = getDb()
  const aggregate = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM institutions) AS institutionCount,
        (SELECT COUNT(*) FROM users WHERE role = 'institution_admin') AS institutionUserCount,
        (SELECT COUNT(*) FROM question_templates) AS demographicQuestionCount,
        (SELECT COUNT(*) FROM responses) AS responseCount,
        (SELECT COUNT(*) FROM institutions WHERE kiosk_mode_enabled = 1) AS kioskEnabledCount`,
    )
    .get() as {
      institutionCount: number
      institutionUserCount: number
      demographicQuestionCount: number
      responseCount: number
      kioskEnabledCount: number
    }

  return {
    ...aggregate,
    trendlinesEnabled: false,
  }
}

export function getSmtpSettings() {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT username, password, send_address AS sendAddress, server_address AS serverAddress, port, secure_login_type AS secureLoginType FROM smtp_settings WHERE id = 1',
    )
    .get() as
    | {
        username: string
        password: string
        sendAddress: string
        serverAddress: string
        port: number
        secureLoginType: 'none' | 'ssl' | 'starttls'
      }
    | undefined

  return {
    username: row?.username ?? '',
    sendAddress: row?.sendAddress ?? '',
    serverAddress: row?.serverAddress ?? '',
    port: row?.port ?? 587,
    secureLoginType: row?.secureLoginType ?? 'starttls',
    passwordSet: Boolean(row?.password),
  }
}

export function updateSmtpSettings(input: SmtpSettingsInput) {
  const db = getDb()
  const current = db.prepare('SELECT password FROM smtp_settings WHERE id = 1').get() as { password: string } | undefined
  db.prepare(
    `UPDATE smtp_settings
       SET username = @username,
           password = @password,
           send_address = @sendAddress,
           server_address = @serverAddress,
           port = @port,
           secure_login_type = @secureLoginType,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
  ).run({
    ...input,
    password: input.password && input.password.trim().length > 0 ? input.password : current?.password ?? '',
  })

  return getSmtpSettings()
}

export function toggleInstitutionKioskMode(id: number, enabled: boolean) {
  const db = getDb()
  db.prepare('UPDATE institutions SET kiosk_mode_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  return db
    .prepare(
      'SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions WHERE id = ?',
    )
    .get(id)
}

export function createLoginChallenge(email: string, method: 'email_code' | 'magic_link') {
  const db = getDb()
  db.prepare(
    `DELETE FROM login_challenges
      WHERE datetime(expires_at) < datetime('now', '-1 day')
         OR consumed_at IS NOT NULL`,
  ).run()

  const normalizedEmail = normalizeEmail(email)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const otpCode = method === 'email_code' ? `${randomInt(100000, 999999)}` : null
  const magicToken = method === 'magic_link' ? randomBytes(24).toString('base64url') : null

  db.prepare(
    `INSERT INTO login_challenges (email, method, otp_code_hash, magic_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    normalizedEmail,
    method,
    otpCode ? createHash('sha256').update(otpCode).digest('hex') : null,
    magicToken ? createHash('sha256').update(magicToken).digest('hex') : null,
    expiresAt,
  )

  return {
    email: normalizedEmail,
    method,
    expiresAt,
    preview:
      method === 'email_code'
        ? { otpCode }
        : { magicLink: `${config.baseUrl}/auth/magic-link?token=${encodeURIComponent(magicToken ?? '')}` },
  }
}

export function requestPasswordReset(email: string) {
  const db = getDb()
  db.prepare(
    `DELETE FROM login_challenges
      WHERE method = 'password_reset'
        AND (datetime(expires_at) < datetime('now', '-1 day') OR consumed_at IS NOT NULL)`,
  ).run()
  const normalizedEmail = email.trim().toLowerCase()
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail) as { id: number } | undefined
  if (!user) {
    return {}
  }
  const rawToken = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  db.prepare(
    `INSERT INTO login_challenges (email, method, magic_token_hash, expires_at) VALUES (?, ?, ?, ?)`,
  ).run(normalizedEmail, 'password_reset', createHash('sha256').update(rawToken).digest('hex'), expiresAt)
  return { preview: { token: rawToken } }
}

export function requestEmailVerification(userId: number) {
  const db = getDb()
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
  if (!user) {
    throw new Error('User not found.')
  }
  db.prepare(
    `DELETE FROM login_challenges
      WHERE method = 'email_verify'
        AND (datetime(expires_at) < datetime('now', '-1 day') OR consumed_at IS NOT NULL)`,
  ).run()
  const rawToken = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  db.prepare(
    `INSERT INTO login_challenges (email, method, magic_token_hash, expires_at) VALUES (?, ?, ?, ?)`,
  ).run(user.email, 'email_verify', createHash('sha256').update(rawToken).digest('hex'), expiresAt)
  return { previewToken: rawToken }
}

export function confirmEmailVerification(token: string) {
  const db = getDb()
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const challenge = db
    .prepare(
      `SELECT id, email FROM login_challenges
       WHERE method = 'email_verify'
         AND magic_token_hash = ?
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
    .get(tokenHash) as { id: number; email: string } | undefined
  if (!challenge) {
    throw new Error('Invalid or expired verification token.')
  }
  db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(challenge.email)
  db.prepare('UPDATE login_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(challenge.id)
}

export function createInstitution(input: { name: string; slug: string; timezone: string }) {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM institutions WHERE slug = ?').get(input.slug) as { id: number } | undefined
  if (existing) {
    throw new Error('An institution with this slug already exists.')
  }
  const result = db
    .prepare('INSERT INTO institutions (name, slug, timezone, kiosk_mode_enabled) VALUES (?, ?, ?, 0)')
    .run(input.name, input.slug, input.timezone)
  const id = Number(result.lastInsertRowid)
  return db
    .prepare(
      'SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions WHERE id = ?',
    )
    .get(id) as { id: number; name: string; slug: string; timezone: string; kioskModeEnabled: number; createdAt: string }
}

export function getInstitution(id: number) {
  const db = getDb()
  return (
    db
      .prepare(
        'SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions WHERE id = ?',
      )
      .get(id) ?? null
  ) as { id: number; name: string; slug: string; timezone: string; kioskModeEnabled: number; createdAt: string } | null
}

export function updateInstitution(id: number, input: { name: string; slug: string; timezone: string }) {
  const db = getDb()
  const institution = db.prepare('SELECT id FROM institutions WHERE id = ?').get(id) as { id: number } | undefined
  if (!institution) {
    throw new Error('Institution not found.')
  }
  const slugConflict = db
    .prepare('SELECT id FROM institutions WHERE slug = ? AND id != ?')
    .get(input.slug, id) as { id: number } | undefined
  if (slugConflict) {
    throw new Error('An institution with this slug already exists.')
  }
  db.prepare('UPDATE institutions SET name = ?, slug = ?, timezone = ? WHERE id = ?').run(
    input.name,
    input.slug,
    input.timezone,
    id,
  )
  return db
    .prepare(
      'SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions WHERE id = ?',
    )
    .get(id) as { id: number; name: string; slug: string; timezone: string; kioskModeEnabled: number; createdAt: string }
}

export function deleteInstitution(id: number) {
  const db = getDb()
  const institution = db.prepare('SELECT id FROM institutions WHERE id = ?').get(id) as { id: number } | undefined
  if (!institution) {
    throw new Error('Institution not found.')
  }
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE institution_id = ?').get(id) as { count: number }
  if (userCount.count > 0) {
    throw new Error('Cannot delete institution with assigned users.')
  }
  db.prepare('DELETE FROM institutions WHERE id = ?').run(id)
}

export function listInstitutionUsers(institutionId: number) {
  const db = getDb()
  return db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.institution_id AS institutionId,
              u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
              u.two_fa_enabled AS twoFaEnabled
       FROM users u
       WHERE u.institution_id = ?
       ORDER BY u.id`,
    )
    .all(institutionId)
}

export function createInstitutionUser(
  institutionId: number,
  input: { email: string; password: string; role?: string },
): SessionResult['user'] {
  return registerUser({
    email: input.email,
    password: input.password,
    role: (input.role as UserRole) ?? 'institution_user',
    institutionId,
    mustChangePassword: true,
  })
}

export function buildBootstrapPayload() {
  return {
    app: {
      name: config.appName,
      version: config.version,
      readyz: '/readyz',
      baseUrl: config.baseUrl,
    },
    authOptions: authMethodOptions,
    institutions: listInstitutions(),
    demographics: listDemographics(),
    foundationChecklist,
    roadmapSnapshot: {
      currentStep: 'Step 4 institution + user administration',
      nextStep: 'Step 5 question system core',
      questionBankSeeded: demographicsTemplates.length,
    },
    authCore: {
      supportedRoles: ['root', 'institution_admin', 'institution_user'],
      userStatuses,
      turnstileSiteKey: config.turnstile.siteKey,
      devBypassTokenHint: config.turnstile.secretKey ? null : config.turnstile.devBypassToken,
    },
  }
}
