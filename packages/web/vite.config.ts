import fs from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const outDir = new URL('./dist', import.meta.url)
const canEmptyOutDir = (() => {
  try {
    if (!fs.existsSync(outDir)) {
      return true
    }
    fs.accessSync(outDir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
})()

export default defineConfig({
  build: {
    emptyOutDir: canEmptyOutDir,
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/readyz': 'http://localhost:3000',
    },
  },
})
