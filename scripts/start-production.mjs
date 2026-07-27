import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = path.join(repoRoot, 'packages', 'server', 'dist', 'index.js')
const webIndex = path.join(repoRoot, 'packages', 'web', 'dist', 'index.html')

if (!existsSync(serverEntry) || !existsSync(webIndex)) {
  console.error('Production build artifacts are missing. Run npm run build before starting Qglimpse.')
  process.exit(1)
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
