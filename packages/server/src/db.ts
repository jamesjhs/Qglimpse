import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.js'
import { demographicsTemplates } from './data/demographics.js'

let database: Database.Database | undefined

type SeedInstitution = {
  id: number
}

function runMigrations(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      timezone TEXT NOT NULL,
      kiosk_mode_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      institution_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL
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
      username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      send_address TEXT NOT NULL DEFAULT '',
      server_address TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 587,
      secure_login_type TEXT NOT NULL DEFAULT 'starttls',
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

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );
  `)
}

function seedInstitution(db: Database.Database): SeedInstitution {
  const existing = db.prepare('SELECT id FROM institutions ORDER BY id LIMIT 1').get() as SeedInstitution | undefined
  if (existing) {
    return existing
  }

  const insert = db.prepare(
    'INSERT INTO institutions (name, slug, timezone, kiosk_mode_enabled) VALUES (?, ?, ?, ?)',
  )
  const result = insert.run('Downtown Clinic', 'downtown-clinic', 'America/New_York', 1)

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
    `INSERT OR IGNORE INTO question_templates (template_key, question_type, prompt, options_json)
     VALUES (@template_key, @question_type, @prompt, @options_json)`,
  )
  const cloneTemplate = db.prepare(
    `INSERT OR IGNORE INTO institution_questions (institution_id, template_key, question_type, prompt, options_json)
     VALUES (@institution_id, @template_key, @question_type, @prompt, @options_json)`,
  )

  for (const template of demographicsTemplates) {
    const row = {
      template_key: template.key,
      question_type: template.type,
      prompt: template.prompt,
      options_json: JSON.stringify(template.options),
    }
    insertTemplate.run(row)
    cloneTemplate.run({ ...row, institution_id: institutionId })
  }
}

function seedSmtpSettings(db: Database.Database) {
  db.prepare(
    `INSERT OR IGNORE INTO smtp_settings (id, username, password, send_address, server_address, port, secure_login_type)
     VALUES (1, '', '', '', '', 587, 'starttls')`,
  ).run()
}

export function getDb() {
  if (database) {
    return database
  }

  mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const db = new Database(config.databasePath)
  db.pragma('journal_mode = WAL')
  runMigrations(db)
  const institution = seedInstitution(db)
  seedUsers(db, institution.id)
  seedQuestionTemplates(db, institution.id)
  seedSmtpSettings(db)
  database = db
  return db
}
