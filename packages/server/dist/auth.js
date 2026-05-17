import { createHash, randomBytes } from 'node:crypto';
import { compareSync, hashSync } from 'bcryptjs';
import { getDb } from './db.js';
import { config } from './config.js';
export const userRoles = ['root', 'institution_admin', 'institution_user'];
export const userStatuses = ['active', 'suspended', 'deactivated'];
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
function mapUser(row) {
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        institutionId: row.institutionId,
    };
}
function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
function generateSessionToken() {
    return randomBytes(32).toString('base64url');
}
function getSessionExpiryIso() {
    return new Date(Date.now() + config.sessionTtlMs).toISOString();
}
export async function verifyTurnstileToken(token, remoteIp) {
    const trimmedToken = token.trim();
    if (!config.turnstile.secretKey) {
        return {
            success: trimmedToken === config.turnstile.devBypassToken,
            mode: 'dev',
        };
    }
    const params = new URLSearchParams({
        secret: config.turnstile.secretKey,
        response: trimmedToken,
    });
    if (remoteIp) {
        params.set('remoteip', remoteIp);
    }
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: params,
    });
    if (!response.ok) {
        return {
            success: false,
            mode: 'remote',
        };
    }
    const result = (await response.json());
    return {
        success: Boolean(result.success),
        mode: 'remote',
    };
}
export function registerUser(input) {
    const db = getDb();
    const email = normalizeEmail(input.email);
    if (input.role !== 'root' && input.institutionId === null) {
        throw new Error('Institution users must be assigned to an institution.');
    }
    if (input.institutionId !== null) {
        const institution = db.prepare('SELECT id FROM institutions WHERE id = ?').get(input.institutionId);
        if (!institution) {
            throw new Error('Institution not found.');
        }
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        throw new Error('A user with this email already exists.');
    }
    const passwordHash = hashSync(input.password, 12);
    const insertUser = db.prepare('INSERT INTO users (email, role, status, institution_id) VALUES (?, ?, ?, ?)');
    const result = insertUser.run(email, input.role, 'active', input.institutionId);
    const userId = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES (?, ?, ?)').run(userId, passwordHash, input.mustChangePassword ? 1 : 0);
    const createdUser = db
        .prepare(`SELECT id, email, role, status, institution_id AS institutionId, created_at AS createdAt,
              last_login_at AS lastLoginAt, deactivated_at AS deactivatedAt
       FROM users WHERE id = ?`)
        .get(userId);
    return mapUser(createdUser);
}
export function createSessionForUser(user) {
    const db = getDb();
    const token = generateSessionToken();
    const expiresAt = getSessionExpiryIso();
    db.prepare('INSERT INTO auth_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(user.id, hashToken(token), expiresAt);
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    return {
        token,
        expiresAt,
        user,
    };
}
export function loginUser(input) {
    const db = getDb();
    const email = normalizeEmail(input.email);
    const row = db
        .prepare(`SELECT
         u.id,
         u.email,
         u.role,
         u.status,
         u.institution_id AS institutionId,
         u.created_at AS createdAt,
         u.last_login_at AS lastLoginAt,
         u.deactivated_at AS deactivatedAt,
         c.password_hash AS passwordHash
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
       WHERE u.email = ?`)
        .get(email);
    if (!row || !compareSync(input.password, row.passwordHash)) {
        throw new Error('Invalid email or password.');
    }
    if (row.status !== 'active') {
        throw new Error(`Account is ${row.status}.`);
    }
    return createSessionForUser(mapUser(row));
}
export function authenticateSession(token) {
    const db = getDb();
    const row = db
        .prepare(`SELECT
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
         AND datetime(s.expires_at) > datetime('now')`)
        .get(hashToken(token));
    if (!row || row.status !== 'active') {
        return null;
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
    };
}
export function logoutSession(token) {
    const db = getDb();
    db.prepare("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL")
        .run(hashToken(token));
}
export function listUsers() {
    const db = getDb();
    return db
        .prepare(`SELECT id, email, role, status, institution_id AS institutionId, created_at AS createdAt,
              last_login_at AS lastLoginAt, deactivated_at AS deactivatedAt
       FROM users
       ORDER BY id`)
        .all();
}
export function updateUserStatus(id, status) {
    const db = getDb();
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!user) {
        throw new Error('User not found.');
    }
    if (user.role === 'root' && status !== 'active') {
        throw new Error('Root account cannot be disabled.');
    }
    db.prepare(`UPDATE users
        SET status = ?,
            deactivated_at = CASE WHEN ? = 'deactivated' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ?`).run(status, status, id);
    if (status !== 'active') {
        db.prepare("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL")
            .run(id);
    }
    return db
        .prepare(`SELECT id, email, role, status, institution_id AS institutionId, created_at AS createdAt,
              last_login_at AS lastLoginAt, deactivated_at AS deactivatedAt
       FROM users
       WHERE id = ?`)
        .get(id);
}
export function ensureSeedCredentials() {
    const db = getDb();
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
    ];
    for (const seedUser of seedUsers) {
        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(seedUser.email);
        if (!user) {
            continue;
        }
        const existingCredential = db
            .prepare('SELECT user_id FROM user_credentials WHERE user_id = ?')
            .get(user.id);
        if (!existingCredential) {
            db.prepare('INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES (?, ?, ?)').run(user.id, hashSync(seedUser.password, 12), seedUser.mustChangePassword ? 1 : 0);
        }
    }
}
