import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const outDir = new URL('./dist', import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const appVersion = packageJson.version
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

function qglimpsePwaPlugin(): Plugin {
  return {
    name: 'qglimpse-pwa',
    transformIndexHtml(html) {
      return html.replaceAll('%QGLIMPSE_VERSION%', encodeURIComponent(appVersion))
    },
    generateBundle(_, bundle) {
      const emittedAssets = Object.values(bundle)
        .map((asset) => asset.fileName)
        .filter((fileName) => /\.(css|js|html|svg|png|webmanifest)$/.test(fileName))
        .map((fileName) => `/${fileName.replaceAll(path.sep, '/')}`)
      const precacheUrls = Array.from(new Set([
        '/',
        '/index.html',
        `/manifest.webmanifest?v=${encodeURIComponent(appVersion)}`,
        '/icon-192.svg',
        '/icon-512.svg',
        '/maskable-icon.svg',
        ...emittedAssets,
      ]))
      const sw = `const APP_VERSION = ${JSON.stringify(appVersion)};
const CACHE_NAME = \`qglimpse-\${APP_VERSION}\`;
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('qglimpse-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ includeUncontrolled: true, type: 'window' }))
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'QGLIMPSE_VERSION_ACTIVATED', version: APP_VERSION });
        }
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api') || url.pathname === '/readyz' || url.pathname === '/sw.js') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cached) => cached || fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })),
  );
});
`
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: sw,
      })
    },
  }
}

export default defineConfig({
  build: {
    emptyOutDir: canEmptyOutDir,
  },
  plugins: [
    react(),
    tailwindcss(),
    qglimpsePwaPlugin(),
  ],
  define: {
    __QGLIMPSE_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/readyz': 'http://localhost:3000',
    },
  },
})
