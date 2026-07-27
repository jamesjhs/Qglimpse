import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticateSession, changeRequiredPassword, changeOwnPassword, confirmPasswordReset, ensureInitialAdminLogin, deleteManagedUser, ensureSeedCredentials, listUsers, loginUser, logoutSession, registerUser, toggle2FA, updateManagedUser, updateUserEmail, updateUserStatus, userRoles, userStatuses, verifyMagicLinkChallenge, verifyOtpChallenge, verifyTurnstileToken, } from './auth.js';
import { buildBootstrapPayload, confirmEmailVerification, createCustomQuestion, createInstitution, createInstitutionUser, createLoginChallenge, deleteCustomQuestion, deleteInstitution, getInstitution, getInstitutionAnalytics, getInstitutionQuestions, getCrossTabulation, getKioskStatus, getRootOverview, getSmtpSettings, listInstitutions, listInstitutionUsers, listQuestionTemplates, requestEmailVerification, requestPasswordReset, runRetentionCleanup, sendTestSmtpEmail, setInstitutionColorScheme, startKioskSession, submitKioskAnswer, completeKioskSession, toggleInstitutionKioskMode, updateInstitution, updateInstitutionQuestion, updateInstitutionStatus, updateSmtpSettings, } from './services.js';
import { config } from './config.js';
import { getDb } from './db.js';
import { sendOperationalEmail } from './mailer.js';
import { recordAuditEvent } from './audit.js';
function writeStartupLog(level, message, details = {}) {
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        service: 'qglimpse-server',
        phase: 'startup',
        message,
        ...details,
    };
    const line = JSON.stringify(redactForLog(payload));
    if (level === 'error') {
        console.error(line);
    }
    else {
        console.log(line);
    }
}
function initializeRuntime() {
    writeStartupLog('info', 'Configuration loaded.', {
        node: process.version,
        pid: process.pid,
        cwd: process.cwd(),
        argv: process.argv,
        nodeEnv: config.nodeEnv,
        isProduction: config.isProduction,
        port: config.port,
        baseUrl: config.baseUrl,
        trustProxy: config.trustProxy,
        dataDir: config.dataDir,
        databasePath: config.databasePath,
    });
    writeStartupLog('info', 'Opening database.');
    getDb();
    writeStartupLog('info', 'Database opened and migrations completed.');
    writeStartupLog('info', 'Running retention cleanup.');
    runRetentionCleanup();
    writeStartupLog('info', 'Retention cleanup completed.');
    if (!config.isProduction) {
        writeStartupLog('warn', 'Non-production seed credentials are enabled.');
        ensureSeedCredentials();
    }
}
try {
    initializeRuntime();
}
catch (error) {
    writeStartupLog('error', 'Startup initialization failed.', {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        cause: error instanceof Error && error.cause instanceof Error ? {
            name: error.cause.name,
            message: error.cause.message,
            stack: error.cause.stack,
        } : null,
    });
    throw error;
}
const kioskSchema = z.object({
    enabled: z.boolean(),
});
const smtpSchema = z.object({
    username: z.string().trim(),
    password: z.string().optional(),
    sendAddress: z.string().trim(),
    serverAddress: z.string().trim(),
    port: z.coerce.number().int().min(1).max(65535),
    secureLoginType: z.enum(['none', 'ssl', 'starttls']),
});
const loginChallengeSchema = z.object({
    email: z.string().email(),
    method: z.enum(['email_code', 'magic_link']),
});
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(10),
    role: z.enum(userRoles).default('institution_user'),
    institutionId: z.number().int().nullable().default(null),
    turnstileToken: z.string().default(''),
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    turnstileToken: z.string().default(''),
});
const institutionInterestSchema = z.object({
    institutionName: z.string().trim().min(1).max(160),
    contactName: z.string().trim().min(1).max(120),
    email: z.string().email(),
    notes: z.string().trim().max(1000).default(''),
    turnstileToken: z.string().default(''),
});
const updateUserStatusSchema = z.object({
    status: z.enum(userStatuses),
});
const updateManagedUserSchema = z.object({
    email: z.string().email(),
    role: z.enum(userRoles),
    institutionId: z.number().int().positive().nullable(),
    status: z.enum(userStatuses),
});
const changePasswordSchema = z.object({
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(10),
});
const passwordResetRequestSchema = z.object({
    email: z.string().email(),
});
const passwordResetConfirmSchema = z.object({
    token: z.string().min(1),
    newPassword: z.string().min(10),
});
const emailVerifyConfirmSchema = z.object({
    token: z.string().min(1),
});
const toggle2FASchema = z.object({
    enabled: z.boolean(),
});
const challengeVerifySchema = z.object({
    email: z.string().email(),
    code: z.string().min(1),
});
const profileEmailSchema = z.object({
    email: z.string().email(),
});
function isValidTimezone(timezone) {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
        return true;
    }
    catch {
        return false;
    }
}
const institutionSchema = z.object({
    name: z.string().trim().min(1),
    slug: z
        .string()
        .trim()
        .min(1)
        .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
        .optional(),
    timezone: z.string().trim().min(1).refine(isValidTimezone, 'Choose a valid timezone.').default('UTC'),
    colorScheme: z.enum(['ocean', 'emerald', 'sunset', 'violet']).default('ocean'),
    singleQuestionModeEnabled: z.boolean().default(false),
    qrModeEnabled: z.boolean().default(false),
    retentionDays: z.coerce.number().int().min(1).max(90).default(90),
    kioskIdleResetSeconds: z.coerce.number().int().min(5).max(300).default(10),
    kioskCompletionMessage: z.string().trim().min(1).max(240).default('Your feedback has been recorded.'),
});
function formatInstitutionValidationError(error) {
    const issue = error.issues[0];
    if (issue?.path[0] === 'timezone') {
        return 'Choose a valid timezone from the list.';
    }
    if (issue?.path[0] === 'slug') {
        return 'Use a slug with only lowercase letters, numbers, and hyphens.';
    }
    return 'Please check the institution details and try again.';
}
const institutionStatusSchema = z.object({
    status: z.enum(userStatuses),
});
const institutionColorSchemeSchema = z.object({
    colorScheme: z.enum(['ocean', 'emerald', 'sunset', 'violet']),
});
const createInstitutionUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(10),
    role: z.enum(['institution_admin', 'institution_user', 'institution_kiosk']).default('institution_user'),
});
function formatCreateInstitutionUserValidationError(error) {
    const issue = error.issues[0];
    const field = issue?.path[0];
    if (field === 'email') {
        return 'Please enter a valid email address for the new user.';
    }
    if (field === 'password') {
        return 'Please enter a temporary password that is at least 10 characters long.';
    }
    if (field === 'role') {
        return 'Choose a valid role for the new user.';
    }
    return 'Please check the create user form and try again.';
}
const updateQuestionSchema = z.object({
    includeInKiosk: z.boolean().optional(),
    isDemographic: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
    scheduleDays: z.array(z.number().int().min(0).max(6)).optional(),
    scheduleStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    scheduleEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});
const createQuestionSchema = z.object({
    questionType: z.enum(['single', 'multiple', 'text', 'scale', 'boolean', 'star']),
    prompt: z.string().trim().min(1),
    options: z.array(z.string()).default([]),
    includeInKiosk: z.boolean().default(true),
    isDemographic: z.boolean().default(false),
    displayOrder: z.number().int().default(0),
    scheduleDays: z.array(z.number().int().min(0).max(6)).default([]),
    scheduleStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
    scheduleEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
});
const kioskAnswerSchema = z.object({
    sessionToken: z.string().min(1),
    questionKey: z.string().min(1),
    answer: z.unknown(),
});
const prohibitedDemographicKeys = new Set(['__proto__', 'prototype', 'constructor']);
const demographicKeySchema = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9:_-]+$/)
    .refine((key) => !prohibitedDemographicKeys.has(key), 'Invalid demographic key.');
const kioskCompleteSchema = z.object({
    sessionToken: z.string().min(1),
    demographicData: z.record(demographicKeySchema, z.string().trim().max(256)).default({}),
});
const smtpTestSchema = z.object({
    toAddress: z.string().email(),
});
const webDistPath = path.resolve(import.meta.dirname, '../../web/dist');
const devMode = !config.turnstile.secretKey;
const authChallengeLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5,
    skip: () => devMode,
    standardHeaders: true,
    legacyHeaders: false,
});
const authCoreLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 20,
    skip: () => devMode,
    standardHeaders: true,
    legacyHeaders: false,
});
const kioskRuntimeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    skip: () => devMode,
    standardHeaders: true,
    legacyHeaders: false,
});
const spaShellLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    skip: () => devMode,
    standardHeaders: true,
    legacyHeaders: false,
});
const fallbackLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    skip: () => devMode,
    standardHeaders: true,
    legacyHeaders: false,
});
const privilegedOpsLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 40,
    skip: () => devMode,
    standardHeaders: true,
    legacyHeaders: false,
});
function extractBearerToken(headerValue) {
    if (!headerValue) {
        return null;
    }
    const [scheme, token] = headerValue.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return null;
    }
    return token;
}
function parseNumericId(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}
const sensitiveLogKeyPattern = /(authorization|cookie|password|pass|secret|token|otp|session|smtp|answer|demographic|encryption|credential)/i;
export function redactForLog(value, key = '', seen = new WeakSet()) {
    if (sensitiveLogKeyPattern.test(key)) {
        return '[REDACTED]';
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => redactForLog(item, key, seen));
    }
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
        output[entryKey] = redactForLog(entryValue, entryKey, seen);
    }
    return output;
}
function writeStructuredLog(level, message, details) {
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        service: 'qglimpse-server',
        message,
        ...details,
    };
    console.error(JSON.stringify(redactForLog(payload)));
}
function logErrorSummary(message, details) {
    writeStructuredLog('error', message, details);
}
function describeLoginPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return {
            bodyType: Array.isArray(body) ? 'array' : typeof body,
            fields: null,
        };
    }
    const payload = body;
    return {
        bodyType: 'object',
        fields: {
            email: {
                type: typeof payload.email,
                length: typeof payload.email === 'string' ? payload.email.length : null,
            },
            password: {
                type: typeof payload.password,
                present: typeof payload.password === 'string' && payload.password.length > 0,
                length: typeof payload.password === 'string' ? payload.password.length : null,
            },
            turnstileToken: {
                type: typeof payload.turnstileToken,
                present: typeof payload.turnstileToken === 'string' && payload.turnstileToken.length > 0,
                length: typeof payload.turnstileToken === 'string' ? payload.turnstileToken.length : null,
            },
            keys: Object.keys(payload),
        },
    };
}
async function enforceMinResponseTime(startedAt, minimumMs) {
    const remaining = minimumMs - (Date.now() - startedAt);
    if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
    }
}
function getAuthenticatedSession(req, res) {
    const token = extractBearerToken(req.header('authorization'));
    if (!token) {
        res.status(401).json({ error: 'Missing bearer token.' });
        return null;
    }
    const session = authenticateSession(token);
    if (!session) {
        res.status(401).json({ error: 'Session is invalid or expired.' });
        return null;
    }
    return { session, token };
}
function getRoleRedirectPath(role) {
    if (role === 'institution_kiosk') {
        return '/kiosk';
    }
    if (role === 'root') {
        return '/root';
    }
    return '/app';
}
function hasInstitutionScope(user, institutionId) {
    return user.role === 'root' || user.institutionId === institutionId;
}
function canManageInstitutionSettings(user, institutionId) {
    return user.role === 'root' || (user.role === 'institution_admin' && user.institutionId === institutionId);
}
function canManageQuestionBank(user, institutionId) {
    return (user.role === 'root' ||
        ((user.role === 'institution_admin' || user.role === 'institution_user') && user.institutionId === institutionId));
}
function getManagedUserAccess(actor, targetUserId, input) {
    if (actor.role === 'root') {
        return { allowed: true, institutionId: input?.institutionId ?? null };
    }
    if (actor.role !== 'institution_admin' || !actor.institutionId) {
        return { allowed: false, institutionId: null };
    }
    const target = getDb()
        .prepare('SELECT role, institution_id AS institutionId FROM users WHERE id = ?')
        .get(targetUserId);
    if (!target || target.role === 'root' || target.institutionId !== actor.institutionId) {
        return { allowed: false, institutionId: null };
    }
    if (input && (input.role === 'root' || input.institutionId !== actor.institutionId)) {
        return { allowed: false, institutionId: null };
    }
    return { allowed: true, institutionId: actor.institutionId };
}
export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.use((req, res, next) => {
        const incomingRequestId = req.header('x-request-id');
        req.requestId =
            incomingRequestId && /^[a-zA-Z0-9._:-]{8,128}$/.test(incomingRequestId) ? incomingRequestId : randomUUID();
        res.setHeader('x-request-id', req.requestId);
        next();
    });
    app.use(express.json({ limit: '50kb' }));
    app.use((req, res, next) => {
        const startedAt = Date.now();
        let responseBody;
        const originalJson = res.json.bind(res);
        res.json = ((body) => {
            responseBody = body;
            return originalJson(body);
        });
        res.on('finish', () => {
            if (res.statusCode < 400) {
                return;
            }
            const errorMessage = typeof responseBody === 'object' &&
                responseBody !== null &&
                'error' in responseBody &&
                typeof responseBody.error === 'string'
                ? responseBody.error
                : null;
            logErrorSummary('HTTP request failed', {
                method: req.method,
                path: req.originalUrl,
                requestId: req.requestId,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
                ip: req.ip,
                userAgent: req.get('user-agent') ?? null,
                error: errorMessage,
            });
        });
        next();
    });
    app.use((req, res, next) => {
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('x-frame-options', 'DENY');
        res.setHeader('x-permitted-cross-domain-policies', 'none');
        res.setHeader('referrer-policy', 'no-referrer');
        res.setHeader('origin-agent-cluster', '?1');
        res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; child-src https://challenges.cloudflare.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
        res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
        res.setHeader('cross-origin-opener-policy', 'same-origin');
        res.setHeader('cross-origin-resource-policy', 'same-origin');
        if (req.path.startsWith('/api/')) {
            res.setHeader('cache-control', 'no-store');
            res.setHeader('x-robots-tag', 'noindex');
        }
        next();
    });
    app.use((req, res, next) => {
        if (!/^\/api\/(root|settings|institutions|question-templates|auth\/users|auth\/profile)(\/|$)/.test(req.path)) {
            return next();
        }
        const token = extractBearerToken(req.header('authorization'));
        if (!token) {
            return next();
        }
        const session = authenticateSession(token);
        if (session?.user.role === 'institution_kiosk') {
            return res.status(403).json({ error: 'Kiosk accounts cannot access staff routes.' });
        }
        return next();
    });
    app.get('/readyz', (_req, res) => {
        res.json({ status: 'ok', version: config.version, timestamp: new Date().toISOString() });
    });
    app.get('/api/bootstrap', (_req, res) => {
        res.json(buildBootstrapPayload());
    });
    app.get('/api/root/overview', privilegedOpsLimiter, (_req, res) => {
        const auth = getAuthenticatedSession(_req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        res.json(getRootOverview());
    });
    app.get('/api/settings/smtp', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        res.json(getSmtpSettings());
    });
    app.put('/api/settings/smtp', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const parsed = smtpSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid SMTP settings payload.' });
        }
        const settings = updateSmtpSettings(parsed.data);
        recordAuditEvent({ action: 'smtp_settings_updated', actor: auth.session.user });
        return res.json(settings);
    });
    app.post('/api/institutions/:id/kiosk-mode', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
            return res.status(403).json({ error: 'Admin access required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const parsed = kioskSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid kiosk mode payload.' });
        }
        const institution = toggleInstitutionKioskMode(institutionId, parsed.data.enabled);
        if (!institution) {
            return res.status(404).json({ error: 'Institution not found.' });
        }
        recordAuditEvent({
            action: 'institution_kiosk_mode_changed',
            actor: auth.session.user,
            institutionId,
            metadata: { enabled: parsed.data.enabled },
        });
        return res.json(institution);
    });
    app.post('/api/institutions/:id/color-scheme', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
            return res.status(403).json({ error: 'Admin access required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const parsed = institutionColorSchemeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid color scheme payload.' });
        }
        try {
            const institution = setInstitutionColorScheme(institutionId, parsed.data.colorScheme);
            if (!institution) {
                return res.status(404).json({ error: 'Institution not found.' });
            }
            recordAuditEvent({
                action: 'institution_updated',
                actor: auth.session.user,
                institutionId,
                metadata: { colorScheme: parsed.data.colorScheme },
            });
            return res.json(institution);
        }
        catch (error) {
            return res.status(error instanceof Error && error.message === 'Institution not found.' ? 404 : 400).json({
                error: error instanceof Error ? error.message : 'Unable to update institution.',
            });
        }
    });
    app.get('/api/auth/turnstile', (_req, res) => {
        res.json({
            siteKey: config.turnstile.siteKey,
            requiresRemoteValidation: Boolean(config.turnstile.secretKey),
        });
    });
    app.post('/api/institution-interest', authCoreLimiter, async (req, res) => {
        const parsed = institutionInterestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid interest registration payload.' });
        }
        const turnstileCheck = await verifyTurnstileToken(parsed.data.turnstileToken, req.ip);
        if (!turnstileCheck.success) {
            return res.status(400).json({ error: 'Turnstile verification failed.' });
        }
        return res.status(202).json({ accepted: true });
    });
    app.post('/api/auth/register', authCoreLimiter, async (req, res) => {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid registration payload.' });
        }
        const turnstileCheck = await verifyTurnstileToken(parsed.data.turnstileToken, req.ip);
        if (!turnstileCheck.success) {
            return res.status(400).json({ error: 'Turnstile verification failed.' });
        }
        try {
            const user = registerUser({
                email: parsed.data.email,
                password: parsed.data.password,
                role: parsed.data.role,
                institutionId: parsed.data.institutionId,
            });
            return res.status(201).json({ user });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to register user.' });
        }
    });
    app.post('/api/auth/login', authCoreLimiter, async (req, res) => {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            logErrorSummary('Invalid login payload', {
                ...describeLoginPayload(req.body),
                issues: parsed.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                    message: issue.message,
                })),
            });
            return res.status(400).json({ error: 'Invalid login payload.' });
        }
        const turnstileCheck = await verifyTurnstileToken(parsed.data.turnstileToken, req.ip);
        if (!turnstileCheck.success) {
            return res.status(400).json({ error: 'Turnstile verification failed.' });
        }
        try {
            const session = loginUser({
                email: parsed.data.email,
                password: parsed.data.password,
                ip: req.ip,
            });
            if ('challengePending' in session) {
                await sendOperationalEmail({
                    to: session.email,
                    subject: 'Your Qglimpse sign-in code',
                    text: `Your Qglimpse sign-in code is ${session.delivery.otpCode}. It expires in 10 minutes.`,
                });
                return res.status(200).json({
                    challengePending: true,
                    email: session.email,
                    expiresAt: session.expiresAt,
                });
            }
            return res.status(200).json({ ...session, redirectPath: getRoleRedirectPath(session.user.role) });
        }
        catch (error) {
            return res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed.' });
        }
    });
    app.get('/api/auth/session', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        return res.json({ ...auth.session, redirectPath: getRoleRedirectPath(auth.session.user.role) });
    });
    app.post('/api/auth/logout', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        logoutSession(auth.token);
        return res.status(204).send();
    });
    app.get('/api/auth/users', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        return res.json({ users: listUsers() });
    });
    app.patch('/api/auth/users/:id/status', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const userId = parseNumericId(req.params.id);
        if (!userId) {
            return res.status(400).json({ error: 'Invalid user id.' });
        }
        const parsed = updateUserStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid user status payload.' });
        }
        try {
            const user = updateUserStatus(userId, parsed.data.status);
            recordAuditEvent({
                action: 'user_status_changed',
                actor: auth.session.user,
                targetUserId: user.id,
                institutionId: user.institutionId,
                metadata: { status: parsed.data.status },
            });
            return res.json({ user });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update user status.' });
        }
    });
    app.patch('/api/auth/users/:id', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const userId = parseNumericId(req.params.id);
        if (!userId) {
            return res.status(400).json({ error: 'Invalid user id.' });
        }
        const parsed = updateManagedUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid user payload.' });
        }
        const access = getManagedUserAccess(auth.session.user, userId, parsed.data);
        if (!access.allowed) {
            return res.status(403).json({ error: 'Institution admin or root access required.' });
        }
        try {
            const user = updateManagedUser(userId, parsed.data);
            recordAuditEvent({
                action: 'user_updated',
                actor: auth.session.user,
                targetUserId: user.id,
                institutionId: user.institutionId ?? access.institutionId,
                metadata: {
                    role: user.role,
                    status: user.status,
                    institutionId: user.institutionId,
                },
            });
            return res.json({ user });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'Unable to update user.';
            const status = msg === 'User not found.' || msg === 'Institution not found.' ? 404 : 400;
            return res.status(status).json({ error: msg });
        }
    });
    app.delete('/api/auth/users/:id', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const userId = parseNumericId(req.params.id);
        if (!userId) {
            return res.status(400).json({ error: 'Invalid user id.' });
        }
        const access = getManagedUserAccess(auth.session.user, userId);
        if (!access.allowed) {
            return res.status(403).json({ error: 'Institution admin or root access required.' });
        }
        try {
            deleteManagedUser(userId);
            recordAuditEvent({
                action: 'user_deleted',
                actor: auth.session.user,
                institutionId: access.institutionId,
                metadata: { deletedUserId: userId },
            });
            return res.status(204).send();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'Unable to delete user.';
            const status = msg === 'User not found.' ? 404 : 400;
            return res.status(status).json({ error: msg });
        }
    });
    app.post('/api/auth/challenges', authChallengeLimiter, async (req, res) => {
        const parsed = loginChallengeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid login challenge request.' });
        }
        await createLoginChallenge(parsed.data.email, parsed.data.method);
        return res.status(202).json({ accepted: true });
    });
    app.post('/api/auth/challenges/verify', authChallengeLimiter, (req, res) => {
        const parsed = challengeVerifySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid challenge verify payload.' });
        }
        try {
            const session = verifyOtpChallenge(parsed.data.email, parsed.data.code);
            return res.json({ ...session, redirectPath: getRoleRedirectPath(session.user.role) });
        }
        catch (error) {
            return res.status(401).json({ error: error instanceof Error ? error.message : 'Verification failed.' });
        }
    });
    app.get('/api/auth/magic-link', authChallengeLimiter, (req, res) => {
        const token = typeof req.query.token === 'string' ? req.query.token : null;
        if (!token) {
            return res.status(400).json({ error: 'Missing token.' });
        }
        try {
            const session = verifyMagicLinkChallenge(token);
            return res.json({ ...session, redirectPath: getRoleRedirectPath(session.user.role) });
        }
        catch (error) {
            return res.status(401).json({ error: error instanceof Error ? error.message : 'Magic link verification failed.' });
        }
    });
    app.patch('/api/auth/users/:id/2fa', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const userId = parseNumericId(req.params.id);
        if (!userId) {
            return res.status(400).json({ error: 'Invalid user id.' });
        }
        const parsed = toggle2FASchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid 2FA toggle payload.' });
        }
        try {
            toggle2FA(userId, parsed.data.enabled, auth.session.user);
            return res.json({ userId, twoFaEnabled: parsed.data.enabled });
        }
        catch (error) {
            return res.status(error instanceof Error && error.message === 'User not found.' ? 404 : 403).json({
                error: error instanceof Error ? error.message : 'Unable to toggle 2FA.',
            });
        }
    });
    app.patch('/api/auth/profile', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const parsed = profileEmailSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid profile payload.' });
        }
        try {
            updateUserEmail(auth.session.user.id, parsed.data.email);
            return res.json({ email: parsed.data.email.trim().toLowerCase() });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update profile.' });
        }
    });
    app.patch('/api/auth/profile/password', authCoreLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const parsed = changePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Please enter a new password that is at least 10 characters long.',
            });
        }
        try {
            if (parsed.data.currentPassword) {
                changeOwnPassword(auth.session.user.id, parsed.data.currentPassword, parsed.data.newPassword);
            }
            else {
                changeRequiredPassword(auth.session.user.id, parsed.data.newPassword);
            }
            return res.json({ success: true });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'Unable to change password.';
            const status = msg === 'Current password is incorrect.' ? 401 : 400;
            return res.status(status).json({ error: msg });
        }
    });
    app.post('/api/auth/password-reset/request', authChallengeLimiter, async (req, res) => {
        const parsed = passwordResetRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid password reset request.' });
        }
        const startedAt = Date.now();
        await requestPasswordReset(parsed.data.email);
        await enforceMinResponseTime(startedAt, 150);
        return res.status(202).json({ accepted: true });
    });
    app.post('/api/auth/password-reset/confirm', authChallengeLimiter, (req, res) => {
        const parsed = passwordResetConfirmSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid password reset confirm payload.' });
        }
        try {
            confirmPasswordReset(parsed.data.token, parsed.data.newPassword);
            recordAuditEvent({ action: 'password_reset_completed' });
            return res.json({ success: true });
        }
        catch (error) {
            return res.status(401).json({ error: error instanceof Error ? error.message : 'Password reset failed.' });
        }
    });
    app.post('/api/auth/email-verify/request', authCoreLimiter, async (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        try {
            await requestEmailVerification(auth.session.user.id);
            return res.status(202).json({ accepted: true });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to request verification.' });
        }
    });
    app.post('/api/auth/email-verify/confirm', authChallengeLimiter, (req, res) => {
        const parsed = emailVerifyConfirmSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid email verify payload.' });
        }
        try {
            confirmEmailVerification(parsed.data.token);
            return res.json({ success: true });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Email verification failed.' });
        }
    });
    app.get('/api/institutions', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        return res.json({ institutions: listInstitutions() });
    });
    app.post('/api/institutions', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const parsed = institutionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: formatInstitutionValidationError(parsed.error) });
        }
        try {
            const slug = parsed.data.slug ?? parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const institution = createInstitution({ ...parsed.data, slug });
            recordAuditEvent({ action: 'institution_created', actor: auth.session.user, institutionId: institution.id });
            return res.status(201).json(institution);
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create institution.' });
        }
    });
    app.get('/api/institutions/:id', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        if (!hasInstitutionScope(auth.session.user, institutionId)) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const institution = getInstitution(institutionId);
        if (!institution) {
            return res.status(404).json({ error: 'Institution not found.' });
        }
        return res.json(institution);
    });
    app.put('/api/institutions/:id', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        if (!canManageInstitutionSettings(auth.session.user, institutionId)) {
            return res.status(403).json({ error: 'Institution admin access required.' });
        }
        const parsed = institutionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: formatInstitutionValidationError(parsed.error) });
        }
        try {
            if (auth.session.user.role !== 'root') {
                const existing = getInstitution(institutionId);
                if (!existing) {
                    return res.status(404).json({ error: 'Institution not found.' });
                }
                if (existing.timezone !== parsed.data.timezone) {
                    return res.status(403).json({ error: 'Root access required to change timezone.' });
                }
            }
            const slug = parsed.data.slug ?? parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const institution = updateInstitution(institutionId, { ...parsed.data, slug });
            recordAuditEvent({ action: 'institution_updated', actor: auth.session.user, institutionId });
            return res.json(institution);
        }
        catch (error) {
            return res.status(error instanceof Error && error.message === 'Institution not found.' ? 404 : 400).json({
                error: error instanceof Error ? error.message : 'Unable to update institution.',
            });
        }
    });
    app.patch('/api/institutions/:id/status', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        const parsed = institutionStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid institution status payload.' });
        }
        try {
            const institution = updateInstitutionStatus(institutionId, parsed.data.status);
            recordAuditEvent({
                action: 'institution_status_changed',
                actor: auth.session.user,
                institutionId,
                metadata: { status: parsed.data.status },
            });
            return res.json(institution);
        }
        catch (error) {
            return res.status(error instanceof Error && error.message === 'Institution not found.' ? 404 : 400).json({
                error: error instanceof Error ? error.message : 'Unable to update institution status.',
            });
        }
    });
    app.delete('/api/institutions/:id', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        try {
            deleteInstitution(institutionId);
            recordAuditEvent({
                action: 'institution_deleted',
                actor: auth.session.user,
                metadata: { deletedInstitutionId: institutionId },
            });
            return res.status(204).send();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : '';
            const status = msg === 'Institution not found.' ? 404 : msg.startsWith('Cannot delete institution') ? 409 : 400;
            return res.status(status).json({ error: msg || 'Unable to delete institution.' });
        }
    });
    app.get('/api/institutions/:id/users', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        if (auth.session.user.role === 'institution_user') {
            return res.status(403).json({ error: 'Admin access required.' });
        }
        if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        return res.json({ users: listInstitutionUsers(institutionId) });
    });
    app.post('/api/institutions/:id/users', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth) {
            return;
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId) {
            return res.status(400).json({ error: 'Invalid institution id.' });
        }
        if (auth.session.user.role === 'institution_user') {
            return res.status(403).json({ error: 'Admin access required.' });
        }
        if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const parsed = createInstitutionUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: formatCreateInstitutionUserValidationError(parsed.error) });
        }
        try {
            const user = createInstitutionUser(institutionId, parsed.data);
            recordAuditEvent({
                action: 'user_status_changed',
                actor: auth.session.user,
                targetUserId: user.id,
                institutionId,
                metadata: { created: true, role: user.role },
            });
            return res.status(201).json({ ...user, mustChangePassword: parsed.data.role !== 'institution_kiosk' });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create user.' });
        }
    });
    app.get('/api/institutions/:id/questions', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId)
            return res.status(400).json({ error: 'Invalid institution id.' });
        if (!canManageQuestionBank(auth.session.user, institutionId)) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        return res.json({ questions: getInstitutionQuestions(institutionId) });
    });
    app.patch('/api/institutions/:id/questions/:questionId', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        const institutionId = parseNumericId(req.params.id);
        const questionId = parseNumericId(req.params.questionId);
        if (!institutionId || !questionId)
            return res.status(400).json({ error: 'Invalid id.' });
        if (!canManageQuestionBank(auth.session.user, institutionId)) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const parsed = updateQuestionSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid question update payload.' });
        try {
            const question = updateInstitutionQuestion(institutionId, questionId, parsed.data);
            recordAuditEvent({ action: 'question_updated', actor: auth.session.user, institutionId, metadata: { questionId } });
            return res.json(question);
        }
        catch (error) {
            return res.status(404).json({ error: error instanceof Error ? error.message : 'Unable to update question.' });
        }
    });
    app.post('/api/institutions/:id/questions', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId)
            return res.status(400).json({ error: 'Invalid institution id.' });
        if (!canManageQuestionBank(auth.session.user, institutionId)) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const parsed = createQuestionSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid question payload.' });
        try {
            const question = createCustomQuestion(institutionId, parsed.data);
            recordAuditEvent({
                action: 'question_created',
                actor: auth.session.user,
                institutionId,
                metadata: { questionId: question?.id },
            });
            return res.status(201).json(question);
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create question.' });
        }
    });
    app.delete('/api/institutions/:id/questions/:questionId', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        const institutionId = parseNumericId(req.params.id);
        const questionId = parseNumericId(req.params.questionId);
        if (!institutionId || !questionId)
            return res.status(400).json({ error: 'Invalid id.' });
        if (!canManageQuestionBank(auth.session.user, institutionId)) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        try {
            deleteCustomQuestion(institutionId, questionId);
            recordAuditEvent({ action: 'question_deleted', actor: auth.session.user, institutionId, metadata: { questionId } });
            return res.status(204).send();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : '';
            return res.status(msg === 'Question not found.' ? 404 : 400).json({ error: msg || 'Unable to delete question.' });
        }
    });
    app.get('/api/institutions/:id/analytics', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        if (!['root', 'institution_admin', 'institution_user'].includes(auth.session.user.role)) {
            return res.status(403).json({ error: 'Authenticated institution access required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId)
            return res.status(400).json({ error: 'Invalid institution id.' });
        if (['institution_admin', 'institution_user'].includes(auth.session.user.role) &&
            auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const from = typeof req.query.from === 'string' ? req.query.from : undefined;
        const to = typeof req.query.to === 'string' ? req.query.to : undefined;
        return res.json(getInstitutionAnalytics(institutionId, { from, to }));
    });
    app.get('/api/institutions/:id/analytics/cross-tab', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        if (!['root', 'institution_admin', 'institution_user'].includes(auth.session.user.role)) {
            return res.status(403).json({ error: 'Authenticated institution access required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId)
            return res.status(400).json({ error: 'Invalid institution id.' });
        if (['institution_admin', 'institution_user'].includes(auth.session.user.role) &&
            auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        const primaryKey = typeof req.query.primaryKey === 'string' ? req.query.primaryKey : null;
        const demographicKey = typeof req.query.demographicKey === 'string' ? req.query.demographicKey : null;
        if (!primaryKey || !demographicKey) {
            return res.status(400).json({ error: 'primaryKey and demographicKey are required.' });
        }
        return res.json(getCrossTabulation(institutionId, primaryKey, demographicKey));
    });
    app.get('/api/kiosk/:slug/status', (req, res) => {
        const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
        if (!slug)
            return res.status(400).json({ error: 'Invalid slug.' });
        const status = getKioskStatus(slug);
        if (!status)
            return res.status(404).json({ error: 'Institution not found.' });
        return res.json(status);
    });
    app.post('/api/kiosk/:slug/session', kioskRuntimeLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        if (auth.session.user.role !== 'institution_kiosk') {
            return res.status(403).json({ error: 'Kiosk account required.' });
        }
        const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
        if (!slug)
            return res.status(400).json({ error: 'Invalid slug.' });
        const status = getKioskStatus(slug);
        if (!status)
            return res.status(404).json({ error: 'Institution not found.' });
        if (auth.session.user.institutionId !== status.institutionId) {
            return res.status(403).json({ error: 'Institution-scoped access required.' });
        }
        try {
            const session = startKioskSession(status.institutionId);
            return res.status(201).json(session);
        }
        catch (error) {
            return res.status(403).json({ error: error instanceof Error ? error.message : 'Unable to start kiosk session.' });
        }
    });
    app.post('/api/kiosk/answer', kioskRuntimeLimiter, (req, res) => {
        const parsed = kioskAnswerSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid answer payload.' });
        try {
            submitKioskAnswer(parsed.data.sessionToken, parsed.data.questionKey, JSON.stringify(parsed.data.answer));
            return res.json({ recorded: true });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to record answer.' });
        }
    });
    app.post('/api/kiosk/complete', kioskRuntimeLimiter, (req, res) => {
        const parsed = kioskCompleteSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid complete payload.' });
        try {
            completeKioskSession(parsed.data.sessionToken, parsed.data.demographicData);
            return res.json({ completed: true });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to complete session.' });
        }
    });
    app.get('/api/question-templates', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        return res.json({ templates: listQuestionTemplates() });
    });
    app.get('/api/institutions/:id/export', privilegedOpsLimiter, (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        if (!['root', 'institution_admin'].includes(auth.session.user.role)) {
            return res.status(403).json({ error: 'Export permission required.' });
        }
        const institutionId = parseNumericId(req.params.id);
        if (!institutionId)
            return res.status(400).json({ error: 'Invalid institution id.' });
        if (auth.session.user.role === 'institution_admin' && auth.session.user.institutionId !== institutionId) {
            return res.status(403).json({ error: 'Institution-scoped export required.' });
        }
        return res.status(501).json({ error: 'Exports are not implemented for this release.' });
    });
    app.post('/api/settings/smtp/test', privilegedOpsLimiter, async (req, res) => {
        const auth = getAuthenticatedSession(req, res);
        if (!auth)
            return;
        if (auth.session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const parsed = smtpTestSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid test email payload.' });
        try {
            const result = await sendTestSmtpEmail(parsed.data.toAddress);
            recordAuditEvent({ action: 'smtp_test_sent', actor: auth.session.user });
            return res.json(result);
        }
        catch (error) {
            return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send test email.' });
        }
    });
    // --- Magic link redirect for SPA (before static files)
    app.get('/auth/magic-link', (req, res) => {
        const token = typeof req.query.token === 'string' ? encodeURIComponent(req.query.token) : '';
        res.redirect(`/magic-link?token=${token}`);
    });
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'API route not found.' });
    });
    if (existsSync(webDistPath)) {
        app.use(express.static(webDistPath));
        app.use(spaShellLimiter, (_req, res) => {
            res.sendFile(path.join(webDistPath, 'index.html'));
        });
    }
    else {
        app.use(fallbackLimiter, (_req, res) => {
            res.type('html').send(`
        <html>
          <body style="font-family: sans-serif; padding: 2rem;">
            <h1>Qglimpse server is running</h1>
            <p>The web bundle has not been built yet. Run <code>npm run build</code> from the repository root.</p>
          </body>
        </html>
      `);
        });
    }
    app.use((error, req, res, next) => {
        logErrorSummary('Unhandled route error', {
            method: req.method,
            path: req.originalUrl,
            requestId: req.requestId,
            ip: req.ip,
            errorName: error instanceof Error ? error.name : null,
            errorMessage: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
        });
        if (res.headersSent) {
            return next(error);
        }
        return res.status(500).json({ error: 'Internal server error.' });
    });
    return app;
}
function getRealPath(value) {
    try {
        return realpathSync(value);
    }
    catch {
        return path.resolve(value);
    }
}
function isDirectRun() {
    if (!process.argv[1]) {
        return false;
    }
    return getRealPath(process.argv[1]) === getRealPath(fileURLToPath(import.meta.url));
}
function parseAdminInitArgs(argv) {
    const npmEmail = process.env.npm_config_email;
    const npmPassword = process.env.npm_config_password;
    const positionalArgs = [];
    const options = {
        email: npmEmail && !['true', 'false'].includes(npmEmail) ? npmEmail : undefined,
        password: npmPassword && !['true', 'false'].includes(npmPassword) ? npmPassword : undefined,
        mustChangePassword: process.env.npm_config_must_change_password
            ? process.env.npm_config_must_change_password === 'true'
            : true,
    };
    if (process.env.npm_config_must_change_password &&
        !['true', 'false'].includes(process.env.npm_config_must_change_password)) {
        throw new Error('must-change-password must be true or false.');
    }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) {
            positionalArgs.push(arg);
            continue;
        }
        const equalIndex = arg.indexOf('=');
        const key = (equalIndex >= 0 ? arg.slice(2, equalIndex) : arg.slice(2)).trim();
        const inlineValue = equalIndex >= 0 ? arg.slice(equalIndex + 1) : undefined;
        const value = inlineValue ?? argv[index + 1];
        if (inlineValue === undefined) {
            index += 1;
        }
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for --${key}.`);
        }
        if (key === 'email') {
            options.email = value;
        }
        else if (key === 'password') {
            options.password = value;
        }
        else if (key === 'must-change-password') {
            if (!['true', 'false'].includes(value)) {
                throw new Error('must-change-password must be true or false.');
            }
            options.mustChangePassword = value === 'true';
        }
    }
    const [email, password, mustChangePassword] = positionalArgs;
    options.email ??= email;
    options.password ??= password;
    if (mustChangePassword !== undefined) {
        if (!['true', 'false'].includes(mustChangePassword)) {
            throw new Error('must-change-password must be true or false.');
        }
        options.mustChangePassword = mustChangePassword === 'true';
    }
    return options;
}
function printAdminInitUsage() {
    console.log('Usage: npm run admin:init -- <email> <password> [must-change-password true|false]');
}
function startHttpServer() {
    writeStartupLog('info', 'Creating Express application.');
    const app = createApp();
    writeStartupLog('info', 'Calling app.listen().', { port: config.port });
    const server = app.listen(config.port, () => {
        const address = server.address();
        writeStartupLog('info', 'Qglimpse HTTP server is listening.', {
            port: config.port,
            baseUrl: config.baseUrl,
            address,
        });
        console.log(`Qglimpse listening on ${config.baseUrl} (port ${config.port})`);
    });
    server.on('error', (error) => {
        writeStartupLog('error', 'HTTP server listen error.', {
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            port: config.port,
        });
        process.exitCode = 1;
    });
    return server;
}
if (isDirectRun()) {
    if (process.argv[2] === 'init-admin') {
        try {
            const options = parseAdminInitArgs(process.argv.slice(3));
            if (!options.email || !options.password) {
                printAdminInitUsage();
                process.exitCode = 1;
            }
            else {
                const user = ensureInitialAdminLogin({
                    email: options.email,
                    password: options.password,
                    mustChangePassword: options.mustChangePassword,
                });
                console.log(`Initial admin login configured for ${user.email}.`);
                console.log(`mustChangePassword: ${options.mustChangePassword ? 'true' : 'false'}`);
            }
        }
        catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            printAdminInitUsage();
            process.exitCode = 1;
        }
    }
    else {
        process.on('unhandledRejection', (reason) => {
            logErrorSummary('Unhandled promise rejection', {
                reason: reason instanceof Error ? reason.message : String(reason),
                stack: reason instanceof Error ? reason.stack : null,
            });
        });
        process.on('uncaughtException', (error) => {
            logErrorSummary('Uncaught exception', {
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack,
            });
        });
        startHttpServer();
    }
}
else {
    writeStartupLog('warn', 'Server module imported without starting HTTP listener.', {
        argv: process.argv,
        modulePath: fileURLToPath(import.meta.url),
    });
}
