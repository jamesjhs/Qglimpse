import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const packageJsonPath = path.join(repoRoot, 'package.json')
const envPath = path.join(repoRoot, '.env')
const envExamplePath = path.join(repoRoot, '.env.example')
const nodeEnv = process.env.NODE_ENV?.trim() || 'development'
const isProduction = nodeEnv === 'production'
if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
} else if (!isProduction && existsSync(envExamplePath)) {
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

function readAppVersion() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
    throw new Error('Root package.json must define a version.')
  }
  return packageJson.version.trim()
}

function parseTrustProxyEnv() {
  const value = process.env.QUICKGLIMPSE_TRUST_PROXY?.trim()
  if (!value || value === 'false') {
    return false
  }
  if (value === 'true') {
    return true
  }

  const proxyHopCount = Number(value)
  if (Number.isInteger(proxyHopCount) && proxyHopCount >= 0) {
    return proxyHopCount
  }

  throw new Error('Environment variable QUICKGLIMPSE_TRUST_PROXY must be false, true, or a non-negative integer.')
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim()
  return value || undefined
}

function requireProductionEnv(name: string) {
  return isProduction ? requireEnv(name) : (optionalEnv(name) ?? '')
}

function assertNotPlaceholder(name: string, value: string, placeholders: string[]) {
  if (placeholders.includes(value)) {
    throw new Error(`Environment variable ${name} must not use a placeholder value in production.`)
  }
}

function validateProductionConfig(input: {
  baseUrl: string
  trustProxy: boolean | number
  databaseEncryptionKey: string
  sessionSecret: string
  sessionTtlMs: number
  sessionIdleTtlMs: number
  smtpSeed: {
    username: string
    password: string
    sendAddress: string
    serverAddress: string
    port: number
    secureLoginType: 'none' | 'ssl' | 'starttls'
  }
  turnstile: {
    siteKey: string
    secretKey: string
  }
}) {
  if (!isProduction) {
    return
  }

  const parsedBaseUrl = new URL(input.baseUrl)
  if (parsedBaseUrl.protocol !== 'https:') {
    throw new Error('QUICKGLIMPSE_BASE_URL must use https:// in production.')
  }
  if (['localhost', '127.0.0.1', '::1'].includes(parsedBaseUrl.hostname)) {
    throw new Error('QUICKGLIMPSE_BASE_URL must not point at localhost in production.')
  }
  if (input.trustProxy === false || input.trustProxy === 0) {
    throw new Error('QUICKGLIMPSE_TRUST_PROXY must trust the Cloudflare/reverse-proxy hop in production.')
  }
  if (input.databaseEncryptionKey.length < 32) {
    throw new Error('QUICKGLIMPSE_DB_ENCRYPTION_KEY must be at least 32 characters in production.')
  }
  assertNotPlaceholder('QUICKGLIMPSE_DB_ENCRYPTION_KEY', input.databaseEncryptionKey, [
    'change-me-db-key',
    'changeme',
  ])
  if (input.sessionSecret.length < 32) {
    throw new Error('QUICKGLIMPSE_SESSION_SECRET must be at least 32 characters in production.')
  }
  assertNotPlaceholder('QUICKGLIMPSE_SESSION_SECRET', input.sessionSecret, ['change-me-session-secret', 'changeme'])
  if (input.sessionTtlMs <= 0 || input.sessionTtlMs > 7 * 24 * 60 * 60 * 1000) {
    throw new Error('QUICKGLIMPSE_SESSION_TTL_MS must be between 1 ms and 7 days in production.')
  }
  if (input.sessionIdleTtlMs <= 0 || input.sessionIdleTtlMs > input.sessionTtlMs) {
    throw new Error('QUICKGLIMPSE_SESSION_IDLE_TTL_MS must be positive and no greater than QUICKGLIMPSE_SESSION_TTL_MS in production.')
  }
  if (!input.turnstile.siteKey || !input.turnstile.secretKey) {
    throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required in production.')
  }
  for (const [name, value] of Object.entries(input.smtpSeed)) {
    if (name === 'port') {
      continue
    }
    if (!String(value).trim()) {
      throw new Error(`SMTP_${name.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()} is required in production.`)
    }
  }
  if (input.smtpSeed.secureLoginType === 'none') {
    throw new Error('SMTP_SECURE_LOGIN_TYPE must be ssl or starttls in production.')
  }
}

const dataDir = process.env.QUICKGLIMPSE_DATA_DIR
  ? path.resolve(process.env.QUICKGLIMPSE_DATA_DIR)
  : path.join(repoRoot, '.data')

mkdirSync(dataDir, { recursive: true })

const databaseEncryptionKey = requireEnv('QUICKGLIMPSE_DB_ENCRYPTION_KEY')
const sessionSecret = isProduction
  ? requireEnv('QUICKGLIMPSE_SESSION_SECRET')
  : (optionalEnv('QUICKGLIMPSE_SESSION_SECRET') ??
    createHash('sha256').update(`${repoRoot}:qglimpse-development-session-secret`).digest('hex'))
const sessionTtlMs = requireIntegerEnv('QUICKGLIMPSE_SESSION_TTL_MS')
const sessionIdleTtlMs = process.env.QUICKGLIMPSE_SESSION_IDLE_TTL_MS
  ? requireIntegerEnv('QUICKGLIMPSE_SESSION_IDLE_TTL_MS')
  : Math.min(sessionTtlMs, 30 * 60 * 1000)
const smtpSeed = {
  username: requireProductionEnv('SMTP_USERNAME'),
  password: requireProductionEnv('SMTP_PASSWORD'),
  sendAddress: requireProductionEnv('SMTP_SEND_ADDRESS'),
  serverAddress: requireProductionEnv('SMTP_SERVER_ADDRESS'),
  port: requireIntegerEnv('SMTP_PORT'),
  secureLoginType: requireSmtpSecureLoginType(),
}
const turnstile = {
  siteKey: requireProductionEnv('TURNSTILE_SITE_KEY'),
  secretKey: requireProductionEnv('TURNSTILE_SECRET_KEY'),
}

export const config = {
  appName: 'Qglimpse',
  version: readAppVersion(),
  nodeEnv,
  isProduction,
  port: requireIntegerEnv('PORT'),
  baseUrl: requireEnv('QUICKGLIMPSE_BASE_URL'),
  trustProxy: parseTrustProxyEnv(),
  dataDir,
  databasePath: requireEnv('QUICKGLIMPSE_DB_PATH'),
  databaseEncryptionKey,
  sessionSecret,
  sessionTtlMs,
  sessionIdleTtlMs,
  smtpSeed,
  turnstile,
  seedCredentials: {
    rootPassword: isProduction ? '' : requireEnv('QUICKGLIMPSE_ROOT_SEED_PASSWORD'),
    institutionAdminPassword: isProduction ? '' : requireEnv('QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD'),
  },
}

validateProductionConfig(config)
