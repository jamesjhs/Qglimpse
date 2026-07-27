import { createHash, randomBytes, randomInt } from 'node:crypto'
import { getDb } from './db.js'
import { authMethodOptions, demographicsTemplates, insightTemplates, foundationChecklist } from './data/demographics.js'
import { config } from './config.js'
import { sendOperationalEmail } from './mailer.js'
import { recordAuditEvent } from './audit.js'
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
      `SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled,
              color_scheme AS colorScheme, created_at AS createdAt
       FROM institutions
       ORDER BY name`,
    )
    .all()
}

export function listDemographics() {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT template_key AS templateKey, question_type AS questionType, prompt, options_json AS optionsJson FROM question_templates WHERE is_demographic = 1 ORDER BY id',
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
        (SELECT COUNT(*) FROM responses) AS totalResponseCount,
        (SELECT COUNT(*) FROM institutions WHERE kiosk_mode_enabled = 1) AS kioskEnabledCount,
        (SELECT COUNT(*) FROM institution_questions WHERE include_in_kiosk = 1) AS totalActiveQuestions,
        (SELECT COUNT(*) FROM kiosk_sessions) AS kioskSessionsTotal,
        (SELECT COUNT(*) FROM kiosk_sessions WHERE date(started_at) = date('now')) AS kioskSessionsToday`,
    )
    .get() as {
      institutionCount: number
      institutionUserCount: number
      demographicQuestionCount: number
      responseCount: number
      totalResponseCount: number
      kioskEnabledCount: number
      totalActiveQuestions: number
      kioskSessionsTotal: number
      kioskSessionsToday: number
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
      `SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled,
              color_scheme AS colorScheme, created_at AS createdAt
       FROM institutions
       WHERE id = ?`,
    )
    .get(id)
}

export async function createLoginChallenge(email: string, method: 'email_code' | 'magic_link') {
  const db = getDb()
  const normalizedEmail = normalizeEmail(email)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const otpCode = method === 'email_code' ? `${randomInt(100000, 999999)}` : null
  const magicToken = method === 'magic_link' ? randomBytes(24).toString('base64url') : null

  db.transaction(() => {
    db.prepare(
      `DELETE FROM login_challenges
        WHERE datetime(expires_at) < datetime('now', '-1 day')
           OR consumed_at IS NOT NULL`,
    ).run()

    db.prepare(
      `UPDATE login_challenges
          SET consumed_at = CURRENT_TIMESTAMP
        WHERE email = ?
          AND method = ?
          AND consumed_at IS NULL
          AND datetime(expires_at) > datetime('now')`,
    ).run(normalizedEmail, method)

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
  })()

  if (method === 'email_code' && otpCode) {
    await sendOperationalEmail({
      to: normalizedEmail,
      subject: 'Your Qglimpse sign-in code',
      text: `Your Qglimpse sign-in code is ${otpCode}. It expires in 10 minutes.`,
    })
  } else if (method === 'magic_link' && magicToken) {
    const magicLink = `${config.baseUrl}/auth/magic-link?token=${encodeURIComponent(magicToken)}`
    await sendOperationalEmail({
      to: normalizedEmail,
      subject: 'Your Qglimpse sign-in link',
      text: `Open this single-use Qglimpse sign-in link within 10 minutes: ${magicLink}`,
    })
  }

  return {
    email: normalizedEmail,
    method,
    expiresAt,
  }
}

export async function requestPasswordReset(email: string) {
  const db = getDb()
  db.prepare(
    `DELETE FROM login_challenges
      WHERE method = 'password_reset'
        AND (datetime(expires_at) < datetime('now', '-1 day') OR consumed_at IS NOT NULL)`,
  ).run()
  const normalizedEmail = email.trim().toLowerCase()
  const rawToken = randomBytes(24).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail) as { id: number } | undefined
  if (!user) {
    db.prepare(`SELECT COUNT(*) AS count FROM login_challenges WHERE email = ? AND method = 'password_reset'`).get(
      normalizedEmail,
    )
    return { accepted: true }
  }
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  db.prepare(
    `INSERT INTO login_challenges (email, method, magic_token_hash, expires_at) VALUES (?, ?, ?, ?)`,
  ).run(normalizedEmail, 'password_reset', tokenHash, expiresAt)
  const resetLink = `${config.baseUrl}/password-reset?token=${encodeURIComponent(rawToken)}`
  await sendOperationalEmail({
    to: normalizedEmail,
    subject: 'Reset your Qglimpse password',
    text: `Open this single-use Qglimpse password reset link within 1 hour: ${resetLink}`,
  })
  recordAuditEvent({ action: 'password_reset_requested', targetUserId: user.id })
  return { accepted: true }
}

export async function requestEmailVerification(userId: number) {
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
  const verificationLink = `${config.baseUrl}/email-verify?token=${encodeURIComponent(rawToken)}`
  await sendOperationalEmail({
    to: user.email,
    subject: 'Verify your Qglimpse email address',
    text: `Open this single-use Qglimpse email verification link within 24 hours: ${verificationLink}`,
  })
  recordAuditEvent({ action: 'email_verification_requested', targetUserId: userId })
  return { accepted: true }
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
  recordAuditEvent({ action: 'email_verification_completed', metadata: { email: challenge.email } })
}

export function createInstitution(input: { name: string; slug: string; timezone: string; colorScheme?: string }) {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM institutions WHERE slug = ?').get(input.slug) as { id: number } | undefined
  if (existing) {
    throw new Error('An institution with this slug already exists.')
  }
  const result = db
    .prepare('INSERT INTO institutions (name, slug, timezone, kiosk_mode_enabled, color_scheme) VALUES (?, ?, ?, 0, ?)')
    .run(input.name, input.slug, input.timezone, input.colorScheme ?? 'ocean')
  const id = Number(result.lastInsertRowid)
  return db
    .prepare(
      `SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled,
              color_scheme AS colorScheme, created_at AS createdAt
       FROM institutions
       WHERE id = ?`,
    )
    .get(id) as {
    id: number
    name: string
    slug: string
    timezone: string
    kioskModeEnabled: number
    colorScheme: string
    createdAt: string
  }
}

export function getInstitution(id: number) {
  const db = getDb()
  return (
    db
      .prepare(
        `SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled,
                color_scheme AS colorScheme, created_at AS createdAt
         FROM institutions
         WHERE id = ?`,
      )
      .get(id) ?? null
  ) as {
    id: number
    name: string
    slug: string
    timezone: string
    kioskModeEnabled: number
    colorScheme: string
    createdAt: string
  } | null
}

export function updateInstitution(id: number, input: { name: string; slug: string; timezone: string; colorScheme?: string }) {
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
  db.prepare('UPDATE institutions SET name = ?, slug = ?, timezone = ?, color_scheme = ? WHERE id = ?').run(
    input.name,
    input.slug,
    input.timezone,
    input.colorScheme ?? 'ocean',
    id,
  )
  return db
    .prepare(
      `SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled,
              color_scheme AS colorScheme, created_at AS createdAt
       FROM institutions
       WHERE id = ?`,
    )
    .get(id) as {
    id: number
    name: string
    slug: string
    timezone: string
    kioskModeEnabled: number
    colorScheme: string
    createdAt: string
  }
}

export function setInstitutionColorScheme(id: number, colorScheme: string) {
  const db = getDb()
  const institution = db.prepare('SELECT id FROM institutions WHERE id = ?').get(id) as { id: number } | undefined
  if (!institution) {
    throw new Error('Institution not found.')
  }
  db.prepare('UPDATE institutions SET color_scheme = ? WHERE id = ?').run(colorScheme, id)
  return getInstitution(id)
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

export function listQuestionTemplates() {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT template_key AS templateKey, question_type AS questionType, prompt, options_json AS optionsJson,
              is_demographic AS isDemographic
       FROM question_templates ORDER BY id`,
    )
    .all() as Array<{
      templateKey: string
      questionType: string
      prompt: string
      optionsJson: string
      isDemographic: number
    }>
  return rows.map((row) => ({
    templateKey: row.templateKey,
    questionType: row.questionType,
    prompt: row.prompt,
    options: parseOptions(row.optionsJson),
    isDemographic: Boolean(row.isDemographic),
  }))
}

export function getInstitutionQuestions(institutionId: number) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, institution_id AS institutionId, template_key AS templateKey,
              question_type AS questionType, prompt, options_json AS optionsJson,
              is_active AS isActive, include_in_kiosk AS includeInKiosk,
              is_demographic AS isDemographic, display_order AS displayOrder,
              schedule_days AS scheduleDays, schedule_start_time AS scheduleStartTime,
              schedule_end_time AS scheduleEndTime, created_at AS createdAt
       FROM institution_questions WHERE institution_id = ? ORDER BY display_order, id`,
    )
    .all(institutionId) as Array<{
      id: number
      institutionId: number
      templateKey: string | null
      questionType: string
      prompt: string
      optionsJson: string
      isActive: number
      includeInKiosk: number
      isDemographic: number
      displayOrder: number
      scheduleDays: string
      scheduleStartTime: string | null
      scheduleEndTime: string | null
      createdAt: string
    }>
  return rows.map((row) => ({
    id: row.id,
    institutionId: row.institutionId,
    templateKey: row.templateKey,
    questionType: row.questionType,
    prompt: row.prompt,
    options: parseOptions(row.optionsJson),
    isActive: Boolean(row.isActive),
    includeInKiosk: Boolean(row.includeInKiosk),
    isDemographic: Boolean(row.isDemographic),
    displayOrder: row.displayOrder,
    scheduleDays: JSON.parse(row.scheduleDays) as number[],
    scheduleStartTime: row.scheduleStartTime,
    scheduleEndTime: row.scheduleEndTime,
    createdAt: row.createdAt,
  }))
}

export type UpdateQuestionInput = {
  includeInKiosk?: boolean
  isDemographic?: boolean
  displayOrder?: number
  scheduleDays?: number[]
  scheduleStartTime?: string | null
  scheduleEndTime?: string | null
}

export function updateInstitutionQuestion(institutionId: number, questionId: number, input: UpdateQuestionInput) {
  const db = getDb()
  const question = db
    .prepare('SELECT id FROM institution_questions WHERE id = ? AND institution_id = ?')
    .get(questionId, institutionId) as { id: number } | undefined
  if (!question) {
    throw new Error('Question not found.')
  }

  const updates: string[] = []
  const params: Record<string, unknown> = { id: questionId }

  if (input.includeInKiosk !== undefined) {
    updates.push('include_in_kiosk = @includeInKiosk')
    params.includeInKiosk = input.includeInKiosk ? 1 : 0
  }
  if (input.isDemographic !== undefined) {
    updates.push('is_demographic = @isDemographic')
    params.isDemographic = input.isDemographic ? 1 : 0
  }
  if (input.displayOrder !== undefined) {
    updates.push('display_order = @displayOrder')
    params.displayOrder = input.displayOrder
  }
  if (input.scheduleDays !== undefined) {
    updates.push('schedule_days = @scheduleDays')
    params.scheduleDays = JSON.stringify(input.scheduleDays)
  }
  if ('scheduleStartTime' in input) {
    updates.push('schedule_start_time = @scheduleStartTime')
    params.scheduleStartTime = input.scheduleStartTime ?? null
  }
  if ('scheduleEndTime' in input) {
    updates.push('schedule_end_time = @scheduleEndTime')
    params.scheduleEndTime = input.scheduleEndTime ?? null
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE institution_questions SET ${updates.join(', ')} WHERE id = @id`).run(params)
  }

  return getInstitutionQuestions(institutionId).find((q) => q.id === questionId) ?? null
}

export type CreateQuestionInput = {
  questionType: 'single' | 'multiple' | 'text' | 'scale' | 'boolean' | 'star'
  prompt: string
  options: string[]
  includeInKiosk: boolean
  isDemographic: boolean
  displayOrder: number
  scheduleDays?: number[]
  scheduleStartTime?: string | null
  scheduleEndTime?: string | null
}

export function createCustomQuestion(institutionId: number, input: CreateQuestionInput) {
  const db = getDb()
  const institution = db.prepare('SELECT id FROM institutions WHERE id = ?').get(institutionId) as { id: number } | undefined
  if (!institution) {
    throw new Error('Institution not found.')
  }
  const templateKey = `custom-${randomBytes(8).toString('hex')}`
  const result = db
    .prepare(
      `INSERT INTO institution_questions
          (institution_id, template_key, question_type, prompt, options_json,
           include_in_kiosk, is_demographic, display_order, schedule_days, schedule_start_time, schedule_end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      institutionId,
      templateKey,
      input.questionType,
      input.prompt,
      JSON.stringify(input.options),
      input.includeInKiosk ? 1 : 0,
      input.isDemographic ? 1 : 0,
      input.displayOrder,
      JSON.stringify(input.scheduleDays ?? []),
      input.scheduleStartTime ?? null,
      input.scheduleEndTime ?? null,
    )
  const id = Number(result.lastInsertRowid)
  return getInstitutionQuestions(institutionId).find((q) => q.id === id) ?? null
}

export function deleteCustomQuestion(institutionId: number, questionId: number) {
  const db = getDb()
  const question = db
    .prepare('SELECT id, template_key FROM institution_questions WHERE id = ? AND institution_id = ?')
    .get(questionId, institutionId) as { id: number; template_key: string | null } | undefined
  if (!question) {
    throw new Error('Question not found.')
  }
  const templateExists = question.template_key
    ? db.prepare('SELECT id FROM question_templates WHERE template_key = ?').get(question.template_key)
    : null
  if (templateExists) {
    throw new Error('Cannot delete a template-derived question. Use the include toggle instead.')
  }
  db.prepare('DELETE FROM institution_questions WHERE id = ?').run(questionId)
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function getInstitutionLocalTime(institutionId: number) {
  const db = getDb()
  const institution = db
    .prepare('SELECT timezone FROM institutions WHERE id = ?')
    .get(institutionId) as { timezone: string } | undefined
  const timezone = institution?.timezone || 'UTC'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date())
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    day: dayMap[weekday] ?? 0,
    minutes: hour * 60 + minute,
  }
}

function isWithinTimeWindow(currentMinutes: number, startTime: string | null, endTime: string | null) {
  if (!startTime && !endTime) {
    return true
  }

  if (startTime && endTime) {
    const start = timeToMinutes(startTime)
    const end = timeToMinutes(endTime)
    if (start <= end) {
      return currentMinutes >= start && currentMinutes <= end
    }
    return currentMinutes >= start || currentMinutes <= end
  }

  if (startTime) {
    return currentMinutes >= timeToMinutes(startTime)
  }

  return currentMinutes <= timeToMinutes(endTime ?? '23:59')
}

export function getActiveKioskQuestions(institutionId: number) {
  const { day: currentDay, minutes: currentMinutes } = getInstitutionLocalTime(institutionId)

  const questions = getInstitutionQuestions(institutionId)
  return questions.filter((q) => {
    if (!q.isActive) return false
    if (!q.includeInKiosk) return false
    if (q.scheduleDays.length > 0 && !q.scheduleDays.includes(currentDay)) return false
    return isWithinTimeWindow(currentMinutes, q.scheduleStartTime, q.scheduleEndTime)
  })
}

export function getKioskStatus(institutionSlug: string) {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, color_scheme AS colorScheme
       FROM institutions WHERE slug = ?`,
    )
    .get(institutionSlug) as {
    id: number
    name: string
    slug: string
    timezone: string
    kioskModeEnabled: number
    colorScheme: string
  } | undefined
  if (!row) {
    return null
  }
  return {
    enabled: Boolean(row.kioskModeEnabled),
    institutionId: row.id,
    name: row.name,
    timezone: row.timezone,
    colorScheme: row.colorScheme,
    questions: getActiveKioskQuestions(row.id),
  }
}

export function startKioskSession(institutionId: number) {
  const db = getDb()
  const institution = db
    .prepare('SELECT id, kiosk_mode_enabled AS kioskModeEnabled FROM institutions WHERE id = ?')
    .get(institutionId) as { id: number; kioskModeEnabled: number } | undefined
  if (!institution) {
    throw new Error('Institution not found.')
  }
  if (!institution.kioskModeEnabled) {
    throw new Error('Kiosk mode is not enabled for this institution.')
  }
  const sessionToken = randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO kiosk_sessions (institution_id, session_token) VALUES (?, ?)`,
  ).run(institutionId, sessionToken)
  const questions = getActiveKioskQuestions(institutionId)
  return { sessionToken, institutionId, questions }
}

export function submitKioskAnswer(sessionToken: string, questionKey: string, answerJson: string) {
  const db = getDb()
  return db.transaction(() => {
    const session = db
      .prepare(
        `SELECT id, institution_id AS institutionId FROM kiosk_sessions
         WHERE session_token = ? AND completed_at IS NULL`,
      )
      .get(sessionToken) as { id: number; institutionId: number } | undefined
    if (!session) {
      throw new Error('Invalid or completed session.')
    }
    db.prepare(
      `INSERT INTO responses (institution_id, question_key, answer_json, kiosk_session_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(kiosk_session_id, question_key) WHERE kiosk_session_id IS NOT NULL
       DO UPDATE SET
         answer_json = excluded.answer_json,
         created_at = CURRENT_TIMESTAMP`,
    ).run(session.institutionId, questionKey, answerJson, session.id)
    return { recorded: true }
  })()
}

export function completeKioskSession(sessionToken: string, demographicData: Record<string, string>) {
  const db = getDb()
  const session = db
    .prepare(`SELECT id FROM kiosk_sessions WHERE session_token = ? AND completed_at IS NULL`)
    .get(sessionToken) as { id: number } | undefined
  if (!session) {
    throw new Error('Invalid or already completed session.')
  }

  const sanitizedDemographics = Object.create(null) as Record<string, string>
  for (const [key, value] of Object.entries(demographicData)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      continue
    }
    sanitizedDemographics[key] = value
  }

  db.prepare(
    `UPDATE kiosk_sessions SET demographic_data = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(JSON.stringify(sanitizedDemographics), session.id)
  return { completed: true }
}

export function runRetentionCleanup(retentionDays = 90) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw new Error('Retention cleanup requires a retention window from 1 to 90 days.')
  }

  const db = getDb()
  return db.transaction(() => {
    const cutoffModifier = `-${retentionDays} days`
    const responses = db
      .prepare(`DELETE FROM responses WHERE datetime(created_at) < datetime('now', ?)`)
      .run(cutoffModifier).changes
    const kioskSessions = db
      .prepare(`DELETE FROM kiosk_sessions WHERE datetime(started_at) < datetime('now', ?)`)
      .run(cutoffModifier).changes
    const loginChallenges = db
      .prepare(
        `DELETE FROM login_challenges
         WHERE consumed_at IS NOT NULL
            OR datetime(expires_at) < datetime('now')
            OR datetime(created_at) < datetime('now', ?)`,
      )
      .run(cutoffModifier).changes

    return {
      retentionDays,
      responses,
      kioskSessions,
      loginChallenges,
    }
  })()
}

export function getInstitutionAnalytics(institutionId: number, options: { from?: string; to?: string } = {}) {
  const db = getDb()

  const fromClause = options.from ? `AND date(r.created_at) >= ?` : ''
  const toClause = options.to ? `AND date(r.created_at) <= ?` : ''
  const dateParams: string[] = []
  if (options.from) dateParams.push(options.from)
  if (options.to) dateParams.push(options.to)

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS total FROM responses r WHERE r.institution_id = ? ${fromClause} ${toClause}`,
    )
    .get(institutionId, ...dateParams) as { total: number }
  const totalResponses = totalRow.total

  const responsesByQuestionRaw = db
    .prepare(
      `SELECT r.question_key AS questionKey, r.answer_json AS answerJson, COUNT(*) AS count
       FROM responses r
       WHERE r.institution_id = ? ${fromClause} ${toClause}
       GROUP BY r.question_key, r.answer_json
       ORDER BY r.question_key, count DESC`,
    )
    .all(institutionId, ...dateParams) as Array<{ questionKey: string; answerJson: string; count: number }>

  const questions = getInstitutionQuestions(institutionId)
  const questionMap = new Map(questions.map((q) => [q.templateKey ?? `iq-${q.id}`, q]))

  const byQuestion = new Map<string, Array<{ answer: string; count: number }>>()
  for (const row of responsesByQuestionRaw) {
    if (!byQuestion.has(row.questionKey)) byQuestion.set(row.questionKey, [])
    byQuestion.get(row.questionKey)!.push({ answer: row.answerJson, count: row.count })
  }

  const responsesByQuestion = Array.from(byQuestion.entries()).map(([questionKey, responses]) => {
    const q = questionMap.get(questionKey)
    return {
      questionKey,
      prompt: q?.prompt ?? questionKey,
      questionType: q?.questionType ?? 'unknown',
      responses,
    }
  })

  const responsesPerDay = db
    .prepare(
      `SELECT date(r.created_at) AS date, COUNT(*) AS count
       FROM responses r
       WHERE r.institution_id = ? ${fromClause} ${toClause}
         AND date(r.created_at) >= date('now', '-90 days')
       GROUP BY date(r.created_at)
       ORDER BY date ASC`,
    )
    .all(institutionId, ...dateParams) as Array<{ date: string; count: number }>

  const demographicQuestions = questions.filter((q) => q.isDemographic)
  const demoKeys = demographicQuestions.map((q) => q.templateKey ?? `iq-${q.id}`)

  const demographicBreakdown = responsesByQuestion.filter((rq) => demoKeys.includes(rq.questionKey))

  return { totalResponses, responsesByQuestion, responsesPerDay, demographicBreakdown }
}

export function getCrossTabulation(institutionId: number, primaryQuestionKey: string, demographicQuestionKey: string) {
  const db = getDb()

  const rows = db
    .prepare(
      `SELECT p.answer_json AS primaryAnswer, d.answer_json AS demoAnswer, COUNT(*) AS count
       FROM responses p
       JOIN responses d ON d.kiosk_session_id = p.kiosk_session_id
         AND d.question_key = ?
         AND d.institution_id = ?
       WHERE p.question_key = ? AND p.institution_id = ? AND p.kiosk_session_id IS NOT NULL
       GROUP BY p.answer_json, d.answer_json
       ORDER BY p.answer_json, d.answer_json`,
    )
    .all(
      demographicQuestionKey,
      institutionId,
      primaryQuestionKey,
      institutionId,
    ) as Array<{ primaryAnswer: string; demoAnswer: string; count: number }>

  const result = rows.map((row) => ({
    primaryAnswer: row.primaryAnswer,
    demoAnswer: row.demoAnswer,
    count: row.count < 5 ? ('< 5' as const) : row.count,
  }))

  return { primaryQuestionKey, demographicQuestionKey, cells: result }
}

export async function sendTestSmtpEmail(toAddress: string) {
  const smtp = getSmtpSettings()
  if (!smtp.serverAddress || !smtp.username) {
    return { delivered: false, message: 'SMTP is not configured; email sending skipped.' }
  }

  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    host: smtp.serverAddress,
    port: smtp.port,
    secure: smtp.secureLoginType === 'ssl',
    auth: {
      user: smtp.username,
      pass: (getDb().prepare('SELECT password FROM smtp_settings WHERE id = 1').get() as { password: string } | undefined)?.password ?? '',
    },
    ...(smtp.secureLoginType === 'starttls' ? { requireTLS: true } : {}),
  })

  await transport.sendMail({
    from: smtp.sendAddress || smtp.username,
    to: toAddress,
    subject: 'Qglimpse SMTP test',
    text: 'This is a test email from Qglimpse. Your SMTP configuration is working correctly.',
  })

  return { delivered: true, message: `Test email sent to ${toAddress}.` }
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
      currentStep: 'Step 10 release prep',
      nextStep: 'v0.0.1 released',
      questionBankSeeded: demographicsTemplates.length + insightTemplates.length,
    },
    authCore: {
      supportedRoles: ['root', 'institution_admin', 'institution_user', 'institution_kiosk'],
      userStatuses,
      turnstileSiteKey: config.turnstile.siteKey,
      turnstileRequired: Boolean(config.turnstile.secretKey),
    },
    questionTypes: ['single', 'multiple', 'text', 'scale', 'boolean', 'star'],
  }
}
