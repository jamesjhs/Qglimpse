import { createHash, randomBytes, randomInt } from 'node:crypto';
import { getDb } from './db.js';
import { authMethodOptions, demographicsTemplates, foundationChecklist } from './data/demographics.js';
import { config } from './config.js';
const parseOptions = (value) => JSON.parse(value);
export function listInstitutions() {
    const db = getDb();
    return db
        .prepare('SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions ORDER BY name')
        .all();
}
export function listDemographics() {
    const db = getDb();
    const rows = db
        .prepare('SELECT template_key AS templateKey, question_type AS questionType, prompt, options_json AS optionsJson FROM question_templates ORDER BY id')
        .all();
    return rows.map((row) => ({
        templateKey: row.templateKey,
        questionType: row.questionType,
        prompt: row.prompt,
        options: parseOptions(row.optionsJson),
    }));
}
export function getRootOverview() {
    const db = getDb();
    const aggregate = db
        .prepare(`SELECT
        (SELECT COUNT(*) FROM institutions) AS institutionCount,
        (SELECT COUNT(*) FROM users WHERE role = 'institution_admin') AS institutionUserCount,
        (SELECT COUNT(*) FROM question_templates) AS demographicQuestionCount,
        (SELECT COUNT(*) FROM responses) AS responseCount,
        (SELECT COUNT(*) FROM institutions WHERE kiosk_mode_enabled = 1) AS kioskEnabledCount`)
        .get();
    return {
        ...aggregate,
        trendlinesEnabled: false,
    };
}
export function getSmtpSettings() {
    const db = getDb();
    const row = db
        .prepare('SELECT username, password, send_address AS sendAddress, server_address AS serverAddress, port, secure_login_type AS secureLoginType FROM smtp_settings WHERE id = 1')
        .get();
    return {
        username: row?.username ?? '',
        sendAddress: row?.sendAddress ?? '',
        serverAddress: row?.serverAddress ?? '',
        port: row?.port ?? 587,
        secureLoginType: row?.secureLoginType ?? 'starttls',
        passwordSet: Boolean(row?.password),
    };
}
export function updateSmtpSettings(input) {
    const db = getDb();
    const current = db.prepare('SELECT password FROM smtp_settings WHERE id = 1').get();
    db.prepare(`UPDATE smtp_settings
       SET username = @username,
           password = @password,
           send_address = @sendAddress,
           server_address = @serverAddress,
           port = @port,
           secure_login_type = @secureLoginType,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`).run({
        ...input,
        password: input.password && input.password.trim().length > 0 ? input.password : current?.password ?? '',
    });
    return getSmtpSettings();
}
export function toggleInstitutionKioskMode(id, enabled) {
    const db = getDb();
    db.prepare('UPDATE institutions SET kiosk_mode_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return db
        .prepare('SELECT id, name, slug, timezone, kiosk_mode_enabled AS kioskModeEnabled, created_at AS createdAt FROM institutions WHERE id = ?')
        .get(id);
}
export function createLoginChallenge(email, method) {
    const db = getDb();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpCode = method === 'email_code' ? `${randomInt(100000, 999999)}` : null;
    const magicToken = method === 'magic_link' ? randomBytes(24).toString('base64url') : null;
    db.prepare(`INSERT INTO login_challenges (email, method, otp_code_hash, magic_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`).run(email, method, otpCode ? createHash('sha256').update(otpCode).digest('hex') : null, magicToken ? createHash('sha256').update(magicToken).digest('hex') : null, expiresAt);
    return {
        email,
        method,
        expiresAt,
        preview: method === 'email_code'
            ? { otpCode }
            : { magicLink: `${config.baseUrl}/auth/magic-link?token=${encodeURIComponent(magicToken ?? '')}` },
    };
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
            currentStep: 'Step 1 foundation scaffold',
            nextStep: 'Step 2 auth core',
            questionBankSeeded: demographicsTemplates.length,
        },
    };
}
