/*
 * Service Worker для SCORM-пакетов, загруженных через админку.
 *
 * Файлы пакетов теперь хранятся на сервере (Vercel Blob) и отдаются приложением
 * по /scorm-store/<id>/<путь> (прокси в api/router.ts). Воркер оставлен ради
 * совместимости со старыми пакетами, ранее сложенными в Cache Storage: при
 * попадании в кэш отдаём из него, иначе — уходим в сеть (на серверную раздачу).
 */

const CACHE = 'scorm-packages'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin === self.location.origin && url.pathname.startsWith('/scorm-store/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(event.request, { ignoreSearch: true }).then(
          (hit) => hit || fetch(event.request),
        ),
      ),
    )
  }
})
