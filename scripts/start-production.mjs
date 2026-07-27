import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = path.join(repoRoot, 'packages', 'server', 'dist', 'index.js')
const webIndex = path.join(repoRoot, 'packages', 'web', 'dist', 'index.html')
const envPath = path.join(repoRoot, '.env')

function logStartup(message, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'qglimpse-start',
    message,
    ...details,
  }))
}

function logStartupError(message, details = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'qglimpse-start',
    message,
    ...details,
  }))
}

if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
  logStartup('Loaded environment file.', { envPath })
} else {
  logStartup('No .env file found; using process environment only.', { envPath })
}

logStartup('Checking production build artifacts.', {
  cwd: repoRoot,
  node: process.version,
  serverEntry,
  webIndex,
  port: process.env.PORT ?? null,
  baseUrl: process.env.QUICKGLIMPSE_BASE_URL ?? null,
  databasePath: process.env.QUICKGLIMPSE_DB_PATH ?? null,
})

if (!existsSync(serverEntry) || !existsSync(webIndex)) {
  logStartupError('Production build artifacts are missing. Run npm run build before starting Qglimpse.', {
    serverEntryExists: existsSync(serverEntry),
    webIndexExists: existsSync(webIndex),
  })
  process.exit(1)
}

logStartup('Starting compiled Qglimpse server.', {
  command: process.execPath,
  args: [serverEntry],
})

const child = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
  stdio: 'inherit',
})

child.on('error', (error) => {
  logStartupError('Failed to spawn compiled Qglimpse server.', {
    errorName: error.name,
    errorMessage: error.message,
    stack: error.stack,
  })
})

child.on('exit', (code, signal) => {
  logStartup('Compiled Qglimpse server process exited.', { code, signal })
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
