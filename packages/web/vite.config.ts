import fs from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg', 'maskable-icon.svg'],
      manifest: {
        name: 'Quick Glimpse',
        short_name: 'QuickGlimpse',
        description: 'Institution-friendly visitor insight kiosk and dashboard shell.',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: 'maskable-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
        inlineWorkboxRuntime: true,
      },
    }),
  ],
  server: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/readyz': 'http://localhost:3000',
    },
  },
})
