import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-db-encryption-test-'))
const databasePath = path.join(tempDir, 'quickglimpse-encrypted.db')
const encryptionKey = 'test-db-key-that-must-open-the-database'

process.env.QUICKGLIMPSE_DB_PATH = databasePath
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.QUICKGLIMPSE_DB_ENCRYPTION_KEY = encryptionKey
process.env.QUICKGLIMPSE_BASE_URL = 'http://localhost:3000'
process.env.PORT = '3000'
process.env.QUICKGLIMPSE_TRUST_PROXY = 'false'
process.env.QUICKGLIMPSE_SESSION_TTL_MS = '86400000'
process.env.SMTP_PORT = '587'
process.env.SMTP_SECURE_LOGIN_TYPE = 'starttls'
process.env.TURNSTILE_SITE_KEY = ''
process.env.TURNSTILE_SECRET_KEY = ''
process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD = 'ChangeMeRoot123!'
process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD = 'ChangeMeInstitution123!'

const plaintextDb = new Database(databasePath)
plaintextDb.exec(`
  CREATE TABLE plaintext_marker (value TEXT NOT NULL);
  INSERT INTO plaintext_marker (value) VALUES ('preserved');
`)
plaintextDb.close()

const { getDb } = await import('../dist/db.js')

function openWithKey(key) {
  const db = new Database(databasePath)
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
  db.key(Buffer.from(key, 'utf8'))
  return db
}

test('database startup refuses plaintext storage before encrypted open', () => {
  assert.throws(() => getDb(), /Refusing to open plaintext SQLite database/)
  const fileHeader = fs.readFileSync(databasePath).subarray(0, 16).toString('utf8')
  assert.equal(fileHeader, 'SQLite format 3\0')
  fs.rmSync(databasePath)
})

test('database startup applies encryption key for all application queries', () => {
  const db = getDb()
  const institutionFromAppDb = db.prepare('SELECT slug FROM institutions ORDER BY id LIMIT 1').get()
  assert.equal(institutionFromAppDb.slug, 'downtown-clinic')
  db.close()

  const fileHeader = fs.readFileSync(databasePath).subarray(0, 16).toString('utf8')
  assert.notEqual(fileHeader, 'SQLite format 3\0')

  assert.throws(() => {
    const unkeyed = new Database(databasePath)
    try {
      unkeyed.prepare('SELECT count(*) AS count FROM sqlite_master').get()
    } finally {
      unkeyed.close()
    }
  }, /file is not a database/)

  assert.throws(() => {
    const wrongKey = openWithKey('wrong-key')
    try {
      wrongKey.prepare('SELECT count(*) AS count FROM sqlite_master').get()
    } finally {
      wrongKey.close()
    }
  }, /file is not a database/)

  const keyed = openWithKey(encryptionKey)
  try {
    const institution = keyed.prepare('SELECT slug FROM institutions ORDER BY id LIMIT 1').get()
    assert.equal(institution.slug, 'downtown-clinic')
    const migration = keyed.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()
    assert.equal(migration.version, 4)
  } finally {
    keyed.close()
  }
})
