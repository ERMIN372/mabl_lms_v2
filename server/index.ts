import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import apiHandler, { serveStorageFile } from '../api/router.js'
import setupHandler from '../api/setup.js'
import { closePool } from '../api/_db.js'
import type { ApiRequest, ApiResponse } from '../api/_http.js'

/**
 * HTTP-сервер приложения.
 *
 * На Vercel каждый файл в `api/` был отдельной serverless-функцией, а маршруты
 * (`/api/*`, `/scorm-store/*`, SPA-fallback) описывались в `vercel.json`. После
 * переезда на VM Yandex Cloud эти же правила живут здесь: один процесс Node
 * отдаёт и API, и собранный фронтенд.
 *
 * Переменные окружения:
 *   PORT            — порт (по умолчанию 3000)
 *   HOST            — интерфейс (по умолчанию 127.0.0.1; наружу смотрит nginx)
 *   STATIC_DIR      — каталог собранного фронтенда (по умолчанию ./dist)
 *   MAX_UPLOAD_MB   — потолок размера загружаемого файла (по умолчанию 512)
 */

const here = path.dirname(fileURLToPath(import.meta.url))
// В сборке файл лежит в dist-server/server/, поэтому корень проекта — на два
// уровня выше; при запуске из исходников (tsx) — на один.
const projectRoot = path.resolve(here, here.includes('dist-server') ? '../..' : '..')

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'
const STATIC_DIR = path.resolve(projectRoot, process.env.STATIC_DIR ?? 'dist')
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 256)

/** Пути, тело которых — сырые байты файла, а не JSON. */
const UPLOAD_PATHS = new Set(['/scorm/upload', '/materials/upload'])

const app = express()
// За nginx: доверяем X-Forwarded-* (нужно для корректного протокола в ссылках).
app.set('trust proxy', true)
app.disable('x-powered-by')

const rawUpload = express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` })
const jsonBody = express.json({ limit: '5mb' })

/** Вызвать обработчик API так, как его вызывал бы Vercel. */
function callApi(
  handler: (req: ApiRequest, res: ApiResponse) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req as unknown as ApiRequest, res as unknown as ApiResponse)).catch(next)
  }
}

// ---------- API ----------
// Тело: сырые байты для загрузки файлов, JSON — для всего остального.
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && UPLOAD_PATHS.has(req.path)) return rawUpload(req, res, next)
  return jsonBody(req, res, next)
})

// Одноразовая инициализация БД по секрету (отдельный обработчик, как на Vercel).
app.all('/api/setup', callApi(setupHandler))

// Все остальные /api/* разбирает единый роутер: путь он берёт из req.url.
app.all(/^\/api(\/.*)?$/, callApi(apiHandler))

// ---------- Файлы SCORM-пакетов ----------
// Раздача идёт через наш домен: контент SCORM ищет window.API по родительским
// фреймам, а это работает только при совпадении источника (same-origin).
app.get(/^\/scorm-store\/(.+)$/, (req, res, next) => {
  const rest = req.params[0]
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
  req.url = `/api/scorm-file/${rest}${query}`
  return callApi(apiHandler)(req, res, next)
})

// ---------- Файлы учебных материалов ----------
app.get(/^\/files\/(.+)$/, (req, res, next) => {
  const key = decodeURIComponent(req.params[0])
  Promise.resolve(
    serveStorageFile(key, req as unknown as ApiRequest, res as unknown as ApiResponse),
  ).catch(next)
})

// ---------- Проверка живости (для мониторинга и nginx) ----------
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) })
})

// ---------- Статика собранного фронтенда ----------
app.use(
  express.static(STATIC_DIR, {
    // index.html не кэшируем: иначе после деплоя браузер тянет старые чанки.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    },
  }),
)

// ---------- SPA-fallback ----------
// Любой неизвестный путь отдаёт index.html — маршрутизацию делает React Router.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(path.join(STATIC_DIR, 'index.html'))
})

// ---------- Обработчик ошибок ----------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] необработанная ошибка:', err)
  if (res.headersSent) return
  const message = err instanceof Error ? err.message : 'Внутренняя ошибка сервера'
  res.status(500).json({ message })
})

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] МАБЛ LMS слушает http://${HOST}:${PORT} (статика: ${STATIC_DIR})`)
})

/** Аккуратная остановка: дослужить текущие запросы и закрыть пул соединений. */
function shutdown(signal: string) {
  console.log(`[server] получен ${signal}, останавливаюсь`)
  server.close(() => {
    closePool()
      .catch((err) => console.error('[server] ошибка закрытия пула:', err))
      .finally(() => process.exit(0))
  })
  // Страховка, если соединения висят дольше 10 секунд.
  setTimeout(() => process.exit(0), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
