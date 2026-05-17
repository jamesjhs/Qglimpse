import express from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  authenticateSession,
  changeOwnPassword,
  confirmPasswordReset,
  ensureSeedCredentials,
  listUsers,
  loginUser,
  logoutSession,
  registerUser,
  toggle2FA,
  updateUserEmail,
  updateUserStatus,
  userRoles,
  userStatuses,
  verifyMagicLinkChallenge,
  verifyOtpChallenge,
  verifyTurnstileToken,
} from './auth.js'
import {
  buildBootstrapPayload,
  confirmEmailVerification,
  createCustomQuestion,
  createInstitution,
  createInstitutionUser,
  createLoginChallenge,
  deleteCustomQuestion,
  deleteInstitution,
  getInstitution,
  getInstitutionAnalytics,
  getInstitutionQuestions,
  getCrossTabulation,
  getKioskStatus,
  getRootOverview,
  getSmtpSettings,
  listInstitutions,
  listInstitutionUsers,
  listQuestionTemplates,
  requestEmailVerification,
  requestPasswordReset,
  sendTestSmtpEmail,
  startKioskSession,
  submitKioskAnswer,
  completeKioskSession,
  toggleInstitutionKioskMode,
  updateInstitution,
  updateInstitutionQuestion,
  updateSmtpSettings,
} from './services.js'
import { config } from './config.js'
import { getDb } from './db.js'

getDb()
ensureSeedCredentials()

const kioskSchema = z.object({
  enabled: z.boolean(),
})

const smtpSchema = z.object({
  username: z.string().trim(),
  password: z.string().optional(),
  sendAddress: z.string().trim(),
  serverAddress: z.string().trim(),
  port: z.coerce.number().int().min(1).max(65535),
  secureLoginType: z.enum(['none', 'ssl', 'starttls']),
})

const loginChallengeSchema = z.object({
  email: z.string().email(),
  method: z.enum(['email_code', 'magic_link']),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  role: z.enum(userRoles).default('institution_user'),
  institutionId: z.number().int().nullable().default(null),
  turnstileToken: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().min(1),
})

const updateUserStatusSchema = z.object({
  status: z.enum(userStatuses),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
})

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
})

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10),
})

const emailVerifyConfirmSchema = z.object({
  token: z.string().min(1),
})

const toggle2FASchema = z.object({
  enabled: z.boolean(),
})

const challengeVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
})

const profileEmailSchema = z.object({
  email: z.string().email(),
})

const institutionSchema = z.object({
  name: z.string().trim().min(1),
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  timezone: z.string().trim().min(1).default('UTC'),
})

const createInstitutionUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  role: z.enum(['institution_admin', 'institution_user']).default('institution_user'),
})

const updateQuestionSchema = z.object({
  includeInKiosk: z.boolean().optional(),
  isDemographic: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  scheduleDays: z.array(z.number().int().min(0).max(6)).optional(),
  scheduleStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  scheduleEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
})

const createQuestionSchema = z.object({
  questionType: z.enum(['single', 'multiple', 'text', 'scale', 'boolean', 'star']),
  prompt: z.string().trim().min(1),
  options: z.array(z.string()).default([]),
  includeInKiosk: z.boolean().default(true),
  isDemographic: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
})

const kioskAnswerSchema = z.object({
  sessionToken: z.string().min(1),
  questionKey: z.string().min(1),
  answer: z.unknown(),
})

const kioskCompleteSchema = z.object({
  sessionToken: z.string().min(1),
  demographicData: z.record(z.string(), z.string()).default({}),
})

const smtpTestSchema = z.object({
  toAddress: z.string().email(),
})

const webDistPath = path.resolve(import.meta.dirname, '../../web/dist')
const devMode = !config.turnstile.secretKey

const authChallengeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  skip: () => devMode,
  standardHeaders: true,
  legacyHeaders: false,
})

const authCoreLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  skip: () => devMode,
  standardHeaders: true,
  legacyHeaders: false,
})

const spaShellLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  skip: () => devMode,
  standardHeaders: true,
  legacyHeaders: false,
})

const fallbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  skip: () => devMode,
  standardHeaders: true,
  legacyHeaders: false,
})

const privilegedOpsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  skip: () => devMode,
  standardHeaders: true,
  legacyHeaders: false,
})

function extractBearerToken(headerValue?: string) {
  if (!headerValue) {
    return null
  }

  const [scheme, token] = headerValue.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return null
  }

  return token
}

function parseNumericId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function getAuthenticatedSession(req: express.Request, res: express.Response) {
  const token = extractBearerToken(req.header('authorization'))
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.' })
    return null
  }

  const session = authenticateSession(token)
  if (!session) {
    res.status(401).json({ error: 'Session is invalid or expired.' })
    return null
  }

  return { session, token }
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '50kb' }))
  app.use((req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('x-frame-options', 'DENY')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    )
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
    res.setHeader('cross-origin-opener-policy', 'same-origin')
    res.setHeader('cross-origin-resource-policy', 'same-origin')
    if (req.path.startsWith('/api/')) {
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-robots-tag', 'noindex')
    }
    next()
  })

  app.get('/readyz', (_req, res) => {
    res.json({ status: 'ok', version: config.version, timestamp: new Date().toISOString() })
  })

  app.get('/api/bootstrap', (_req, res) => {
    res.json(buildBootstrapPayload())
  })

  app.get('/api/root/overview', privilegedOpsLimiter, (_req, res) => {
    const auth = getAuthenticatedSession(_req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }
    res.json(getRootOverview())
  })

  app.get('/api/settings/smtp', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }
    res.json(getSmtpSettings())
  })

  app.put('/api/settings/smtp', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }

    const parsed = smtpSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid SMTP settings payload.' })
    }

    return res.json(updateSmtpSettings(parsed.data))
  })

  app.post('/api/institutions/:id/kiosk-mode', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }

    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) {
      return res.status(400).json({ error: 'Invalid institution id.' })
    }

    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }

    const parsed = kioskSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid kiosk mode payload.' })
    }

    const institution = toggleInstitutionKioskMode(institutionId, parsed.data.enabled)
    if (!institution) {
      return res.status(404).json({ error: 'Institution not found.' })
    }

    return res.json(institution)
  })

  app.get('/api/auth/turnstile', (_req, res) => {
    res.json({
      siteKey: config.turnstile.siteKey,
      requiresRemoteValidation: Boolean(config.turnstile.secretKey),
      devBypassTokenHint: config.turnstile.secretKey ? null : config.turnstile.devBypassToken,
    })
  })

  app.post('/api/auth/register', authCoreLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid registration payload.' })
    }

    const turnstileCheck = await verifyTurnstileToken(parsed.data.turnstileToken, req.ip)
    if (!turnstileCheck.success) {
      return res.status(400).json({ error: 'Turnstile verification failed.' })
    }

    try {
      const user = registerUser({
        email: parsed.data.email,
        password: parsed.data.password,
        role: parsed.data.role,
        institutionId: parsed.data.institutionId,
      })

      return res.status(201).json({ user })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to register user.' })
    }
  })

  app.post('/api/auth/login', authCoreLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid login payload.' })
    }

    const turnstileCheck = await verifyTurnstileToken(parsed.data.turnstileToken, req.ip)
    if (!turnstileCheck.success) {
      return res.status(400).json({ error: 'Turnstile verification failed.' })
    }

    try {
      const session = loginUser({
        email: parsed.data.email,
        password: parsed.data.password,
      })
      return res.status(200).json(session)
    } catch (error) {
      return res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed.' })
    }
  })

  app.get('/api/auth/session', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    return res.json(auth.session)
  })

  app.post('/api/auth/logout', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    logoutSession(auth.token)
    return res.status(204).send()
  })

  app.get('/api/auth/users', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }

    return res.json({ users: listUsers() })
  })

  app.patch('/api/auth/users/:id/status', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }

    const userId = parseNumericId(req.params.id)
    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id.' })
    }

    const parsed = updateUserStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid user status payload.' })
    }

    try {
      const user = updateUserStatus(userId, parsed.data.status)
      return res.json({ user })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update user status.' })
    }
  })

  app.post('/api/auth/challenges', authChallengeLimiter, (req, res) => {
    const parsed = loginChallengeSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid login challenge request.' })
    }

    return res.status(201).json(createLoginChallenge(parsed.data.email, parsed.data.method))
  })

  app.post('/api/auth/challenges/verify', authChallengeLimiter, (req, res) => {
    const parsed = challengeVerifySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid challenge verify payload.' })
    }

    try {
      const session = verifyOtpChallenge(parsed.data.email, parsed.data.code)
      return res.json(session)
    } catch (error) {
      return res.status(401).json({ error: error instanceof Error ? error.message : 'Verification failed.' })
    }
  })

  app.get('/api/auth/magic-link', authChallengeLimiter, (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : null
    if (!token) {
      return res.status(400).json({ error: 'Missing token.' })
    }

    try {
      const session = verifyMagicLinkChallenge(token)
      return res.json(session)
    } catch (error) {
      return res.status(401).json({ error: error instanceof Error ? error.message : 'Magic link verification failed.' })
    }
  })

  app.patch('/api/auth/users/:id/2fa', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    const userId = parseNumericId(req.params.id)
    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id.' })
    }

    const parsed = toggle2FASchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid 2FA toggle payload.' })
    }

    try {
      toggle2FA(userId, parsed.data.enabled, auth.session.user)
      return res.json({ userId, twoFaEnabled: parsed.data.enabled })
    } catch (error) {
      return res.status(error instanceof Error && error.message === 'User not found.' ? 404 : 403).json({
        error: error instanceof Error ? error.message : 'Unable to toggle 2FA.',
      })
    }
  })

  app.patch('/api/auth/profile', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    const parsed = profileEmailSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid profile payload.' })
    }

    try {
      updateUserEmail(auth.session.user.id, parsed.data.email)
      return res.json({ email: parsed.data.email.trim().toLowerCase() })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update profile.' })
    }
  })

  app.patch('/api/auth/profile/password', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid password change payload.' })
    }

    try {
      changeOwnPassword(auth.session.user.id, parsed.data.currentPassword, parsed.data.newPassword)
      return res.json({ success: true })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to change password.'
      const status = msg === 'Current password is incorrect.' ? 401 : 400
      return res.status(status).json({ error: msg })
    }
  })

  app.post('/api/auth/password-reset/request', authChallengeLimiter, (req, res) => {
    const parsed = passwordResetRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid password reset request.' })
    }

    const result = requestPasswordReset(parsed.data.email)
    return res.json(result)
  })

  app.post('/api/auth/password-reset/confirm', authChallengeLimiter, (req, res) => {
    const parsed = passwordResetConfirmSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid password reset confirm payload.' })
    }

    try {
      confirmPasswordReset(parsed.data.token, parsed.data.newPassword)
      return res.json({ success: true })
    } catch (error) {
      return res.status(401).json({ error: error instanceof Error ? error.message : 'Password reset failed.' })
    }
  })

  app.post('/api/auth/email-verify/request', authCoreLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    try {
      const result = requestEmailVerification(auth.session.user.id)
      return res.status(201).json(result)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to request verification.' })
    }
  })

  app.post('/api/auth/email-verify/confirm', authChallengeLimiter, (req, res) => {
    const parsed = emailVerifyConfirmSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email verify payload.' })
    }

    try {
      confirmEmailVerification(parsed.data.token)
      return res.json({ success: true })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Email verification failed.' })
    }
  })

  app.get('/api/institutions', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }
    return res.json({ institutions: listInstitutions() })
  })

  app.post('/api/institutions', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }

    const parsed = institutionSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid institution payload.' })
    }

    try {
      const slug = parsed.data.slug ?? parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const institution = createInstitution({ ...parsed.data, slug })
      return res.status(201).json(institution)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create institution.' })
    }
  })

  app.get('/api/institutions/:id', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) {
      return res.status(400).json({ error: 'Invalid institution id.' })
    }

    const institution = getInstitution(institutionId)
    if (!institution) {
      return res.status(404).json({ error: 'Institution not found.' })
    }

    return res.json(institution)
  })

  app.put('/api/institutions/:id', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }

    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) {
      return res.status(400).json({ error: 'Invalid institution id.' })
    }

    const parsed = institutionSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid institution payload.' })
    }

    try {
      const slug = parsed.data.slug ?? parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const institution = updateInstitution(institutionId, { ...parsed.data, slug })
      return res.json(institution)
    } catch (error) {
      return res.status(error instanceof Error && error.message === 'Institution not found.' ? 404 : 400).json({
        error: error instanceof Error ? error.message : 'Unable to update institution.',
      })
    }
  })

  app.delete('/api/institutions/:id', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }

    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) {
      return res.status(400).json({ error: 'Invalid institution id.' })
    }

    try {
      deleteInstitution(institutionId)
      return res.status(204).send()
    } catch (error) {
      const msg = error instanceof Error ? error.message : ''
      const status = msg === 'Institution not found.' ? 404 : msg.startsWith('Cannot delete institution') ? 409 : 400
      return res.status(status).json({ error: msg || 'Unable to delete institution.' })
    }
  })

  app.get('/api/institutions/:id/users', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) {
      return res.status(400).json({ error: 'Invalid institution id.' })
    }

    if (auth.session.user.role === 'institution_user') {
      return res.status(403).json({ error: 'Admin access required.' })
    }

    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }

    return res.json({ users: listInstitutionUsers(institutionId) })
  })

  app.post('/api/institutions/:id/users', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) {
      return
    }

    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) {
      return res.status(400).json({ error: 'Invalid institution id.' })
    }

    if (auth.session.user.role === 'institution_user') {
      return res.status(403).json({ error: 'Admin access required.' })
    }

    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }

    const parsed = createInstitutionUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid user payload.' })
    }

    try {
      const user = createInstitutionUser(institutionId, parsed.data)
      return res.status(201).json({ ...user, mustChangePassword: true })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create user.' })
    }
  })

  app.get('/api/institutions/:id/questions', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }
    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) return res.status(400).json({ error: 'Invalid institution id.' })
    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }
    return res.json({ questions: getInstitutionQuestions(institutionId) })
  })

  app.patch('/api/institutions/:id/questions/:questionId', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }
    const institutionId = parseNumericId(req.params.id)
    const questionId = parseNumericId(req.params.questionId)
    if (!institutionId || !questionId) return res.status(400).json({ error: 'Invalid id.' })
    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }
    const parsed = updateQuestionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid question update payload.' })
    try {
      const question = updateInstitutionQuestion(institutionId, questionId, parsed.data)
      return res.json(question)
    } catch (error) {
      return res.status(404).json({ error: error instanceof Error ? error.message : 'Unable to update question.' })
    }
  })

  app.post('/api/institutions/:id/questions', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }
    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) return res.status(400).json({ error: 'Invalid institution id.' })
    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }
    const parsed = createQuestionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid question payload.' })
    try {
      const question = createCustomQuestion(institutionId, parsed.data)
      return res.status(201).json(question)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create question.' })
    }
  })

  app.delete('/api/institutions/:id/questions/:questionId', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }
    const institutionId = parseNumericId(req.params.id)
    const questionId = parseNumericId(req.params.questionId)
    if (!institutionId || !questionId) return res.status(400).json({ error: 'Invalid id.' })
    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }
    try {
      deleteCustomQuestion(institutionId, questionId)
      return res.status(204).send()
    } catch (error) {
      const msg = error instanceof Error ? error.message : ''
      return res.status(msg === 'Question not found.' ? 404 : 400).json({ error: msg || 'Unable to delete question.' })
    }
  })

  app.get('/api/institutions/:id/analytics', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }
    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) return res.status(400).json({ error: 'Invalid institution id.' })
    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }
    const from = typeof req.query.from === 'string' ? req.query.from : undefined
    const to = typeof req.query.to === 'string' ? req.query.to : undefined
    return res.json(getInstitutionAnalytics(institutionId, { from, to }))
  })

  app.get('/api/institutions/:id/analytics/cross-tab', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
      return res.status(403).json({ error: 'Admin access required.' })
    }
    const institutionId = parseNumericId(req.params.id)
    if (!institutionId) return res.status(400).json({ error: 'Invalid institution id.' })
    if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Institution-scoped access required.' })
    }
    const primaryKey = typeof req.query.primaryKey === 'string' ? req.query.primaryKey : null
    const demographicKey = typeof req.query.demographicKey === 'string' ? req.query.demographicKey : null
    if (!primaryKey || !demographicKey) {
      return res.status(400).json({ error: 'primaryKey and demographicKey are required.' })
    }
    return res.json(getCrossTabulation(institutionId, primaryKey, demographicKey))
  })

  app.get('/api/kiosk/:slug/status', (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug
    if (!slug) return res.status(400).json({ error: 'Invalid slug.' })
    const status = getKioskStatus(slug)
    if (!status) return res.status(404).json({ error: 'Institution not found.' })
    return res.json(status)
  })

  app.post('/api/kiosk/:slug/session', authChallengeLimiter, (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug
    if (!slug) return res.status(400).json({ error: 'Invalid slug.' })
    const status = getKioskStatus(slug)
    if (!status) return res.status(404).json({ error: 'Institution not found.' })
    try {
      const session = startKioskSession(status.institutionId)
      return res.status(201).json(session)
    } catch (error) {
      return res.status(403).json({ error: error instanceof Error ? error.message : 'Unable to start kiosk session.' })
    }
  })

  app.post('/api/kiosk/answer', authChallengeLimiter, (req, res) => {
    const parsed = kioskAnswerSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid answer payload.' })
    try {
      submitKioskAnswer(parsed.data.sessionToken, parsed.data.questionKey, JSON.stringify(parsed.data.answer))
      return res.json({ recorded: true })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to record answer.' })
    }
  })

  app.post('/api/kiosk/complete', authChallengeLimiter, (req, res) => {
    const parsed = kioskCompleteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid complete payload.' })
    try {
      completeKioskSession(parsed.data.sessionToken, parsed.data.demographicData as Record<string, string>)
      return res.json({ completed: true })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to complete session.' })
    }
  })

  app.get('/api/question-templates', privilegedOpsLimiter, (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    return res.json({ templates: listQuestionTemplates() })
  })

  app.post('/api/settings/smtp/test', privilegedOpsLimiter, async (req, res) => {
    const auth = getAuthenticatedSession(req, res)
    if (!auth) return
    if (auth.session.user.role !== 'root') {
      return res.status(403).json({ error: 'Root access required.' })
    }
    const parsed = smtpTestSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid test email payload.' })
    try {
      const result = await sendTestSmtpEmail(parsed.data.toAddress)
      return res.json(result)
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send test email.' })
    }
  })

  // --- Magic link redirect for SPA (before static files)
  app.get('/auth/magic-link', (req, res) => {
    const token = typeof req.query.token === 'string' ? encodeURIComponent(req.query.token) : ''
    res.redirect(`/magic-link?token=${token}`)
  })

  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath))
    app.use(spaShellLimiter, (_req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'))
    })
  } else {
    app.use(fallbackLimiter, (_req, res) => {
      res.type('html').send(`
        <html>
          <body style="font-family: sans-serif; padding: 2rem;">
            <h1>Quick Glimpse server is running</h1>
            <p>The web bundle has not been built yet. Run <code>npm run build</code> from the repository root.</p>
          </body>
        </html>
      `)
    })
  }

  return app
}

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isDirectRun) {
  const app = createApp()
  app.listen(config.port, () => {
    console.log(`Quick Glimpse listening on http://localhost:${config.port}`)
  })
}
