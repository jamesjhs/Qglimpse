import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const APP_VERSION = '0.2.0'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const envPath = path.join(repoRoot, '.env')
const envExamplePath = path.join(repoRoot, '.env.example')
if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
} else if (existsSync(envExamplePath)) {
  process.loadEnvFile(envExamplePath)
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function requireIntegerEnv(name: string) {
  const value = Number(requireEnv(name))
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer.`)
  }
  return value
}

function requireSmtpSecureLoginType() {
  const value = requireEnv('SMTP_SECURE_LOGIN_TYPE')
  if (!['none', 'ssl', 'starttls'].includes(value)) {
    throw new Error('Environment variable SMTP_SECURE_LOGIN_TYPE must be one of: none, ssl, starttls.')
  }
  return value as 'none' | 'ssl' | 'starttls'
}

const dataDir = process.env.QUICKGLIMPSE_DATA_DIR
  ? path.resolve(process.env.QUICKGLIMPSE_DATA_DIR)
  : path.join(repoRoot, '.data')

mkdirSync(dataDir, { recursive: true })

export const config = {
  appName: 'Quick Glimpse',
  version: APP_VERSION,
  port: requireIntegerEnv('PORT'),
  baseUrl: requireEnv('QUICKGLIMPSE_BASE_URL'),
  dataDir,
  databasePath: requireEnv('QUICKGLIMPSE_DB_PATH'),
  databaseEncryptionKey: requireEnv('QUICKGLIMPSE_DB_ENCRYPTION_KEY'),
  sessionTtlMs: requireIntegerEnv('QUICKGLIMPSE_SESSION_TTL_MS'),
  smtpSeed: {
    username: process.env.SMTP_USERNAME ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    sendAddress: process.env.SMTP_SEND_ADDRESS ?? '',
    serverAddress: process.env.SMTP_SERVER_ADDRESS ?? '',
    port: requireIntegerEnv('SMTP_PORT'),
    secureLoginType: requireSmtpSecureLoginType(),
  },
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? '',
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
    devBypassToken: 'dev-turnstile-pass',
    cfAccessClientId: requireEnv('CF-Access-Client-Id'),
    cfAccessClientSecret: requireEnv('CF-Access-Client-Secret'),
  },
  seedCredentials: {
    rootPassword: requireEnv('QUICKGLIMPSE_ROOT_SEED_PASSWORD'),
    institutionAdminPassword: requireEnv('QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD'),
  },
}
