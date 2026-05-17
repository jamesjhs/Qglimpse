import { createHash, randomBytes, randomInt } from 'node:crypto'
import { getDb } from './db.js'
import { authMethodOptions, demographicsTemplates, foundationChecklist } from './data/demographics.js'
import { config } from './config.js'
import { listUsers, userStatuses } from './auth.js'

export type SmtpSettingsInput = {
  username: string
  password?: string
  sendAddress: string
  serverAddress: string
  port: number
  secureLoginType: 'none' | 'ssl' | 'starttls'
}

const parseOptions = (value: string) => JSON.parse(value) as string[]

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
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const otpCode = method === 'email_code' ? `${randomInt(100000, 999999)}` : null
  const magicToken = method === 'magic_link' ? randomBytes(24).toString('base64url') : null

  db.prepare(
    `INSERT INTO login_challenges (email, method, otp_code_hash, magic_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    email,
    method,
    otpCode ? createHash('sha256').update(otpCode).digest('hex') : null,
    magicToken ? createHash('sha256').update(magicToken).digest('hex') : null,
    expiresAt,
  )

  return {
    email,
    method,
    expiresAt,
    preview:
      method === 'email_code'
        ? { otpCode }
        : { magicLink: `${config.baseUrl}/auth/magic-link?token=${encodeURIComponent(magicToken ?? '')}` },
  }
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
    rootOverview: getRootOverview(),
    smtpSettings: getSmtpSettings(),
    foundationChecklist,
    roadmapSnapshot: {
      currentStep: 'Step 2 auth core',
      nextStep: 'Step 3 emailed OTP + magic link 2FA flow completion',
      questionBankSeeded: demographicsTemplates.length,
    },
    authCore: {
      supportedRoles: ['root', 'institution_admin', 'institution_user'],
      userStatuses,
      turnstileSiteKey: config.turnstile.siteKey,
      devBypassTokenHint: config.turnstile.secretKey ? null : config.turnstile.devBypassToken,
      userCount: listUsers().length,
    },
  }
}
