import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function productionEnv(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-production-config-test-'))
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3000',
    QUICKGLIMPSE_BASE_URL: 'https://qglimpse.example.com',
    QUICKGLIMPSE_TRUST_PROXY: '1',
    QUICKGLIMPSE_DATA_DIR: tempDir,
    QUICKGLIMPSE_DB_PATH: path.join(tempDir, 'qglimpse.db'),
    QUICKGLIMPSE_DB_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    QUICKGLIMPSE_SESSION_SECRET: 'abcdef0123456789abcdef0123456789',
    QUICKGLIMPSE_SESSION_TTL_MS: '86400000',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
    SMTP_USERNAME: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password',
    SMTP_SEND_ADDRESS: 'noreply@example.com',
    SMTP_SERVER_ADDRESS: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_SECURE_LOGIN_TYPE: 'starttls',
    ...overrides,
  }
}

function runInline(script, env) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  })
}

function runInlineFrom(cwd, script, env) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    env,
    encoding: 'utf8',
  })
}

test('production config rejects unsafe deployment settings', () => {
  const result = runInline(
    "await import('./dist/config.js')",
    productionEnv({
      QUICKGLIMPSE_BASE_URL: 'http://localhost:3000',
    }),
  )

  assert.notEqual(result.status, 0)
  assert.match(`${result.stderr}${result.stdout}`, /QUICKGLIMPSE_BASE_URL must use https:\/\/ in production/)
})

test('relative data paths resolve from repository root across workspace commands', () => {
  const repoRoot = path.resolve(process.cwd(), '..', '..')
  const result = runInlineFrom(
    process.cwd(),
    `
      const { config } = await import('./dist/config.js')
      console.log(JSON.stringify({
        dataDir: config.dataDir,
        databasePath: config.databasePath,
      }))
    `,
    productionEnv({
      QUICKGLIMPSE_DATA_DIR: './data',
      QUICKGLIMPSE_DB_PATH: './data/quickglimpse.db',
    }),
  )

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout.trim())
  assert.deepEqual(output, {
    dataDir: path.join(repoRoot, 'data'),
    databasePath: path.join(repoRoot, 'data', 'quickglimpse.db'),
  })
})

test('production database startup records schema version and does not seed live users', () => {
  const result = runInline(
    `
      const { getDb } = await import('./dist/db.js')
      const db = getDb()
      const users = db.prepare('SELECT COUNT(*) AS count FROM users').get()
      const migration = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()
      console.log(JSON.stringify({ users: users.count, version: migration.version }))
      db.close()
    `,
    productionEnv(),
  )

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout.trim())
  assert.deepEqual(output, { users: 0, version: 4 })
})

test('production database startup refuses plaintext sqlite files', () => {
  const env = productionEnv()
  const result = runInline(
    `
      const Database = (await import('better-sqlite3-multiple-ciphers')).default
      const plaintext = new Database(process.env.QUICKGLIMPSE_DB_PATH)
      plaintext.exec('CREATE TABLE plaintext_marker (value TEXT NOT NULL)')
      plaintext.close()
      const { getDb } = await import('./dist/db.js')
      getDb()
    `,
    env,
  )

  assert.notEqual(result.status, 0)
  assert.match(`${result.stderr}${result.stdout}`, /Refusing to open plaintext SQLite database/)
})

test('production database startup migrates legacy auth session idle timestamps', () => {
  const env = productionEnv()
  const result = runInline(
    `
      const Database = (await import('better-sqlite3-multiple-ciphers')).default
      const legacyDb = new Database(process.env.QUICKGLIMPSE_DB_PATH)
      legacyDb.pragma("cipher = 'sqlcipher'")
      legacyDb.pragma('legacy = 4')
      legacyDb.key(Buffer.from(process.env.QUICKGLIMPSE_DB_ENCRYPTION_KEY, 'utf8'))
      legacyDb.exec(\`
        CREATE TABLE auth_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO auth_sessions (user_id, token_hash, expires_at, created_at)
        VALUES (1, 'legacy-token-hash', '2099-01-01T00:00:00.000Z', '2026-01-01 00:00:00');
      \`)
      legacyDb.close()

      const { getDb } = await import('./dist/db.js')
      const db = getDb()
      const columns = db.prepare('PRAGMA table_info(auth_sessions)').all()
      const row = db.prepare("SELECT last_seen_at AS lastSeenAt FROM auth_sessions WHERE token_hash = 'legacy-token-hash'").get()
      console.log(JSON.stringify({
        hasLastSeenAt: columns.some((column) => column.name === 'last_seen_at'),
        lastSeenAt: row.lastSeenAt,
      }))
      db.close()
    `,
    env,
  )

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout.trim())
  assert.deepEqual(output, { hasLastSeenAt: true, lastSeenAt: '2026-01-01 00:00:00' })
})
