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
  assert.deepEqual(output, { users: 0, version: 2 })
})
