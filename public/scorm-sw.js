/*
 * Service Worker для SCORM-пакетов, загруженных через админку.
 *
 * Файлы пакетов хранятся на сервере (Vercel Blob) и отдаются приложением
 * по /scorm-store/<id>/<путь> (прокси в api/router.ts).
 *
 * Порядок «сначала сеть, потом кэш» принципиален: раньше кэш проверялся первым,
 * и у администратора, загружавшего пакет в старом формате (Cache Storage),
 * курс открывался из локальной копии, хотя на сервере файлов не было — у всех
 * остальных пользователей пакет не работал, а админ этого не видел. Теперь все
 * видят одно и то же (серверную раздачу), а старый локальный кэш остаётся
 * только резервом на случай недоступности сети.
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
    const fromCache = () =>
      caches.open(CACHE).then((cache) => cache.match(event.request, { ignoreSearch: true }))
    event.respondWith(
      fetch(event.request).then(
        (response) => (response.ok ? response : fromCache().then((hit) => hit || response)),
        () => fromCache().then((hit) => hit || new Response('Нет соединения', { status: 503 })),
      ),
    )
  }
})
