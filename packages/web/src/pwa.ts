declare const __QGLIMPSE_VERSION__: string

const appVersion = __QGLIMPSE_VERSION__
const versionStorageKey = 'qglimpse-app-version'
const reloadStorageKey = 'qglimpse-version-reload'

function refreshForActivatedVersion(version: string) {
  const previousVersion = window.localStorage.getItem(versionStorageKey)
  window.localStorage.setItem(versionStorageKey, version)

  if (!previousVersion || previousVersion === version) {
    return
  }

  const reloadMarker = `${previousVersion}->${version}`
  if (window.sessionStorage.getItem(reloadStorageKey) === reloadMarker) {
    return
  }

  window.sessionStorage.setItem(reloadStorageKey, reloadMarker)
  window.location.reload()
}

export function registerPwaRefresh() {
  window.localStorage.setItem(versionStorageKey, appVersion)

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; version?: string }
    if (data.type === 'QGLIMPSE_VERSION_ACTIVATED' && data.version) {
      refreshForActivatedVersion(data.version)
    }
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    refreshForActivatedVersion(appVersion)
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(appVersion)}`, { scope: '/' })
      .then((registration) => registration.update())
      .catch((error: unknown) => {
        console.warn('Qglimpse service worker registration failed.', error)
      })
  })
}
