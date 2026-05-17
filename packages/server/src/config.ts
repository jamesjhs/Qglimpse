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
}
