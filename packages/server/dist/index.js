import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { authenticateSession, ensureSeedCredentials, listUsers, loginUser, logoutSession, registerUser, updateUserStatus, userRoles, userStatuses, verifyTurnstileToken, } from './auth.js';
import { buildBootstrapPayload, createLoginChallenge, getRootOverview, getSmtpSettings, toggleInstitutionKioskMode, updateSmtpSettings, } from './services.js';
import { config } from './config.js';
import { getDb } from './db.js';
getDb();
ensureSeedCredentials();
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
    turnstileToken: z.string().min(1),
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    turnstileToken: z.string().min(1),
});
const updateUserStatusSchema = z.object({
    status: z.enum(userStatuses),
});
const webDistPath = path.resolve(import.meta.dirname, '../../web/dist');
const authChallengeLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
});
const authCoreLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
const spaShellLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
});
const fallbackLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
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
export function createApp() {
    const app = express();
    app.use(express.json());
    app.get('/readyz', (_req, res) => {
        res.json({ status: 'ok', version: config.version, timestamp: new Date().toISOString() });
    });
    app.get('/api/bootstrap', (_req, res) => {
        res.json(buildBootstrapPayload());
    });
    app.get('/api/root/overview', (_req, res) => {
        res.json(getRootOverview());
    });
    app.get('/api/settings/smtp', (_req, res) => {
        res.json(getSmtpSettings());
    });
    app.put('/api/settings/smtp', (req, res) => {
        const parsed = smtpSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid SMTP settings payload.' });
        }
        return res.json(updateSmtpSettings(parsed.data));
    });
    app.post('/api/institutions/:id/kiosk-mode', (req, res) => {
        const parsed = kioskSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid kiosk mode payload.' });
        }
        const institution = toggleInstitutionKioskMode(Number(req.params.id), parsed.data.enabled);
        if (!institution) {
            return res.status(404).json({ error: 'Institution not found.' });
        }
        return res.json(institution);
    });
    app.get('/api/auth/turnstile', (_req, res) => {
        res.json({
            siteKey: config.turnstile.siteKey,
            requiresRemoteValidation: Boolean(config.turnstile.secretKey),
            devBypassTokenHint: config.turnstile.secretKey ? null : config.turnstile.devBypassToken,
        });
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
            });
            return res.status(200).json(session);
        }
        catch (error) {
            return res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed.' });
        }
    });
    app.get('/api/auth/session', authCoreLimiter, (req, res) => {
        const token = extractBearerToken(req.header('authorization'));
        if (!token) {
            return res.status(401).json({ error: 'Missing bearer token.' });
        }
        const session = authenticateSession(token);
        if (!session) {
            return res.status(401).json({ error: 'Session is invalid or expired.' });
        }
        return res.json(session);
    });
    app.post('/api/auth/logout', authCoreLimiter, (req, res) => {
        const token = extractBearerToken(req.header('authorization'));
        if (!token) {
            return res.status(401).json({ error: 'Missing bearer token.' });
        }
        logoutSession(token);
        return res.status(204).send();
    });
    app.get('/api/auth/users', authCoreLimiter, (req, res) => {
        const token = extractBearerToken(req.header('authorization'));
        if (!token) {
            return res.status(401).json({ error: 'Missing bearer token.' });
        }
        const session = authenticateSession(token);
        if (!session || session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        return res.json({ users: listUsers() });
    });
    app.patch('/api/auth/users/:id/status', authCoreLimiter, (req, res) => {
        const token = extractBearerToken(req.header('authorization'));
        if (!token) {
            return res.status(401).json({ error: 'Missing bearer token.' });
        }
        const session = authenticateSession(token);
        if (!session || session.user.role !== 'root') {
            return res.status(403).json({ error: 'Root access required.' });
        }
        const parsed = updateUserStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid user status payload.' });
        }
        try {
            const user = updateUserStatus(Number(req.params.id), parsed.data.status);
            return res.json({ user });
        }
        catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update user status.' });
        }
    });
    app.post('/api/auth/challenges', authChallengeLimiter, (req, res) => {
        const parsed = loginChallengeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid login challenge request.' });
        }
        return res.status(201).json(createLoginChallenge(parsed.data.email, parsed.data.method));
    });
    if (existsSync(webDistPath)) {
        app.use(express.static(webDistPath));
        app.get('*', spaShellLimiter, (_req, res) => {
            res.sendFile(path.join(webDistPath, 'index.html'));
        });
    }
    else {
        app.get('*', fallbackLimiter, (_req, res) => {
            res.type('html').send(`
        <html>
          <body style="font-family: sans-serif; padding: 2rem;">
            <h1>Quick Glimpse server is running</h1>
            <p>The web bundle has not been built yet. Run <code>npm run build</code> from the repository root.</p>
          </body>
        </html>
      `);
        });
    }
    return app;
}
const app = createApp();
app.listen(config.port, () => {
    console.log(`Quick Glimpse listening on http://localhost:${config.port}`);
});
