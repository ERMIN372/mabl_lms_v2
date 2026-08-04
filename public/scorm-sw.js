/*
 * Саморазрушающийся service worker.
 *
 * Раньше здесь жил воркер, который проигрывал SCORM-пакеты из Cache Storage.
 * Теперь пакеты хранятся на сервере, а перехват /scorm-store/ этим воркером
 * ломал раздачу крупных файлов (он не умеет отдавать странице ответы-редиректы,
 * которыми отдаются файлы больше 4,5 МБ). Поэтому воркер снимает сам себя,
 * чистит свой кэш и перестаёт вмешиваться в запросы. Файл оставлен (а не удалён),
 * чтобы браузеры с уже установленным старым воркером получили это обновление и
 * разрегистрировались.
 */

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await caches.delete('scorm-packages')
      } catch {
        /* нет доступа к кэшу — не критично */
      }
      try {
        await self.registration.unregister()
        // Перезагружаем открытые вкладки, чтобы запросы пошли напрямую в сеть,
        // минуя только что снятый воркер.
        const clients = await self.clients.matchAll({ type: 'window' })
        for (const client of clients) client.navigate(client.url)
      } catch {
        /* среда без прав на unregister/navigate — не критично */
      }
    })(),
  )
})

// Никаких fetch-обработчиков: запросы идут в сеть напрямую.
