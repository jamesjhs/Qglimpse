import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { config } from './config.js'
import { demographicsTemplates, insightTemplates } from './data/demographics.js'

let database: Database.Database | undefined
const sqlitePlaintextHeader = Buffer.from('SQLite format 3\0')
const currentSchemaVersion = 2

type SeedInstitution = {
  id: number
}

function isPlaintextSqliteDatabase(databasePath: string) {
  if (!existsSync(databasePath) || statSync(databasePath).size < sqlitePlaintextHeader.length) {
    return false
  }

  return readFileSync(databasePath)
    .subarray(0, sqlitePlaintextHeader.length)
    .equals(sqlitePlaintextHeader)
}

function applyEncryptionSettings(db: Database.Database) {
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
}

function verifyDatabaseKey(db: Database.Database) {
  db.prepare('SELECT count(*) AS count FROM sqlite_master').get()
}

function openEncryptedDatabase(databasePath: string) {
  const encryptionKey = Buffer.from(config.databaseEncryptionKey, 'utf8')
  const isExistingPlaintextDatabase = isPlaintextSqliteDatabase(databasePath)
  const db = new Database(databasePath)
  applyEncryptionSettings(db)

  if (isExistingPlaintextDatabase) {
    verifyDatabaseKey(db)
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.pragma('journal_mode = DELETE')
    db.rekey(encryptionKey)
    db.close()

    const encryptedDb = new Database(databasePath)
    applyEncryptionSettings(encryptedDb)
    encryptedDb.key(encryptionKey)
    verifyDatabaseKey(encryptedDb)
    return encryptedDb
  }

  db.key(encryptionKey)
  try {
    verifyDatabaseKey(db)
  } catch (error) {
    db.close()
    throw new Error(
      'Unable to open the encrypted database with QUICKGLIMPSE_DB_ENCRYPTION_KEY. Confirm the configured key matches the database file.',
      { cause: error },
    )
  }

  return db
}

function runMigrations(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      timezone TEXT NOT NULL,
      kiosk_mode_enabled INTEGER NOT NULL DEFAULT 0,
      color_scheme TEXT NOT NULL DEFAULT 'ocean',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      institution_id INTEGER,
      last_login_at TEXT,
      deactivated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      ip TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS question_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_key TEXT NOT NULL UNIQUE,
      question_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS institution_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id INTEGER NOT NULL,
      template_key TEXT NOT NULL,
      question_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(institution_id, template_key),
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS smtp_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      send_address TEXT NOT NULL,
      server_address TEXT NOT NULL,
      port INTEGER NOT NULL,
      secure_login_type TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      method TEXT NOT NULL,
      otp_code_hash TEXT,
      magic_token_hash TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_role TEXT,
      target_user_id INTEGER,
      institution_id INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      kiosk_session_id INTEGER REFERENCES kiosk_sessions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kiosk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id INTEGER NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      demographic_data TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );
  `)

  const userColumns = db
    .prepare(`PRAGMA table_info(users)`)
    .all() as Array<{ name: string }>
  const columnNames = new Set(userColumns.map((column) => column.name))
  if (!columnNames.has('status')) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`)
  }
  if (!columnNames.has('last_login_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT;`)
  }
  if (!columnNames.has('deactivated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN deactivated_at TEXT;`)
  }
  if (!columnNames.has('email_verified')) {
    db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;`)
  }
  if (!columnNames.has('two_fa_enabled')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_fa_enabled INTEGER NOT NULL DEFAULT 0;`)
  }

  const sessionColumns = db
    .prepare(`PRAGMA table_info(auth_sessions)`)
    .all() as Array<{ name: string }>
  const sessionColNames = new Set(sessionColumns.map((c) => c.name))
  if (!sessionColNames.has('last_seen_at')) {
    db.exec(`ALTER TABLE auth_sessions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;`)
  }

  const institutionColumns = db
    .prepare(`PRAGMA table_info(institutions)`)
    .all() as Array<{ name: string }>
  const institutionColNames = new Set(institutionColumns.map((column) => column.name))
  if (!institutionColNames.has('color_scheme')) {
    db.exec(`ALTER TABLE institutions ADD COLUMN color_scheme TEXT NOT NULL DEFAULT 'ocean';`)
  }

  const iqColumns = db
    .prepare(`PRAGMA table_info(institution_questions)`)
    .all() as Array<{ name: string }>
  const iqColNames = new Set(iqColumns.map((c) => c.name))
  if (!iqColNames.has('include_in_kiosk')) {
    db.exec(`ALTER TABLE institution_questions ADD COLUMN include_in_kiosk INTEGER NOT NULL DEFAULT 1;`)
  }
  if (!iqColNames.has('is_demographic')) {
    db.exec(`ALTER TABLE institution_questions ADD COLUMN is_demographic INTEGER NOT NULL DEFAULT 0;`)
  }
  if (!iqColNames.has('display_order')) {
    db.exec(`ALTER TABLE institution_questions ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;`)
  }
  if (!iqColNames.has('schedule_days')) {
    db.exec(`ALTER TABLE institution_questions ADD COLUMN schedule_days TEXT NOT NULL DEFAULT '[]';`)
  }
  if (!iqColNames.has('schedule_start_time')) {
    db.exec(`ALTER TABLE institution_questions ADD COLUMN schedule_start_time TEXT;`)
  }
  if (!iqColNames.has('schedule_end_time')) {
    db.exec(`ALTER TABLE institution_questions ADD COLUMN schedule_end_time TEXT;`)
  }

  const qtColumns = db
    .prepare(`PRAGMA table_info(question_templates)`)
    .all() as Array<{ name: string }>
  const qtColNames = new Set(qtColumns.map((c) => c.name))
  if (!qtColNames.has('is_demographic')) {
    db.exec(`ALTER TABLE question_templates ADD COLUMN is_demographic INTEGER NOT NULL DEFAULT 0;`)
  }

  const respColumns = db
    .prepare(`PRAGMA table_info(responses)`)
    .all() as Array<{ name: string }>
  const respColNames = new Set(respColumns.map((c) => c.name))
  if (!respColNames.has('kiosk_session_id')) {
    db.exec(`ALTER TABLE responses ADD COLUMN kiosk_session_id INTEGER REFERENCES kiosk_sessions(id) ON DELETE SET NULL;`)
  }

  const auditColumns = db
    .prepare(`PRAGMA table_info(audit_events)`)
    .all() as Array<{ name: string }>
  const auditColNames = new Set(auditColumns.map((c) => c.name))
  if (!auditColNames.has('audit_id')) {
    db.exec(`ALTER TABLE audit_events ADD COLUMN audit_id TEXT;`)
  }
  db.exec(`
    UPDATE audit_events
    SET audit_id = 'legacy-' || id
    WHERE audit_id IS NULL OR audit_id = '';
  `)

  db.exec(`
    DELETE FROM responses
    WHERE kiosk_session_id IS NOT NULL
      AND id NOT IN (
        SELECT MAX(id)
        FROM responses
        WHERE kiosk_session_id IS NOT NULL
        GROUP BY kiosk_session_id, question_key
      );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_session_question_unique
      ON responses (kiosk_session_id, question_key)
      WHERE kiosk_session_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_login_challenges_email_method_active
      ON login_challenges (email, method, consumed_at, expires_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email_ip_created
      ON login_attempts (email, ip, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action_created
      ON audit_events (action, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_audit_id
      ON audit_events (audit_id);

    INSERT OR IGNORE INTO schema_migrations (version) VALUES (${currentSchemaVersion});
  `)
}

function seedInstitution(db: Database.Database): SeedInstitution {
  const existing = db.prepare('SELECT id FROM institutions ORDER BY id LIMIT 1').get() as SeedInstitution | undefined
  if (existing) {
    return existing
  }

  const insert = db.prepare(
    'INSERT INTO institutions (name, slug, timezone, kiosk_mode_enabled, color_scheme) VALUES (?, ?, ?, ?, ?)',
  )
  const result = insert.run('Downtown Clinic', 'downtown-clinic', 'America/New_York', 1, 'ocean')

  return { id: Number(result.lastInsertRowid) }
}

function seedUsers(db: Database.Database, institutionId: number) {
  db.prepare('INSERT OR IGNORE INTO users (email, role, institution_id) VALUES (?, ?, ?)').run(
    'root@quickglimpse.local',
    'root',
    null,
  )
  db.prepare('INSERT OR IGNORE INTO users (email, role, institution_id) VALUES (?, ?, ?)').run(
    'institution-admin@quickglimpse.local',
    'institution_admin',
    institutionId,
  )
}

function seedQuestionTemplates(db: Database.Database, institutionId: number) {
  const insertTemplate = db.prepare(
    `INSERT OR IGNORE INTO question_templates (template_key, question_type, prompt, options_json, is_demographic)
     VALUES (@template_key, @question_type, @prompt, @options_json, @is_demographic)`,
  )
  const cloneTemplate = db.prepare(
    `INSERT OR IGNORE INTO institution_questions
       (institution_id, template_key, question_type, prompt, options_json, is_demographic, display_order)
     VALUES (@institution_id, @template_key, @question_type, @prompt, @options_json, @is_demographic, @display_order)`,
  )
  const updateDemographicFlag = db.prepare(
    `UPDATE question_templates SET is_demographic = 1 WHERE template_key = ?`,
  )

  let order = 0
  for (const template of demographicsTemplates) {
    const row = {
      template_key: template.key,
      question_type: template.type,
      prompt: template.prompt,
      options_json: JSON.stringify(template.options),
      is_demographic: 1,
    }
    insertTemplate.run(row)
    updateDemographicFlag.run(template.key)
    cloneTemplate.run({ ...row, institution_id: institutionId, display_order: order++ })
  }

  for (const template of insightTemplates) {
    const row = {
      template_key: template.key,
      question_type: template.type,
      prompt: template.prompt,
      options_json: JSON.stringify(template.options),
      is_demographic: 0,
    }
    insertTemplate.run(row)
    cloneTemplate.run({ ...row, institution_id: institutionId, display_order: order++ })
  }
}

function seedSmtpSettings(db: Database.Database) {
  db.prepare(
    `INSERT OR IGNORE INTO smtp_settings (id, username, password, send_address, server_address, port, secure_login_type)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    config.smtpSeed.username,
    config.smtpSeed.password,
    config.smtpSeed.sendAddress,
    config.smtpSeed.serverAddress,
    config.smtpSeed.port,
    config.smtpSeed.secureLoginType,
  )
}

export function getDb() {
  if (database) {
    return database
  }

  mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const db = openEncryptedDatabase(config.databasePath)
  db.pragma('journal_mode = WAL')
  runMigrations(db)
  const institution = seedInstitution(db)
  if (!config.isProduction) {
    seedUsers(db, institution.id)
  }
  seedQuestionTemplates(db, institution.id)
  seedSmtpSettings(db)
  database = db
  return db
}
