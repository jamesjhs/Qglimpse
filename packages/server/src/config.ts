import { mkdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const dataDir = process.env.QUICKGLIMPSE_DATA_DIR
  ? path.resolve(process.env.QUICKGLIMPSE_DATA_DIR)
  : path.join(repoRoot, '.data')

mkdirSync(dataDir, { recursive: true })

export const config = {
  appName: 'Quick Glimpse',
  version: process.env.APP_VERSION ?? '0.1.0',
  port: Number(process.env.PORT ?? 3000),
  baseUrl: process.env.QUICKGLIMPSE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  dataDir,
  databasePath: process.env.QUICKGLIMPSE_DB_PATH ?? path.join(dataDir, 'quickglimpse.db'),
  sessionTtlMs: Number(process.env.QUICKGLIMPSE_SESSION_TTL_MS ?? 24 * 60 * 60 * 1000),
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? '',
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
    devBypassToken: process.env.TURNSTILE_DEV_BYPASS_TOKEN ?? 'dev-turnstile-pass',
  },
  seedCredentials: {
    rootPassword: process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD ?? 'ChangeMeRoot123!',
    institutionAdminPassword:
      process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD ?? 'ChangeMeInstitution123!',
  },
}
