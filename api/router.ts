import type { ApiRequest, ApiResponse } from './_http.js'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getSql } from './_db.js'
import { mailConfigProblems, mailTransport, passwordResetMessage, sendMail } from './_mail.js'
import {
  CODE_TTL_MIN,
  sendCourseAccessEmail,
  sendVerificationCode,
  verifyEmailCode,
} from './_accounts.js'
import {
  clientIp,
  hitRateLimit,
  purgeStaleRateLimits,
  resetRateLimit,
  tooManyRequests,
} from './_ratelimit.js'

// ---------------- лимиты частоты ----------------
// Значения подобраны так, чтобы не мешать живому человеку: обычный вход
// укладывается в пару попыток, а перебор становится бессмысленно медленным.

/** Окно для попыток входа — 15 минут. */
const LOGIN_WINDOW_SEC = 15 * 60
/** Попыток входа в один аккаунт за окно. */
const LOGIN_MAX_PER_EMAIL = 5
/** Попыток входа с одного адреса за окно: с запасом на общий офисный IP. */
const LOGIN_MAX_PER_IP = 25
/** Окно для регистраций и заявок — час. */
const SIGNUP_WINDOW_SEC = 60 * 60
/** Регистраций с одного адреса в час. */
const REGISTER_MAX_PER_IP = 5
/** Заявок на поступление с одного адреса в час. */
const APPLICATION_MAX_PER_IP = 5
/** Запросов восстановления пароля с одного адреса в час. */
const RECOVER_MAX_PER_IP = 10
/** Ручных синхронизаций новостей в час, когда CRON_SECRET не задан. */
const NEWS_SYNC_MAX_PER_HOUR = 4
import { ensureSchema, initDatabase } from './_seed.js'
import { findDemoRows, purgeDemoRows } from './_demo.js'
import { syncTelegramNews } from './_telegram.js'
import { isYooKassaConfigured, createPayment, getPayment } from './_yookassa.js'
import {
  signToken,
  requireAdmin,
  verifyToken,
  bearer,
  browserSession,
  renewToken,
  sessionCookie,
  clearSessionCookie,
  authSecretProblem,
} from './_auth.js'
import {
  deleteKeys,
  getObject,
  isStorageConfigured,
  keyFromUrl,
  storageMode,
  listKeys,
  publicUrlFor,
  putObject,
  storageEnvNames,
} from './_storage.js'
import type {
  AdminUser,
  AppNotification,
  CalendarEvent,
  Course,
  ForumSection,
  ForumTopic,
  Material,
  NewsItem,
  Order,
  OrderStatus,
  ProgramApplication,
  Survey,
  User,
} from '../src/types/index.js'

/**
 * Единый роутер всех /api/* эндпоинтов.
 *
 * Все /api/* запросы приходят сюда из server/index.ts; маршрут разбирается
 * из req.url. Исключение — /api/setup, у которого отдельный обработчик.
 *
 * Все ресурсы (курсы, аккаунты, события, новости, материалы, форум, опросники,
 * заказы, участники) хранятся в PostgreSQL и наполняются из админ-панели.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  // CORS. Раньше стояло `*` — любой сторонний сайт мог дёргать API и читать
  // ответы. Свой фронтенд ходит с того же домена и в CORS не нуждается вовсе,
  // поэтому пропускаем только собственные домены (и localhost в разработке).
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
  if (req.method === 'OPTIONS') return res.status(204).end()

  // Не задан секрет подписи — сессии невозможны. Отвечаем на маршрутах входа
  // понятным текстом: иначе администратор видит только «Ошибка запроса (500)»
  // и не может догадаться, что дело в переменной окружения. Остальной сайт при
  // этом продолжает работать как для гостя.
  const authProblem = authSecretProblem()
  if (authProblem && (req.url || '').includes('auth/')) {
    console.error(`[auth] ${authProblem}`)
    return res.status(503).json({ message: authProblem })
  }

  // Маршрут разбирается из адреса запроса: /api/courses/<id> → ['courses', <id>].
  // Префиксы `api` и `router` отбрасываются — второй остался от старых ссылок
  // на serverless-функцию.
  const pathname = (req.url || '').split('?')[0]
  // Каждый сегмент декодируется отдельно и с защитой от битого %-кодирования:
  // id пакетов SCORM бывают кириллическими, а кривой адрес не должен ронять запрос.
  let segments = pathname
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  if (segments[0] === 'api') segments = segments.slice(1)
  if (segments[0] === 'router') segments = segments.slice(1)

  const method = (req.method || 'GET').toUpperCase()
  const path = segments.join('/')
  console.log(`[api] ${method} /${path} | url=${req.url}`)

  // ---------- ЗАЩИТА ----------
  // Любая мутация и весь раздел admin/* требуют прав администратора, кроме
  // явно публичных действий (вход, восстановление, оплата, комментарии и
  // реакции к новостям, cron-синхронизация новостей по GET).
  const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  const isPublicMutation =
    path === 'auth/login' ||
    path === 'auth/register' ||
    path === 'auth/recover' ||
    path === 'auth/reset' ||
    path === 'auth/session' ||
    path === 'auth/logout' ||
    // Подтверждение почты делает сам владелец аккаунта: права проверяются
    // внутри обработчика по токену сессии, а не по правам администратора.
    path === 'auth/verify-email' ||
    path === 'auth/resend-code' ||
    // Отчёт о нарушении CSP присылает браузер — без всякой авторизации.
    path === 'csp-report' ||
    // Оплату инициирует слушатель: права проверяются внутри обработчика по
    // токену сессии (а не по правам администратора).
    path === 'payments/create' ||
    path === 'payments/webhook' ||
    // Заявку на поступление оставляет любой посетитель страницы программы —
    // авторизация здесь не требуется по определению.
    path === 'applications' ||
    (segments[0] === 'news' && (segments[2] === 'comments' || segments[2] === 'reactions'))
  const needsAdmin = segments[0] === 'admin' || (isMutation && !isPublicMutation)
  if (needsAdmin && !requireAdmin(req, res)) return

  try {
    // ---------- ДИАГНОСТИКА ----------
    // Заданы ли переменные окружения, без которых сайт не работает. Отдаёт
    // только «да/нет», без значений: когда вход сломан, войти в админку за
    // диагностикой невозможно, а понять причину надо.
    if (path === 'health' && method === 'GET') {
      // Доступ по SETUP_SECRET или админскому токену. Отдавать состояние
      // конфигурации всем подряд незачем: это подсказка атакующему, что на
      // сервере настроено, а что нет. Секрет в адресе оставлен намеренно —
      // проверка нужна именно тогда, когда вход сломан и токена не получить.
      const secretParam = typeof req.query.secret === 'string' ? req.query.secret : ''
      const bySecret =
        Boolean(process.env.SETUP_SECRET) && secretParam === process.env.SETUP_SECRET
      if (!bySecret && verifyToken(bearer(req))?.kind !== 'admin') {
        return res.status(403).json({ message: 'Нет доступа к диагностике.' })
      }
      return res.json({
        authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
        database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
        siteUrl: Boolean(process.env.SITE_URL),
        problems: [authSecretProblem()].filter(Boolean),
      })
    }

    // Приём нарушений CSP (политика включена в режиме отчётов). Тело шлёт
    // браузер, поэтому доверять ему нельзя: берём только несколько известных
    // полей и обрезаем длину — иначе эндпоинт превращается в способ засорить
    // логи произвольным текстом.
    if (path === 'csp-report' && method === 'POST') {
      const body = parseBody(req) as { 'csp-report'?: Record<string, unknown> }
      const r = body['csp-report'] ?? {}
      const short = (v: unknown) => String(v ?? '').slice(0, 300)
      console.warn(
        `[csp] нарушение: directive=${short(r['violated-directive'])} ` +
          `blocked=${short(r['blocked-uri'])} document=${short(r['document-uri'])}`,
      )
      return res.status(204).end()
    }

    // ---------- AUTH ----------
    if (path === 'auth/login' && method === 'POST') {
      return await login(req, res)
    }
    if (path === 'auth/register' && method === 'POST') {
      return await register(req, res)
    }
    // Обновить cookie сессии по действующему токену. Нужно тем, кто вошёл до
    // появления cookie: токен у них в браузере уже есть, а cookie ещё нет, и
    // без неё файлы SCORM-пакета не открываются.
    if (path === 'auth/session' && method === 'POST') {
      const account = verifyToken(bearer(req))
      if (!account) return res.status(401).json({ message: 'Сессия недействительна.' })
      res.setHeader('Set-Cookie', sessionCookie(bearer(req) as string))
      return res.json({ ok: true })
    }
    if (path === 'auth/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', clearSessionCookie())
      return res.json({ ok: true })
    }
    if (path === 'auth/recover' && method === 'POST') {
      return await recoverPassword(req, res)
    }
    if (path === 'auth/reset' && method === 'POST') {
      return await resetPassword(req, res)
    }
    if (path === 'auth/verify-email' && method === 'POST') {
      return await verifyEmail(req, res)
    }
    if (path === 'auth/resend-code' && method === 'POST') {
      return await resendVerificationCode(req, res)
    }

    // Актуальный профиль: статус подтверждения почты меняется на сервере, и
    // сохранённая в браузере копия про это не знает.
    if (path === 'me' && method === 'GET') {
      return await currentProfile(req, res)
    }

    // ---------- ДОСТУП ПОЛЬЗОВАТЕЛЯ ----------
    // Состояние сессии: жив ли токен и за каким аккаунтом он закреплён.
    // Заодно продлеваем срок, чтобы активный слушатель не разлогинивался.
    if (path === 'me/session' && method === 'GET') {
      const session = browserSession(req)
      if (!session) return res.status(401).json({ authenticated: false })
      const renewed = renewToken(session)
      if (renewed) res.setHeader('Set-Cookie', sessionCookie(renewed))
      return res.json({
        authenticated: true,
        id: session.id,
        kind: session.kind,
        ...(renewed ? { token: renewed } : {}),
      })
    }
    // Программы, открытые текущему пользователю: только по оплаченным заказам.
    if (path === 'me/courses' && method === 'GET') {
      return res.json({ courseIds: await listAccessibleCourseIds(req) })
    }

    // ---------- COURSES (БД) ----------
    // Ссылки запуска уроков видны только тем, у кого есть доступ к программе:
    // публичный каталог раздавал прямые адреса платного контента.
    if (path === 'courses' && method === 'GET') {
      return res.json(await visibleCourses(await listCourses(), req))
    }
    if (path === 'courses' && method === 'POST') {
      return await createCourse(req, res)
    }
    if (segments[0] === 'courses' && segments.length === 2) {
      const id = segments[1]
      if (method === 'GET') {
        const course = await getCourse(id)
        if (!course) return res.status(404).json({ message: 'Программа не найдена' })
        const [visible] = await visibleCourses([course], req)
        return res.json(visible)
      }
      if (method === 'PUT') return await updateCourse(id, req, res)
      if (method === 'DELETE') return await deleteCourse(id, res)
    }

    // ---------- EVENTS (БД) ----------
    if (path === 'events' && method === 'GET') {
      return res.json(await contentList<CalendarEvent>('events'))
    }
    if (path === 'events' && method === 'POST') {
      return res.status(201).json(
        await contentCreate<CalendarEvent>('events', parseBody(req) as unknown as CalendarEvent, 'event'),
      )
    }
    if (path === 'events/next' && method === 'GET') {
      const list = await contentList<CalendarEvent>('events')
      const next = list
        .filter((e) => e.type === 'Вебинар')
        .sort((a, b) => +new Date(a.date) - +new Date(b.date))[0]
      return res.json(next ?? null)
    }
    if (segments[0] === 'events' && segments.length === 2) {
      const id = segments[1]
      if (method === 'GET') return found(res, await contentGet<CalendarEvent>('events', id), 'Событие не найдено')
      if (method === 'PUT') return res.json(await contentUpdate<CalendarEvent>('events', id, parseBody(req)))
      if (method === 'DELETE') { await contentRemove('events', id); return res.status(204).end() }
    }

    // ---------- NEWS (БД + импорт из Telegram) ----------
    // Синхронизация из Telegram-канала. GET — вызывается Vercel Cron,
    // POST — кнопкой «Обновить из Telegram» в админ-панели.
    // POST закрыт правами администратора (см. isPublicMutation), а GET дёргает
    // Vercel Cron — и раньше его мог дёргать кто угодно, сколько угодно раз.
    // Каждый вызов ходит в Telegram и переписывает всю таблицу новостей.
    if (path === 'news/sync' && (method === 'GET' || method === 'POST')) {
      const sql = getSql()
      if (method === 'GET') {
        const guard = await allowNewsSync(req, sql)
        if (!guard.ok) return guard.deny(res)
      }
      const result = await syncTelegramNews(sql)
      // Заодно прибираем отжившие счётчики частоты: отдельное расписание ради
      // одной операции в сутки заводить незачем.
      await purgeStaleRateLimits(sql)
      return res.json({ ok: true, ...result })
    }
    if (path === 'news' && method === 'GET') return res.json(await listNews())
    if (path === 'news' && method === 'POST') return await createNews(req, res)
    // Комментарии и реакции к новости.
    if (segments[0] === 'news' && segments.length >= 3) {
      const newsId = segments[1]
      const sub = segments[2]
      if (sub === 'comments') {
        if (segments.length === 3 && method === 'GET') return res.json(await listComments(newsId))
        if (segments.length === 3 && method === 'POST') return await createComment(newsId, req, res)
        if (segments.length === 4 && method === 'DELETE')
          return await deleteComment(newsId, segments[3], req, res)
      }
      if (sub === 'reactions') {
        // Чьи реакции подсвечивать, решает токен: по ?userId= можно было
        // подсмотреть, что именно лайкнул конкретный пользователь.
        const userId = verifyToken(bearer(req))?.id ?? ''
        if (method === 'GET') return res.json(await getReactions(newsId, userId))
        if (method === 'POST') return await toggleReaction(newsId, req, res)
      }
    }
    if (segments[0] === 'news' && segments.length === 2) {
      const id = segments[1]
      if (method === 'GET') return found(res, await getNewsItem(id), 'Новость не найдена')
      if (method === 'PUT') return await updateNews(id, req, res)
      if (method === 'DELETE') return await deleteNews(id, res)
    }

    // ---------- MATERIALS (БД) ----------
    if (path === 'materials' && method === 'GET') {
      return res.json(await contentList<Material>('materials'))
    }
    if (path === 'materials' && method === 'POST') {
      return res.status(201).json(
        await contentCreate<Material>('materials', parseBody(req) as unknown as Material, 'material'),
      )
    }
    // Файл материала загружается через наш сервер в Object Storage. Лимита на
    // размер тела запроса, как у serverless-функций, здесь нет — потолок задаёт
    // nginx (client_max_body_size) и MAX_UPLOAD_MB.
    if (path === 'materials/upload' && method === 'POST') {
      return await storageUpload('materials/', req, res)
    }
    if (segments[0] === 'materials' && segments.length === 2) {
      const id = segments[1]
      if (method === 'GET') return found(res, await contentGet<Material>('materials', id), 'Материал не найден')
      if (method === 'PUT') return await updateMaterial(id, req, res)
      if (method === 'DELETE') return await deleteMaterial(id, res)
    }

    // ---------- SURVEYS (БД) ----------
    if (path === 'surveys' && method === 'GET') {
      return res.json(await contentList<Survey>('surveys'))
    }
    if (path === 'surveys' && method === 'POST') {
      return res.status(201).json(
        await contentCreate<Survey>('surveys', parseBody(req) as unknown as Survey, 'survey'),
      )
    }
    if (segments[0] === 'surveys' && segments.length === 2) {
      const id = segments[1]
      if (method === 'GET') return found(res, await contentGet<Survey>('surveys', id), 'Опросник не найден')
      if (method === 'PUT') return res.json(await contentUpdate<Survey>('surveys', id, parseBody(req)))
      if (method === 'DELETE') { await contentRemove('surveys', id); return res.status(204).end() }
    }

    // ---------- FORUM (БД) ----------
    if (path === 'forum/sections' && method === 'GET') {
      return res.json(await forumSectionsWithCounts())
    }
    if (path === 'forum/sections' && method === 'POST') {
      const created = await contentCreate<ForumSection>(
        'forum_sections',
        { ...(parseBody(req) as unknown as ForumSection), topicsCount: 0 },
        'section',
      )
      return res.status(201).json(created)
    }
    if (path === 'forum/topics' && method === 'GET') {
      return res.json(await contentList<ForumTopic>('forum_topics'))
    }
    if (path === 'forum/topics' && method === 'POST') {
      const body = parseBody(req) as unknown as ForumTopic
      const created = await contentCreate<ForumTopic>(
        'forum_topics',
        { ...body, comments: body.comments ?? [] },
        'topic',
        true,
      )
      return res.status(201).json(created)
    }
    if (segments[0] === 'forum' && segments[1] === 'sections' && segments.length === 3) {
      const id = segments[2]
      if (method === 'GET') {
        const section = (await forumSectionsWithCounts()).find((s) => s.id === id)
        return found(res, section, 'Раздел не найден')
      }
      if (method === 'PUT') return res.json(await contentUpdate<ForumSection>('forum_sections', id, parseBody(req)))
      if (method === 'DELETE') {
        await contentRemove('forum_sections', id)
        // Темы удалённого раздела убираем, чтобы не «висели» без раздела.
        const topics = await contentList<ForumTopic>('forum_topics')
        for (const t of topics.filter((t) => t.sectionId === id)) await contentRemove('forum_topics', t.id)
        return res.status(204).end()
      }
    }
    if (segments[0] === 'forum' && segments[1] === 'topics' && segments.length === 3) {
      const id = segments[2]
      if (method === 'GET') return found(res, await contentGet<ForumTopic>('forum_topics', id), 'Тема не найдена')
      if (method === 'PUT') return res.json(await contentUpdate<ForumTopic>('forum_topics', id, parseBody(req)))
      if (method === 'DELETE') { await contentRemove('forum_topics', id); return res.status(204).end() }
    }

    // ---------- NOTIFICATIONS (БД) ----------
    if (path === 'notifications' && method === 'GET') {
      return res.json(await contentList<AppNotification>('notifications'))
    }
    if (path === 'notifications' && method === 'POST') {
      return res.status(201).json(
        await contentCreate<AppNotification>('notifications', parseBody(req) as unknown as AppNotification, 'note', true),
      )
    }
    if (segments[0] === 'notifications' && segments.length === 2) {
      const id = segments[1]
      if (method === 'PUT') return res.json(await contentUpdate<AppNotification>('notifications', id, parseBody(req)))
      if (method === 'DELETE') { await contentRemove('notifications', id); return res.status(204).end() }
    }

    // ---------- PROFILE ----------
    if (path === 'admin/profile' && method === 'PATCH') {
      return await updateProfile(req, res)
    }

    // ---------- ПОЧТА (диагностика настроек отправки) ----------
    // Показывает, каким транспортом уходят письма и чего не хватает в
    // переменных окружения. Секреты не отдаём — только имена и адрес отправителя.
    if (path === 'admin/mail' && method === 'GET') {
      const problems = mailConfigProblems()
      return res.json({
        transport: mailTransport(),
        from: process.env.MAIL_FROM || process.env.SMTP_USER || null,
        host: process.env.SMTP_HOST || null,
        port: process.env.SMTP_HOST ? Number(process.env.SMTP_PORT || 465) : null,
        configured: problems.length === 0,
        problems,
      })
    }

    // ---------- DATABASE (управление БД из админки) ----------
    if (path === 'admin/db' && method === 'GET') {
      return await dbStatus(res)
    }
    if (path === 'admin/db/init' && method === 'POST') {
      const sql = getSql()
      const { courses, users, ...admin } = await initDatabase(sql)
      // adminPassword приходит только когда аккаунт создан этим вызовом и
      // ADMIN_PASSWORD не задан: показать один раз и больше нигде не хранить.
      return res.json({ ok: true, counts: { courses, users }, ...admin })
    }
    // Остатки старых демо-сидов в БД: сначала показать, потом удалить.
    if (path === 'admin/db/demo' && method === 'GET') {
      const sql = getSql()
      await ensureSchema(sql)
      return res.json({ rows: await findDemoRows(sql) })
    }
    if (path === 'admin/db/demo/purge' && method === 'POST') {
      const sql = getSql()
      await ensureSchema(sql)
      return res.json(await purgeDemoRows(sql))
    }
    if (path === 'admin/db/users' && method === 'POST') {
      return await createDbUser(req, res)
    }
    if (segments[0] === 'admin' && segments[1] === 'db' && segments[2] === 'users' && segments.length === 4) {
      const id = segments[3]
      if (method === 'PUT') return await updateDbUser(id, req, res)
      if (method === 'DELETE') return await deleteDbUser(id, res)
    }

    // ---------- SCORM-ПАКЕТЫ ----------
    // Раздача файлов пакета через наш домен (прокси в Object Storage).
    // Same-origin обязателен: контент SCORM ищет window.API по родительским
    // фреймам, а это работает только в пределах одного источника.
    if (segments[0] === 'scorm-file' && method === 'GET') {
      return await serveScormFile(segments[1], segments.slice(2).join('/'), req, res)
    }
    // Список пакетов — только администратору: он содержит карту файлов с прямыми
    // адресами в хранилище, то есть публично раздавал платный контент в обход
    // сайта. Слушателю этот список не нужен — у него есть ссылка запуска урока.
    if (path === 'scorm' && method === 'GET') {
      if (!requireAdmin(req, res)) return
      return res.json(await contentList<ScormPackageMeta>('scorm'))
    }
    // Преflight перед загрузкой: сообщает клиенту конкретную причину отказа
    // (истёкшая админ-сессия или ненастроенное хранилище) до того, как браузер
    // начнёт заливать десятки мегабайт. Ответ не зависит от раздела — им
    // пользуются и SCORM-пакеты, и файлы материалов (путь
    // `scorm/upload-preflight` оставлен для совместимости).
    if (
      (path === 'storage/upload-preflight' || path === 'scorm/upload-preflight') &&
      method === 'GET'
    ) {
      return res.json(await uploadPreflight(req))
    }
    if (path === 'scorm/upload' && method === 'POST') {
      return await storageUpload('scorm/', req, res)
    }
    // Диагностика пакета: проверяет каждый файл так, как его отдаёт раздача,
    // и возвращает по нему реальный HTTP-статус. Только для администратора.
    if (segments[0] === 'scorm' && segments.length === 3 && segments[2] === 'diagnose' && method === 'GET') {
      if (verifyToken(bearer(req))?.kind !== 'admin') {
        return res.status(403).json({ message: 'Требуются права администратора.' })
      }
      return res.json(await diagnoseScormPackage(decodeURIComponent(segments[1])))
    }
    if (path === 'scorm' && method === 'POST') {
      return res.status(201).json(await saveScormPackage(parseBody(req)))
    }
    if (segments[0] === 'scorm' && segments.length === 2 && method === 'DELETE') {
      await deleteScormPackage(segments[1])
      return res.status(204).end()
    }

    // ---------- ADMIN · УЧАСТНИКИ (БД) ----------
    if (path === 'admin/users' && method === 'GET') return res.json(await listParticipants())
    if (path === 'admin/users' && method === 'POST') return await createParticipant(req, res)
    if (
      segments[0] === 'admin' &&
      segments[1] === 'users' &&
      segments[3] === 'status' &&
      method === 'PATCH'
    ) {
      const { status } = parseBody(req)
      return await setParticipantStatus(segments[2], String(status ?? ''), res)
    }
    if (segments[0] === 'admin' && segments[1] === 'users' && segments.length === 3) {
      const id = segments[2]
      if (method === 'GET') return found(res, await getParticipant(id), 'Участник не найден')
      if (method === 'PUT') return await updateParticipant(id, req, res)
      if (method === 'DELETE') return await deleteParticipant(id, res)
    }

    // ---------- ПЛАТЕЖИ (ЮKassa) ----------
    // Боевая оплата. «Спит», пока не заданы YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY.
    if (path === 'payments/config' && method === 'GET') {
      return res.json({ provider: 'yookassa', configured: isYooKassaConfigured() })
    }
    if (path === 'payments/create' && method === 'POST') {
      return await createCoursePayment(req, res)
    }
    if (path === 'payments/webhook' && method === 'POST') {
      return await handlePaymentWebhook(req, res)
    }
    if (segments[0] === 'payments' && segments[1] === 'by-order' && segments.length === 3 && method === 'GET') {
      return await getOrderPaymentStatus(segments[2], req, res)
    }
    if (segments[0] === 'payments' && segments.length === 2 && method === 'GET') {
      return await getPaymentStatus(segments[1], req, res)
    }

    // ---------- ADMIN · ЗАКАЗЫ (БД) ----------
    if (path === 'admin/orders' && method === 'GET') return res.json(await listOrders())
    if (path === 'admin/orders' && method === 'POST') return await createOrder(req, res)
    if (segments[0] === 'admin' && segments[1] === 'orders' && segments.length === 3) {
      const id = segments[2]
      if (method === 'GET') return found(res, await getOrder(id), 'Заказ не найден')
      if (method === 'PUT') return await updateOrder(id, req, res)
      if (method === 'DELETE') return await deleteOrder(id, res)
    }

    // ---------- ЗАЯВКИ НА ПОСТУПЛЕНИЕ ----------
    // Приём заявки — публичный (со страницы программы), просмотр и обработка —
    // только для приёмной комиссии в админ-панели.
    if (path === 'applications' && method === 'POST') {
      return await createApplication(req, res)
    }
    if (path === 'admin/applications' && method === 'GET') {
      return res.json(await contentList<ProgramApplication>('applications'))
    }
    if (segments[0] === 'admin' && segments[1] === 'applications' && segments.length === 3) {
      const id = segments[2]
      if (method === 'GET') {
        return found(res, await contentGet<ProgramApplication>('applications', id), 'Заявка не найдена')
      }
      if (method === 'PUT' || method === 'PATCH') {
        return res.json(await contentUpdate<ProgramApplication>('applications', id, parseBody(req)))
      }
      if (method === 'DELETE') {
        await contentRemove('applications', id)
        return res.status(204).end()
      }
    }

    return res.status(404).json({ message: `Маршрут не найден: ${method} /api/${path}` })
  } catch (err: unknown) {
    // Наружу — нейтральный текст и код инцидента. Раньше сюда уходило
    // err.message: ошибки Neon и Vercel Blob раскрывали имена таблиц и колонок,
    // структуру хранилища, иногда куски конфигурации. Подробности — в логах,
    // найти их по коду можно за секунды.
    const incident = crypto.randomBytes(6).toString('hex')
    console.error(`API error [${incident}] ${method} /${path}:`, err)
    return res.status(500).json({
      message: `Внутренняя ошибка сервера. Код обращения: ${incident} — назовите его администратору.`,
      incident,
    })
  }
}

// ---------------- helpers ----------------

// Тип значения — `any`: тело приходит извне без гарантий структуры, а
// обработчики сами приводят его к нужному доменному типу.
function parseBody(req: ApiRequest): Record<string, any> {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body as Record<string, unknown>
}

function found(res: ApiResponse, value: unknown, notFoundMsg: string) {
  return value ? res.json(value) : res.status(404).json({ message: notFoundMsg })
}

/**
 * Пускать ли синхронизацию новостей по GET.
 *
 * Правильный ключ — CRON_SECRET: если он задан в проекте, Vercel Cron сам
 * присылает его в заголовке Authorization, и посторонний вызов отсекается
 * начисто. Пока он не задан, ломать ежедневную синхронизацию нельзя (запросы
 * от планировщика ничем не подписаны), поэтому ограничиваемся частотой и
 * подсказываем администратору в логах, как закрыть маршрут по-настоящему.
 */
async function allowNewsSync(
  req: ApiRequest,
  sql: ReturnType<typeof getSql>,
): Promise<{ ok: true } | { ok: false; deny: (res: ApiResponse) => unknown }> {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    if (bearer(req) === cronSecret || verifyToken(bearer(req))?.kind === 'admin') return { ok: true }
    return {
      ok: false,
      deny: (res) => res.status(403).json({ message: 'Синхронизация доступна планировщику и администратору.' }),
    }
  }

  console.warn(
    '[news/sync] CRON_SECRET не задан — маршрут открыт всем и защищён только ограничением ' +
      'частоты. Задайте CRON_SECRET в настройках проекта: Vercel Cron будет присылать его сам.',
  )
  await ensureSchema(sql)
  const limit = await hitRateLimit(sql, 'news-sync', clientIp(req), NEWS_SYNC_MAX_PER_HOUR, 60 * 60)
  if (limit.allowed) return { ok: true }
  return { ok: false, deny: (res) => tooManyRequests(res, limit, 'Синхронизация уже выполнялась недавно.') }
}

async function login(req: ApiRequest, res: ApiResponse) {
  const { email, password } = parseBody(req)
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized || !password) {
    return res.status(400).json({ message: 'Укажите e-mail и пароль.' })
  }

  const sql = getSql()
  await ensureSchema(sql)

  // Лимиты ДО сверки пароля — иначе каждая попытка стоит нам вычисления bcrypt,
  // и перебор превращается в дешёвый способ загрузить функции и увеличить счёт
  // за хостинг. Два ключа: по аккаунту (перебор пароля к конкретному адресу,
  // хоть бы и с разных адресов) и по IP (перебор по многим аккаунтам подряд).
  const ip = clientIp(req)
  const byAccount = await hitRateLimit(sql, 'login:email', normalized, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW_SEC)
  if (!byAccount.allowed) {
    console.warn(`[login] превышен лимит попыток для ${normalized} (ip ${ip || 'неизвестен'})`)
    return tooManyRequests(
      res,
      byAccount,
      'Слишком много попыток входа в этот аккаунт. Попробуйте позже или восстановите пароль.',
    )
  }
  const byIp = await hitRateLimit(sql, 'login:ip', ip, LOGIN_MAX_PER_IP, LOGIN_WINDOW_SEC)
  if (!byIp.allowed) {
    console.warn(`[login] превышен лимит попыток с ip ${ip}`)
    return tooManyRequests(res, byIp, 'Слишком много попыток входа. Попробуйте позже.')
  }

  const rows = await sql`
    SELECT id, name, email, role, kind, password_hash, email_verified
    FROM users WHERE email = ${normalized} LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    return res.status(401).json({ message: 'Неверный e-mail или пароль. Проверьте данные и попробуйте снова.' })
  }

  const ok = await bcrypt.compare(String(password), row.password_hash as string)
  if (!ok) {
    return res.status(401).json({ message: 'Неверный e-mail или пароль. Проверьте данные и попробуйте снова.' })
  }

  const user: User = {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: row.role as string,
    kind: (row.kind as User['kind']) ?? 'student',
    emailVerified: Boolean(row.email_verified),
  }
  // Вход удался — счётчики этого аккаунта и адреса обнуляем, чтобы обычный
  // человек, вспомнивший пароль с пятой попытки, не остался заблокированным.
  await resetRateLimit(sql, 'login:email', normalized)
  await resetRateLimit(sql, 'login:ip', ip)

  const token = signToken({ id: user.id, kind: user.kind })
  res.setHeader('Set-Cookie', sessionCookie(token))
  return res.json({ ...user, token })
}

/**
 * POST /api/auth/register
 * Самостоятельная регистрация слушателя: аккаунт нужен, чтобы оплатить
 * программу и получить к ней доступ. Сразу выдаёт токен сессии.
 */
async function register(req: ApiRequest, res: ApiResponse) {
  const body = parseBody(req)
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!name) return res.status(400).json({ message: 'Укажите имя и фамилию.' })
  if (!email.includes('@')) return res.status(400).json({ message: 'Укажите корректный e-mail.' })
  if (password.length < 8) {
    return res.status(400).json({ message: 'Пароль должен быть не короче 8 символов.' })
  }

  const sql = getSql()
  await ensureSchema(sql)

  // Иначе форма регистрации — бесплатный способ насоздавать аккаунтов и
  // заодно разослать наши приветственные письма по чужим адресам.
  const signupLimit = await hitRateLimit(
    sql,
    'register:ip',
    clientIp(req),
    REGISTER_MAX_PER_IP,
    SIGNUP_WINDOW_SEC,
  )
  if (!signupLimit.allowed) {
    return tooManyRequests(res, signupLimit, 'Слишком много регистраций подряд. Попробуйте позже.')
  }

  const exists = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`
  if (exists[0]) {
    return res.status(409).json({ message: 'Аккаунт с таким e-mail уже существует — войдите.' })
  }

  const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const role = 'Слушатель академии'
  const hash = await bcrypt.hash(password, 10)
  await sql`
    INSERT INTO users (id, name, email, role, kind, password_hash)
    VALUES (${id}, ${name}, ${email}, ${role}, 'student', ${hash})
  `

  // Дублируем в «Участники», чтобы новый слушатель был виден администратору.
  const participant: AdminUser = {
    id,
    name,
    email,
    role: 'student',
    status: 'active',
    registeredAt: new Date().toISOString().slice(0, 10),
    lastActiveAt: new Date().toISOString().slice(0, 10),
    enrolledCourseIds: [],
    avgProgress: 0,
  }
  const [{ max }] = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS max FROM participants`
  await sql`
    INSERT INTO participants (id, data, sort_order)
    VALUES (${id}, ${JSON.stringify(participant)}::jsonb, ${Number(max)})
    ON CONFLICT (id) DO NOTHING
  `

  // Письмо с приветствием и кодом подтверждения. Регистрацию не роняем:
  // аккаунт уже создан, а неотправленное письмо слушатель запросит повторно
  // со страницы подтверждения. Причина отказа возвращается в ответе, чтобы
  // проблема с почтой была видна сразу, а не «где-то в логах».
  let codeError: string | undefined
  if (mailConfigProblems().length > 0) {
    codeError = 'Отправка писем на сервере не настроена — код подтверждения не ушёл.'
    console.error(`[auth/register] ${codeError}`)
  } else {
    const sent = await sendVerificationCode(sql, { id, name, email }, { welcome: true })
    if (!sent.ok) codeError = sent.message
  }

  const user: User = { id, name, email, role, kind: 'student', emailVerified: false }
  const token = signToken({ id, kind: 'student' })
  res.setHeader('Set-Cookie', sessionCookie(token))
  return res.status(201).json({
    ...user,
    token,
    ...(codeError ? { codeError } : {}),
  })
}

/** GET /api/me — актуальный профиль по токену сессии. */
async function currentProfile(req: ApiRequest, res: ApiResponse) {
  const account = verifyToken(bearer(req))
  if (!account) return res.status(401).json({ message: 'Сессия недействительна. Войдите заново.' })

  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`
    SELECT id, name, email, role, kind, email_verified FROM users WHERE id = ${account.id} LIMIT 1
  `
  const row = rows[0]
  if (!row) return res.status(401).json({ message: 'Аккаунт не найден. Войдите заново.' })
  return res.json({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    kind: row.kind,
    emailVerified: Boolean(row.email_verified),
  })
}

/** POST /api/auth/verify-email — подтвердить почту кодом из письма. */
async function verifyEmail(req: ApiRequest, res: ApiResponse) {
  const account = verifyToken(bearer(req))
  if (!account) return res.status(401).json({ message: 'Войдите в аккаунт, чтобы подтвердить e-mail.' })

  const sql = getSql()
  await ensureSchema(sql)
  const { code } = parseBody(req)
  const result = await verifyEmailCode(sql, account.id, String(code ?? ''))
  if (!result.ok) return res.status(400).json({ message: result.message })
  return res.json({ ok: true, emailVerified: true })
}

/** POST /api/auth/resend-code — выслать код подтверждения повторно. */
async function resendVerificationCode(req: ApiRequest, res: ApiResponse) {
  const account = verifyToken(bearer(req))
  if (!account) return res.status(401).json({ message: 'Войдите в аккаунт, чтобы получить код.' })

  const problems = mailConfigProblems()
  if (problems.length > 0) {
    console.error(`[auth/resend-code] отправка писем не настроена: ${problems.join(' ')}`)
    return res.status(503).json({
      message:
        'Отправка писем на сервере не настроена. Администратору: задайте переменные окружения ' +
        'почты (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM) — состояние видно в админке, ' +
        'раздел «База данных» → «Отправка писем».',
    })
  }

  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`
    SELECT id, name, email, email_verified FROM users WHERE id = ${account.id} LIMIT 1
  `
  const row = rows[0]
  if (!row) return res.status(401).json({ message: 'Аккаунт не найден. Войдите заново.' })
  if (row.email_verified) return res.json({ message: 'E-mail уже подтверждён.', sent: false })

  const result = await sendVerificationCode(sql, {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
  })
  if (!result.ok) {
    return res.status(429).json({ message: result.message, retryAfterSec: result.retryAfterSec })
  }
  return res.json({
    message: `Код отправлен на ${row.email}. Он действует ${CODE_TTL_MIN} минут.`,
    sent: true,
  })
}

/** Сколько живёт ссылка восстановления пароля. */
const RESET_TTL_HOURS = 2

/** Не больше трёх писем восстановления на аккаунт в час. */
const RESET_MAX_PER_HOUR = 3

/** Хэш токена восстановления: в базе храним только его. */
function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * POST /api/auth/recover
 * Тело: { email }. Заводит одноразовый токен и отправляет на почту письмо со
 * ссылкой на страницу смены пароля.
 *
 * Ответ одинаков для существующего и несуществующего адреса — по нему нельзя
 * перебором узнать, кто зарегистрирован в академии. Зато если почта не настроена
 * или SMTP отвечает ошибкой, эндпоинт честно отдаёт ошибку: молчаливое «письмо
 * отправлено» при неработающей отправке — ровно тот случай, из-за которого
 * восстановление казалось рабочим, а инструкция не приходила.
 */
async function recoverPassword(req: ApiRequest, res: ApiResponse) {
  const { email } = parseBody(req)
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized.includes('@')) {
    return res.status(400).json({ message: 'Укажите корректный e-mail.' })
  }

  const problems = mailConfigProblems()
  if (problems.length > 0) {
    console.error(`[auth/recover] отправка писем не настроена: ${problems.join(' ')}`)
    return res.status(503).json({
      message:
        'Отправка писем на сервере не настроена, поэтому инструкция не уйдёт. ' +
        'Администратору: задайте переменные окружения почты (SMTP_HOST, SMTP_USER, ' +
        'SMTP_PASSWORD, MAIL_FROM) и повторите попытку.',
    })
  }

  const sql = getSql()
  await ensureSchema(sql)

  // Лимит на аккаунт уже есть ниже, но он не мешает перебирать чужие адреса
  // подряд с одной машины: так форма превращается в рассыльщик писем от имени
  // академии. Поэтому ограничиваем ещё и по источнику запроса.
  const byIp = await hitRateLimit(
    sql,
    'recover:ip',
    clientIp(req),
    RECOVER_MAX_PER_IP,
    SIGNUP_WINDOW_SEC,
  )
  if (!byIp.allowed) {
    return tooManyRequests(res, byIp, 'Слишком много запросов восстановления. Попробуйте позже.')
  }

  const rows = await sql`SELECT id, name, email FROM users WHERE email = ${normalized} LIMIT 1`
  const user = rows[0]

  const okMessage = {
    message:
      `Если аккаунт с адресом ${normalized} существует, инструкция по восстановлению уже отправлена. ` +
      'Проверьте входящие и папку «Спам» — ссылка действует 2 часа.',
  }

  // Адреса нет в базе — отвечаем так же, как при успехе, но письмо не шлём.
  if (!user) {
    console.log(`[auth/recover] запрос для незарегистрированного адреса ${normalized}`)
    return res.json(okMessage)
  }

  // Не больше трёх писем в час на аккаунт: иначе форма превращается в
  // бесплатный рассыльщик с нашего ящика и топит репутацию домена. Ответ тот
  // же самый — по нему по-прежнему нельзя понять, есть ли такой аккаунт.
  const [{ recent }] = await sql`
    SELECT COUNT(*)::int AS recent FROM password_resets
    WHERE user_id = ${user.id as string} AND created_at > NOW() - INTERVAL '1 hour'
  `
  if (Number(recent) >= RESET_MAX_PER_HOUR) {
    console.warn(`[auth/recover] превышен лимит писем для ${normalized}`)
    return res.json(okMessage)
  }

  // Прошлые ссылки этого пользователя гасим: активной остаётся только последняя.
  await sql`
    UPDATE password_resets SET used_at = NOW()
    WHERE user_id = ${user.id as string} AND used_at IS NULL
  `

  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000)
  await sql`
    INSERT INTO password_resets (token_hash, user_id, expires_at)
    VALUES (${hashResetToken(token)}, ${user.id as string}, ${expiresAt.toISOString()})
  `

  const link = `${siteOrigin(req)}/reset-password?token=${encodeURIComponent(token)}`
  try {
    await sendMail(
      passwordResetMessage({
        to: user.email as string,
        name: (user.name as string) || '',
        link,
        ttlHours: RESET_TTL_HOURS,
      }),
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // Токен больше не нужен: письмо не ушло, ссылку никто не получил.
    await sql`UPDATE password_resets SET used_at = NOW() WHERE user_id = ${user.id as string} AND used_at IS NULL`
    return res.status(502).json({
      message: `Не удалось отправить письмо: ${reason}. Проверьте настройки почты на сервере.`,
    })
  }

  return res.json(okMessage)
}

/**
 * POST /api/auth/reset
 * Тело: { token, password }. Меняет пароль по одноразовой ссылке из письма и
 * сразу выдаёт токен сессии — после смены пароля пользователь уже внутри.
 */
async function resetPassword(req: ApiRequest, res: ApiResponse) {
  const body = parseBody(req)
  const token = String(body.token ?? '')
  const password = String(body.password ?? '')
  if (!token) return res.status(400).json({ message: 'Ссылка восстановления неполная — откройте её из письма целиком.' })
  if (password.length < 8) {
    return res.status(400).json({ message: 'Пароль должен быть не короче 8 символов.' })
  }

  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`
    SELECT user_id, expires_at, used_at FROM password_resets
    WHERE token_hash = ${hashResetToken(token)} LIMIT 1
  `
  const reset = rows[0]
  const expired = reset && new Date(reset.expires_at as string).getTime() < Date.now()
  if (!reset || reset.used_at || expired) {
    return res.status(400).json({
      message: 'Ссылка восстановления недействительна или уже использована. Запросите новую на странице входа.',
    })
  }

  const userRows = await sql`
    SELECT id, name, email, role, kind FROM users WHERE id = ${reset.user_id as string} LIMIT 1
  `
  const row = userRows[0]
  if (!row) return res.status(400).json({ message: 'Аккаунт не найден.' })

  const hash = await bcrypt.hash(password, 10)
  // Переход по ссылке из письма доказывает владение почтой — заодно
  // подтверждаем адрес, чтобы не гонять человека ещё и через ввод кода.
  await sql`UPDATE users SET password_hash = ${hash}, email_verified = TRUE WHERE id = ${row.id as string}`
  await sql`UPDATE password_resets SET used_at = NOW() WHERE token_hash = ${hashResetToken(token)}`

  const user: User = {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: row.role as string,
    kind: (row.kind as User['kind']) ?? 'student',
    emailVerified: true,
  }
  // Смена пароля открывает сессию — значит нужна и cookie, иначе после сброса
  // материалы SCORM не откроются до следующего входа.
  // Имя не `token`: так называется одноразовый токен из письма, объявленный
  // выше в этой же функции.
  const sessionToken = signToken({ id: user.id, kind: user.kind })
  res.setHeader('Set-Cookie', sessionCookie(sessionToken))
  return res.json({ ...user, token: sessionToken })
}

async function listCourses(): Promise<Course[]> {
  const sql = getSql()
  const rows = await sql`SELECT data FROM courses ORDER BY sort_order ASC`
  return rows.map((r) => r.data as Course)
}

async function getCourse(id: string): Promise<Course | undefined> {
  const sql = getSql()
  const rows = await sql`SELECT data FROM courses WHERE id = ${id} LIMIT 1`
  return rows[0] ? (rows[0].data as Course) : undefined
}

async function createCourse(req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const body = parseBody(req) as Partial<Course>
  const id = (body.id && String(body.id).trim()) || slugify(String(body.title ?? 'course'))
  const taken = await sql`SELECT id FROM courses`
  const ids = new Set(taken.map((r) => r.id as string))
  const finalId = uniqueId(id, ids)
  const course = { ...body, id: finalId } as Course
  const [{ max }] = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS max FROM courses`
  await sql`
    INSERT INTO courses (id, data, sort_order)
    VALUES (${finalId}, ${JSON.stringify(course)}::jsonb, ${Number(max)})
  `
  return res.status(201).json(course)
}

async function updateCourse(id: string, req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const rows = await sql`SELECT data FROM courses WHERE id = ${id} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Программа не найдена' })
  const patch = parseBody(req) as Partial<Course>
  const next = { ...(rows[0].data as Course), ...patch, id } as Course
  await sql`UPDATE courses SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW() WHERE id = ${id}`
  return res.json(next)
}

async function deleteCourse(id: string, res: ApiResponse) {
  const sql = getSql()
  await sql`DELETE FROM courses WHERE id = ${id}`
  return res.status(204).end()
}

// ---------------- news helpers ----------------

async function listNews(): Promise<NewsItem[]> {
  try {
    const sql = getSql()
    await ensureSchema(sql)
    const rows = await sql`SELECT data FROM news ORDER BY published_at DESC NULLS LAST`
    return rows.map((r) => r.data as NewsItem)
  } catch {
    // БД недоступна — новостей нет.
    return []
  }
}

async function getNewsItem(id: string): Promise<NewsItem | undefined> {
  const sql = getSql()
  const rows = await sql`SELECT data FROM news WHERE id = ${id} LIMIT 1`
  return rows[0] ? (rows[0].data as NewsItem) : undefined
}

async function createNews(req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  const body = parseBody(req) as Partial<NewsItem>
  const desired = (body.id && String(body.id).trim()) || slugify(String(body.title ?? 'news'))
  const taken = await sql`SELECT id FROM news`
  const ids = new Set(taken.map((r) => r.id as string))
  const id = uniqueId(desired, ids)
  const item = { ...body, id } as NewsItem
  await sql`
    INSERT INTO news (id, data, published_at, source)
    VALUES (${id}, ${JSON.stringify(item)}::jsonb, ${item.date ?? null}, 'manual')
  `
  return res.status(201).json(item)
}

async function updateNews(id: string, req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const rows = await sql`SELECT data FROM news WHERE id = ${id} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Новость не найдена' })
  const patch = parseBody(req) as Partial<NewsItem>
  const next = { ...(rows[0].data as NewsItem), ...patch, id } as NewsItem
  await sql`
    UPDATE news SET data = ${JSON.stringify(next)}::jsonb,
      published_at = ${next.date ?? null}, updated_at = NOW()
    WHERE id = ${id}
  `
  return res.json(next)
}

async function deleteNews(id: string, res: ApiResponse) {
  const sql = getSql()
  await sql`DELETE FROM news WHERE id = ${id}`
  return res.status(204).end()
}

// ---------------- news comments & reactions ----------------

function toComment(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    newsId: r.news_id as string,
    userId: (r.user_id as string | null) ?? null,
    author: r.author as string,
    body: r.body as string,
    createdAt: r.created_at as string,
  }
}

async function listComments(newsId: string) {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`
    SELECT id, news_id, user_id, author, body, created_at
    FROM news_comments WHERE news_id = ${newsId} ORDER BY created_at ASC
  `
  return rows.map(toComment)
}

async function createComment(newsId: string, req: ApiRequest, res: ApiResponse) {
  // Автора берём из токена, а не из тела запроса: иначе кто угодно оставляет
  // комментарии от чужого имени и с чужим userId.
  const account = verifyToken(bearer(req))
  if (!account) {
    return res.status(401).json({ message: 'Войдите в аккаунт, чтобы оставить комментарий.' })
  }

  const sql = getSql()
  await ensureSchema(sql)
  const b = parseBody(req)
  const body = String(b.body ?? '').trim()
  const userId = account.id
  const named = await sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`
  if (!named[0]) return res.status(401).json({ message: 'Аккаунт не найден. Войдите заново.' })
  const author = (String(named[0].name ?? '').trim() || 'Участник').slice(0, 120)
  if (!body) return res.status(400).json({ message: 'Комментарий не может быть пустым.' })
  if (body.length > 2000) return res.status(400).json({ message: 'Слишком длинный комментарий (макс. 2000 символов).' })
  const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const rows = await sql`
    INSERT INTO news_comments (id, news_id, user_id, author, body)
    VALUES (${id}, ${newsId}, ${userId}, ${author}, ${body})
    RETURNING id, news_id, user_id, author, body, created_at
  `
  return res.status(201).json(toComment(rows[0]))
}

async function deleteComment(
  newsId: string,
  commentId: string,
  req: ApiRequest,
  res: ApiResponse,
) {
  // Права считаем по токену сессии. Раньше здесь брался ?userId= из адреса, а
  // роль искалась в базе по этому же значению — то есть «администратором»
  // становился любой, кто подставил в ссылку идентификатор администратора
  // (а он публично виден в списке комментариев).
  const account = verifyToken(bearer(req))
  if (!account) {
    return res.status(401).json({ message: 'Войдите в аккаунт, чтобы удалить комментарий.' })
  }

  const sql = getSql()
  const rows = await sql`SELECT user_id FROM news_comments WHERE id = ${commentId} AND news_id = ${newsId} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Комментарий не найден' })
  const isOwner = Boolean(rows[0].user_id) && rows[0].user_id === account.id
  const isAdmin = account.kind === 'admin'
  if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Нет прав на удаление комментария.' })
  await sql`DELETE FROM news_comments WHERE id = ${commentId}`
  return res.status(204).end()
}

async function getReactions(newsId: string, userId: string) {
  const sql = getSql()
  await ensureSchema(sql)
  const counts = await sql`
    SELECT emoji, COUNT(*)::int AS n FROM news_reactions WHERE news_id = ${newsId} GROUP BY emoji
  `
  const mine = userId
    ? await sql`SELECT emoji FROM news_reactions WHERE news_id = ${newsId} AND user_id = ${userId}`
    : []
  const countsObj: Record<string, number> = {}
  for (const r of counts) countsObj[r.emoji as string] = Number(r.n)
  return { counts: countsObj, mine: mine.map((r) => r.emoji as string) }
}

async function toggleReaction(newsId: string, req: ApiRequest, res: ApiResponse) {
  // userId — только из токена: из тела запроса он позволял ставить и снимать
  // реакции от имени любого пользователя.
  const account = verifyToken(bearer(req))
  if (!account) return res.status(401).json({ message: 'Войдите, чтобы поставить реакцию.' })

  const sql = getSql()
  await ensureSchema(sql)
  const b = parseBody(req)
  const userId = account.id
  const emoji = String(b.emoji ?? '').trim()
  if (!emoji || emoji.length > 16) return res.status(400).json({ message: 'Некорректная реакция.' })
  const existing = await sql`
    SELECT 1 FROM news_reactions WHERE news_id = ${newsId} AND user_id = ${userId} AND emoji = ${emoji} LIMIT 1
  `
  if (existing[0]) {
    await sql`DELETE FROM news_reactions WHERE news_id = ${newsId} AND user_id = ${userId} AND emoji = ${emoji}`
  } else {
    await sql`
      INSERT INTO news_reactions (news_id, user_id, emoji) VALUES (${newsId}, ${userId}, ${emoji})
      ON CONFLICT DO NOTHING
    `
  }
  return res.json(await getReactions(newsId, userId))
}

// ---------------- admin participants (БД) ----------------

async function listParticipants(): Promise<AdminUser[]> {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`SELECT data FROM participants ORDER BY sort_order ASC`
  return rows.map((r) => r.data as AdminUser)
}

async function getParticipant(id: string): Promise<AdminUser | undefined> {
  const sql = getSql()
  const rows = await sql`SELECT data FROM participants WHERE id = ${id} LIMIT 1`
  return rows[0] ? (rows[0].data as AdminUser) : undefined
}

async function createParticipant(req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  const body = parseBody(req) as Partial<AdminUser>
  const taken = await sql`SELECT id FROM participants`
  const ids = new Set(taken.map((r) => r.id as string))
  const id = uniqueId((body.id && String(body.id).trim()) || `u-${Date.now().toString(36)}`, ids)
  const participant = { ...body, id } as AdminUser
  const [{ max }] = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS max FROM participants`
  await sql`
    INSERT INTO participants (id, data, sort_order)
    VALUES (${id}, ${JSON.stringify(participant)}::jsonb, ${Number(max)})
  `
  return res.status(201).json(participant)
}

async function updateParticipant(id: string, req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const rows = await sql`SELECT data FROM participants WHERE id = ${id} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Участник не найден' })
  const patch = parseBody(req) as Partial<AdminUser>
  const next = { ...(rows[0].data as AdminUser), ...patch, id } as AdminUser
  await sql`UPDATE participants SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW() WHERE id = ${id}`
  return res.json(next)
}

async function setParticipantStatus(id: string, status: string, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`SELECT data FROM participants WHERE id = ${id} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Участник не найден' })
  const next = { ...(rows[0].data as AdminUser), status } as AdminUser
  await sql`UPDATE participants SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW() WHERE id = ${id}`
  return res.json(next)
}

async function deleteParticipant(id: string, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  await sql`DELETE FROM participants WHERE id = ${id}`
  return res.status(204).end()
}

// ---------------- admin orders (БД) ----------------

async function listOrders(): Promise<Order[]> {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`SELECT data FROM orders ORDER BY sort_order ASC`
  return rows.map((r) => r.data as Order)
}

async function getOrder(id: string): Promise<Order | undefined> {
  const sql = getSql()
  const rows = await sql`SELECT data FROM orders WHERE id = ${id} LIMIT 1`
  return rows[0] ? (rows[0].data as Order) : undefined
}

async function createOrder(req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  const body = parseBody(req) as Partial<Order>
  const taken = await sql`SELECT id FROM orders`
  const ids = new Set(taken.map((r) => r.id as string))
  let id = (body.id && String(body.id).trim()) || ''
  if (!id) {
    let maxNum = 1042
    for (const existing of ids) {
      const n = Number(existing.replace(/\D/g, ''))
      if (Number.isFinite(n) && n > maxNum) maxNum = n
    }
    id = `ORD-${maxNum + 1}`
  }
  id = uniqueId(id, ids)
  const order = { ...body, id } as Order
  const [{ min }] = await sql`SELECT COALESCE(MIN(sort_order), 0) - 1 AS min FROM orders`
  await sql`
    INSERT INTO orders (id, data, sort_order)
    VALUES (${id}, ${JSON.stringify(order)}::jsonb, ${Number(min)})
  `
  return res.status(201).json(order)
}

async function updateOrder(id: string, req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const rows = await sql`SELECT data FROM orders WHERE id = ${id} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Заказ не найден' })
  const patch = parseBody(req) as Partial<Order>
  const next = { ...(rows[0].data as Order), ...patch, id } as Order
  await sql`UPDATE orders SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW() WHERE id = ${id}`
  return res.json(next)
}

async function deleteOrder(id: string, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  await sql`DELETE FROM orders WHERE id = ${id}`
  return res.status(204).end()
}

// ---------------- заявки на поступление ----------------

/**
 * POST /api/applications — приём заявки со страницы программы.
 *
 * Публичный эндпоинт: имя, e-mail и телефон приходят из формы, статус и дату
 * проставляет сервер (клиенту их доверять нельзя). Если запрос пришёл с
 * действующим токеном сессии, заявку связываем с аккаунтом.
 */
async function createApplication(req: ApiRequest, res: ApiResponse) {
  const body = parseBody(req)
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = String(body.phone ?? '').trim()
  const comment = String(body.comment ?? '').trim()
  const programId = String(body.programId ?? '').trim()
  const programTitle = String(body.programTitle ?? '').trim()

  if (!name || !email || !phone) {
    return res.status(400).json({ message: 'Укажите имя, e-mail и телефон.' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Укажите корректный e-mail.' })
  }
  if (phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ message: 'Укажите корректный номер телефона.' })
  }
  if (!programId) {
    return res.status(400).json({ message: 'Не указана программа.' })
  }

  // Форма публичная по определению, поэтому без лимита её можно залить
  // мусорными заявками — а это таблица с персональными данными, которую потом
  // разбирает приёмная комиссия.
  const sql = getSql()
  await ensureSchema(sql)
  const limit = await hitRateLimit(
    sql,
    'application:ip',
    clientIp(req),
    APPLICATION_MAX_PER_IP,
    SIGNUP_WINDOW_SEC,
  )
  if (!limit.allowed) {
    return tooManyRequests(
      res,
      limit,
      'Заявка уже отправлена. Если нужно подать ещё одну, попробуйте позже или напишите в приёмную комиссию.',
    )
  }

  const session = verifyToken(bearer(req))
  const application: ProgramApplication = {
    id: `APP-${Date.now().toString(36).toUpperCase()}`,
    programId,
    programTitle: programTitle || programId,
    name: name.slice(0, 200),
    email: email.slice(0, 200),
    phone: phone.slice(0, 50),
    ...(comment ? { comment: comment.slice(0, 2000) } : {}),
    status: 'new',
    createdAt: new Date().toISOString(),
    ...(session ? { userId: session.id } : {}),
  }

  // prepend=true — свежие заявки оказываются вверху списка в админ-панели.
  const created = await contentCreate<ProgramApplication>(
    'applications',
    application,
    'application',
    true,
  )
  return res.status(201).json(created)
}

// ---------------- доступ к программам ----------------

/**
 * GET /api/me/session — проверка сессии.
 *
 * Профиль в браузере живёт бессрочно, а токен — нет. Раньше протухший токен
 * никак себя не проявлял: человек оставался «залогинен», но сервер его не
 * узнавал, и список оплаченных программ приходил пустым — со стороны это
 * выглядело как самопроизвольный сброс доступа. Теперь клиент может спросить,
 * жива ли сессия, и получить честный 401 либо продлённый токен.
 */
async function listAccessibleCourseIds(req: ApiRequest): Promise<string[]> {
  const account = verifyToken(bearer(req))
  if (!account) return []
  return await accessibleCourseIdsFor(account.id)
}

/**
 * Кэш оплаченных программ по пользователю. Раздача SCORM спрашивает доступ на
 * каждый файл пакета (а их сотни), поэтому ходить в базу каждый раз нельзя.
 * Короткий TTL: выдача доступа после оплаты подхватится в течение полуминуты.
 */
const ACCESS_TTL_MS = 30_000
const accessCache = new Map<string, { expires: number; ids: string[] }>()

async function accessibleCourseIdsFor(userId: string): Promise<string[]> {
  const cached = accessCache.get(userId)
  if (cached && cached.expires > Date.now()) return cached.ids

  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`
    SELECT data->>'courseId' AS course_id FROM orders
    WHERE data->>'userId' = ${userId} AND data->>'status' = 'paid'
  `
  const ids = Array.from(new Set(rows.map((r) => r.course_id as string).filter(Boolean)))
  accessCache.set(userId, { expires: Date.now() + ACCESS_TTL_MS, ids })
  return ids
}

/** Бесплатная программа открыта любому вошедшему слушателю. */
function isFreeCourse(course: Pick<Course, 'price'>): boolean {
  return !course.price || course.price <= 0
}

/**
 * Программы, использующие SCORM-пакет. Связь — через launchUrl уроков, который
 * при загрузке пакета формируется как `/scorm-store/<id>/<точка входа>`.
 */
const PACKAGE_TTL_MS = 30_000
let coursesByPackage: { expires: number; map: Map<string, Course[]> } | null = null

async function coursesUsingScormPackage(packageId: string): Promise<Course[]> {
  if (!coursesByPackage || coursesByPackage.expires <= Date.now()) {
    const map = new Map<string, Course[]>()
    for (const course of await listCourses()) {
      for (const module of course.modules ?? []) {
        for (const lesson of module.lessons ?? []) {
          const id = scormPackageIdFromUrl(lesson.launchUrl)
          if (!id) continue
          const list = map.get(id) ?? []
          if (!list.some((c) => c.id === course.id)) list.push(course)
          map.set(id, list)
        }
      }
    }
    coursesByPackage = { expires: Date.now() + PACKAGE_TTL_MS, map }
  }
  return coursesByPackage.map.get(packageId) ?? []
}

/** id пакета из ссылки запуска урока (`/scorm-store/<id>/...`). */
function scormPackageIdFromUrl(launchUrl: string | undefined): string | undefined {
  if (!launchUrl) return undefined
  const m = launchUrl.match(/\/scorm-store\/([^/]+)\//)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

type ScormAccess = { ok: true } | { ok: false; status: number; hint: string }

/**
 * Есть ли у запроса право на файлы пакета.
 *
 * Раньше раздача `/scorm-store/*` не спрашивала вообще ничего: зная id пакета
 * (а его публично отдавал GET /api/scorm), любой посетитель скачивал платный
 * курс целиком. Проверка доступа жила только на клиенте, то есть была
 * оформлением, а не защитой.
 */
async function scormAccess(packageId: string, req: ApiRequest): Promise<ScormAccess> {
  const account = browserSession(req)
  if (!account) {
    return {
      ok: false,
      status: 401,
      hint: 'Войдите в личный кабинет академии и откройте программу заново.',
    }
  }
  if (account.kind === 'admin') return { ok: true }

  const courses = await coursesUsingScormPackage(packageId)
  if (courses.length === 0) {
    return {
      ok: false,
      status: 403,
      hint: 'Пакет не привязан ни к одной программе. Администратору: подключите его к уроку в админ-панели.',
    }
  }
  if (courses.some(isFreeCourse)) return { ok: true }

  const owned = await accessibleCourseIdsFor(account.id)
  if (courses.some((c) => owned.includes(c.id))) return { ok: true }

  return {
    ok: false,
    status: 403,
    hint: 'Доступ к материалам открывается после оплаты программы.',
  }
}

/**
 * Копия программы без ссылок запуска уроков — для тех, у кого нет доступа.
 * Описание, структура и цена остаются публичными: закрыт только сам контент.
 */
function withoutLaunchUrls(course: Course): Course {
  if (!course.modules?.some((m) => m.lessons?.some((l) => l.launchUrl))) return course
  return {
    ...course,
    modules: course.modules.map((module) => ({
      ...module,
      lessons: (module.lessons ?? []).map(({ launchUrl: _launchUrl, ...lesson }) => lesson),
    })),
  }
}

/** Отдать программы, вырезав ссылки запуска у недоступных пользователю. */
async function visibleCourses(courses: Course[], req: ApiRequest): Promise<Course[]> {
  const account = verifyToken(bearer(req))
  if (account?.kind === 'admin') return courses
  const owned = account ? await accessibleCourseIdsFor(account.id) : []
  return courses.map((course) =>
    account && (isFreeCourse(course) || owned.includes(course.id))
      ? course
      : withoutLaunchUrls(course),
  )
}

// ---------------- payments (ЮKassa) ----------------

/**
 * Базовый URL сайта (return_url оплаты, ссылки в письмах).
 *
 * Заголовки запроса здесь — крайний случай и только со сверкой по списку
 * разрешённых доменов. Заголовок Host/X-Forwarded-Host подставляет тот, кто
 * шлёт запрос: без проверки достаточно было отправить восстановление пароля с
 * `X-Forwarded-Host: attacker.example`, чтобы жертве ушло настоящее письмо от
 * академии со ссылкой на чужой домен, а переход по ней отдал бы токен сброса.
 */
function siteOrigin(req: ApiRequest): string {
  const configured = process.env.SITE_URL || process.env.YOOKASSA_RETURN_URL
  if (configured) return configured.replace(/\/$/, '')

  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || ''
  const host = String(rawHost).split(',')[0].trim().toLowerCase()

  if (host && isTrustedHost(host)) return `${proto}://${host}`

  // Домен из заголовка не подтверждён. Своего адреса деплоя у нас больше нет
  // (на Vercel его подставляла платформа), поэтому остаётся только локальный
  // адрес разработки: в проде задавайте SITE_URL.
  return 'http://localhost:5173'
}

/**
 * Домен из заголовка — свой? Разрешены домены собственного деплоя и всё, что
 * перечислено в ALLOWED_HOSTS (через запятую), плюс localhost для разработки.
 */
function isTrustedHost(host: string): boolean {
  const bare = host.replace(/:\d+$/, '')
  if (process.env.NODE_ENV !== 'production' && (bare === 'localhost' || bare === '127.0.0.1')) {
    return true
  }
  const allowed = new Set(
    [
      // Канонический адрес сайта — тоже свой домен. Без него CORS отклонял бы
      // собственный фронтенд, если ALLOWED_HOSTS не задан.
      process.env.SITE_URL,
      ...(process.env.ALLOWED_HOSTS ?? '').split(','),
    ]
      .map((v) => (v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean),
  )
  return allowed.has(bare) || allowed.has(host)
}

/**
 * Свой ли origin запроса. Отдельные превью-деплои Vercel живут на доменах вида
 * `<проект>-<хэш>.vercel.app`, поэтому их тоже пропускаем: иначе админка на
 * превью не сможет обратиться к своему же API.
 */
function isAllowedOrigin(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).host.toLowerCase()
  } catch {
    return false
  }
  if (isTrustedHost(host)) return true
  return host.endsWith('.vercel.app')
}

/**
 * POST /api/payments/create
 * Тело: { courseId, email? }. Требует токен сессии — заказ привязывается к
 * пользователю из токена (клиент чужой userId подставить не может).
 * Создаёт платёж в ЮKassa, заводит заказ со статусом pending и возвращает
 * ссылку на платёжную форму. Цена берётся из БД — клиент её не диктует.
 */
async function createCoursePayment(req: ApiRequest, res: ApiResponse) {
  if (!isYooKassaConfigured()) {
    return res.status(503).json({ message: 'Онлайн-оплата временно недоступна.' })
  }
  const session = verifyToken(bearer(req))
  if (!session) {
    return res.status(401).json({ message: 'Войдите в личный кабинет, чтобы оформить доступ.' })
  }
  const userId = session.id
  const { courseId, email } = parseBody(req)
  const course = await getCourse(String(courseId ?? ''))
  if (!course) return res.status(404).json({ message: 'Программа не найдена' })
  if (!course.price || course.price <= 0) {
    return res.status(400).json({ message: 'У программы не задана цена.' })
  }

  // Защита от повторной оплаты: если по программе уже есть оплаченный заказ,
  // второй платёж не создаём. Пока доступ мог «пропадать» из-за протухшей
  // сессии, слушатели покупали один и тот же курс дважды.
  const already = await accessibleCourseIdsFor(userId)
  if (already.includes(course.id)) {
    return res.status(409).json({
      message: 'Программа уже оплачена — доступ открыт в личном кабинете.',
    })
  }

  const sql = getSql()
  await ensureSchema(sql)

  // Заводим заказ заранее (pending), чтобы webhook мог его найти.
  const taken = await sql`SELECT id FROM orders`
  const ids = new Set(taken.map((r) => r.id as string))
  let maxNum = 1042
  for (const existing of ids) {
    const n = Number(String(existing).replace(/\D/g, ''))
    if (Number.isFinite(n) && n > maxNum) maxNum = n
  }
  const orderId = uniqueId(`ORD-${maxNum + 1}`, ids)

  const payment = await createPayment({
    amount: course.price,
    currency: 'RUB',
    description: `Доступ к программе «${course.title}» (${orderId})`,
    returnUrl: `${siteOrigin(req)}/checkout?course=${course.id}&order=${orderId}`,
    metadata: { orderId, courseId: course.id, userId },
    idempotenceKey: orderId,
    receiptEmail: email ? String(email) : undefined,
  })

  const order: Order = {
    id: orderId,
    userId,
    courseId: course.id,
    amount: course.price,
    date: new Date().toISOString().slice(0, 10),
    status: 'pending',
    method: 'Карта',
    email: email ? String(email) : undefined,
    paymentId: payment.id,
    provider: 'yookassa',
  }
  const [{ min }] = await sql`SELECT COALESCE(MIN(sort_order), 0) - 1 AS min FROM orders`
  await sql`
    INSERT INTO orders (id, data, sort_order)
    VALUES (${orderId}, ${JSON.stringify(order)}::jsonb, ${Number(min)})
  `

  const confirmationUrl = payment.confirmation?.confirmation_url
  if (!confirmationUrl) {
    return res.status(502).json({ message: 'ЮKassa не вернула ссылку на оплату.' })
  }
  return res.status(201).json({ orderId, paymentId: payment.id, confirmationUrl })
}

/** Применить актуальный статус платежа ЮKassa к заказу в БД. */
async function applyPaymentStatus(
  payment: { id: string; status: string; metadata?: Record<string, string> },
  origin?: string,
) {
  const sql = getSql()
  await ensureSchema(sql)
  const orderId = payment.metadata?.orderId
  const rows = orderId
    ? await sql`SELECT data FROM orders WHERE id = ${orderId} LIMIT 1`
    : await sql`SELECT data FROM orders WHERE data->>'paymentId' = ${payment.id} LIMIT 1`
  if (!rows[0]) return null
  const order = rows[0].data as Order
  const nextStatus: OrderStatus =
    payment.status === 'succeeded'
      ? 'paid'
      : payment.status === 'canceled'
        ? 'refunded'
        : 'pending'
  if (order.status === nextStatus) return order
  const next: Order = { ...order, status: nextStatus }

  // Письмо об открытом доступе — один раз на заказ. Отметку храним в самом
  // заказе: повторный вызов (webhook и страница возврата приходят оба) не
  // должен слать слушателю второе письмо.
  if (nextStatus === 'paid' && !next.accessEmailSentAt && mailConfigProblems().length === 0) {
    const course = await getCourse(next.courseId)
    const users = await sql`SELECT name, email FROM users WHERE id = ${next.userId} LIMIT 1`
    const to = (next.email || (users[0]?.email as string) || '').trim()
    if (course && to) {
      const sent = await sendCourseAccessEmail({
        to,
        name: (users[0]?.name as string) || '',
        courseTitle: course.title,
        courseId: course.id,
        origin: origin || process.env.SITE_URL || '',
      })
      if (sent) next.accessEmailSentAt = new Date().toISOString()
    }
  }

  await sql`UPDATE orders SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW() WHERE id = ${order.id}`
  return next
}

/**
 * POST /api/payments/webhook
 * Уведомление от ЮKassa. Доверяем не телу, а перезапрашиваем платёж по id
 * (защита от подделки) и проставляем статус заказа.
 */
async function handlePaymentWebhook(req: ApiRequest, res: ApiResponse) {
  if (!isYooKassaConfigured()) return res.status(503).json({ message: 'not configured' })
  try {
    const body = parseBody(req) as { object?: { id?: string } }
    const paymentId = body.object?.id
    if (!paymentId) return res.status(400).json({ message: 'no payment id' })
    const payment = await getPayment(String(paymentId))
    await applyPaymentStatus(payment, siteOrigin(req))
  } catch (err) {
    console.error('[payments] webhook error:', err)
    // Возвращаем 200, чтобы ЮKassa не зациклила ретраи на нашей ошибке БД.
  }
  return res.status(200).json({ ok: true })
}

/**
 * GET /api/payments/:id
 * Используется на странице возврата, чтобы показать актуальный статус, не
 * дожидаясь webhook.
 */
async function getPaymentStatus(id: string, req: ApiRequest, res: ApiResponse) {
  if (verifyToken(bearer(req))?.kind !== 'admin') {
    return res.status(403).json({ message: 'Требуются права администратора.' })
  }
  if (!isYooKassaConfigured()) return res.status(503).json({ message: 'Онлайн-оплата недоступна.' })
  const payment = await getPayment(id)
  const order = await applyPaymentStatus(payment, siteOrigin(req))
  return res.json({ paymentId: payment.id, status: payment.status, paid: payment.status === 'succeeded', orderId: order?.id })
}

/**
 * GET /api/payments/by-order/:orderId
 * Возврат после оплаты: по номеру заказа находим платёж, перезапрашиваем его
 * статус в ЮKassa и отдаём актуальное состояние (не дожидаясь webhook).
 * Статус заказа виден только его владельцу и администратору.
 */
async function getOrderPaymentStatus(orderId: string, req: ApiRequest, res: ApiResponse) {
  const session = verifyToken(bearer(req))
  if (!session) return res.status(401).json({ message: 'Войдите в личный кабинет.' })
  const sql = getSql()
  const rows = await sql`SELECT data FROM orders WHERE id = ${orderId} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Заказ не найден' })
  const order = rows[0].data as Order
  if (session.kind !== 'admin' && order.userId !== session.id) {
    return res.status(403).json({ message: 'Заказ оформлен на другой аккаунт.' })
  }
  if (!order.paymentId || !isYooKassaConfigured()) {
    return res.json({ orderId, status: order.status, paid: order.status === 'paid' })
  }
  const payment = await getPayment(order.paymentId)
  const updated = await applyPaymentStatus(payment, siteOrigin(req))
  return res.json({
    orderId,
    status: (updated ?? order).status,
    paid: (updated ?? order).status === 'paid',
    courseId: order.courseId,
  })
}

async function updateProfile(req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const { id, name } = parseBody(req)
  if (!id || !name) return res.status(400).json({ message: 'id и name обязательны' })
  const rows = await sql`UPDATE users SET name = ${String(name)} WHERE id = ${String(id)} RETURNING id, name, email, role, kind`
  if (!rows[0]) return res.status(404).json({ message: 'Пользователь не найден' })
  const u = rows[0]
  return res.json({ id: u.id, name: u.name, email: u.email, role: u.role, kind: u.kind })
}

async function dbStatus(res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  const [{ count: coursesCount }] = await sql`SELECT COUNT(*)::int AS count FROM courses`
  const [{ count: usersCount }] = await sql`SELECT COUNT(*)::int AS count FROM users`
  const users = await sql`
    SELECT id, name, email, role, kind, created_at
    FROM users ORDER BY created_at ASC
  `
  return res.json({
    tables: [
      { name: 'courses', label: 'Программы', rows: Number(coursesCount) },
      { name: 'users', label: 'Аккаунты', rows: Number(usersCount) },
    ],
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      kind: u.kind,
      createdAt: u.created_at,
    })),
  })
}

async function createDbUser(req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  await ensureSchema(sql)
  const body = parseBody(req)
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = String(body.role ?? '').trim()
  const kind = body.kind === 'admin' ? 'admin' : 'student'
  const password = String(body.password ?? '')
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Укажите имя, e-mail и пароль.' })
  }
  const exists = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`
  if (exists[0]) return res.status(409).json({ message: 'Пользователь с таким e-mail уже существует.' })
  const id = `u-${Date.now().toString(36)}`
  const hash = await bcrypt.hash(password, 10)
  const finalRole = role || (kind === 'admin' ? 'Администратор платформы' : 'Слушатель академии')
  await sql`
    INSERT INTO users (id, name, email, role, kind, password_hash)
    VALUES (${id}, ${name}, ${email}, ${finalRole}, ${kind}, ${hash})
  `
  // Слушателя дублируем в «Участники» — иначе его не выбрать при выдаче
  // доступа заказом.
  if (kind === 'student') {
    const today = new Date().toISOString().slice(0, 10)
    const participant: AdminUser = {
      id,
      name,
      email,
      role: 'student',
      status: 'active',
      registeredAt: today,
      lastActiveAt: today,
      enrolledCourseIds: [],
      avgProgress: 0,
    }
    const [{ max }] = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS max FROM participants`
    await sql`
      INSERT INTO participants (id, data, sort_order)
      VALUES (${id}, ${JSON.stringify(participant)}::jsonb, ${Number(max)})
      ON CONFLICT (id) DO NOTHING
    `
  }
  return res.status(201).json({ id, name, email, role: finalRole, kind })
}

async function updateDbUser(id: string, req: ApiRequest, res: ApiResponse) {
  const sql = getSql()
  const rows = await sql`SELECT id, name, email, role, kind FROM users WHERE id = ${id} LIMIT 1`
  if (!rows[0]) return res.status(404).json({ message: 'Пользователь не найден' })
  const cur = rows[0]
  const body = parseBody(req)
  const name = body.name !== undefined ? String(body.name).trim() : (cur.name as string)
  const role = body.role !== undefined ? String(body.role).trim() : (cur.role as string)
  const kind = body.kind === 'admin' ? 'admin' : body.kind === 'student' ? 'student' : (cur.kind as string)
  const password = body.password !== undefined ? String(body.password) : ''

  if (password) {
    const hash = await bcrypt.hash(password, 10)
    await sql`UPDATE users SET name = ${name}, role = ${role}, kind = ${kind}, password_hash = ${hash} WHERE id = ${id}`
  } else {
    await sql`UPDATE users SET name = ${name}, role = ${role}, kind = ${kind} WHERE id = ${id}`
  }
  return res.json({ id, name, email: cur.email, role, kind })
}

async function deleteDbUser(id: string, res: ApiResponse) {
  const sql = getSql()
  await sql`DELETE FROM users WHERE id = ${id}`
  return res.status(204).end()
}

function slugify(value: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ' ': '-',
  }
  const base = value
    .toLowerCase()
    .split('')
    .map((ch) => (ch in map ? map[ch] : /[a-z0-9-]/.test(ch) ? ch : ''))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'course'
}

function uniqueId(desired: string, taken: Set<string>): string {
  let id = desired
  if (taken.has(id)) {
    let n = 2
    while (taken.has(`${id}-${n}`)) n += 1
    id = `${id}-${n}`
  }
  return id
}

// -------- SCORM-пакеты (метаданные в БД + файлы в Object Storage) -----------

interface ScormPackageMeta {
  id: string
  title: string
  launch: string
  launchUrl: string
  fileCount: number
  uploadedAt: string
  /**
   * Origin прежнего хранилища Vercel Blob. Поле осталось у пакетов, залитых до
   * переезда; раздача им больше не пользуется — ключ в Object Storage
   * однозначно собирается как `scorm/<id>/<путь>`.
   */
  blobBase?: string
  /**
   * Карта «путь внутри пакета → {u: адрес, s: размер}». Нужна для диагностики
   * (сверка того, что реально лежит в хранилище, с тем, что было загружено).
   */
  files?: Record<string, { u: string; s: number }>
}

const SCORM_MIME: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain;charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

function scormMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return SCORM_MIME[ext] ?? 'application/octet-stream'
}

// Кэш origin хранилища по id пакета — чтобы не ходить в БД на каждый файл
// (тёплый инстанс функции переиспользует значение между запросами).
const scormBaseCache = new Map<string, string>()

/** Сохранить метаданные пакета (id задаёт клиент — совпадает с путём в Blob). */
async function saveScormPackage(body: Record<string, unknown>): Promise<ScormPackageMeta> {
  const sql = getSql()
  await ensureSchema(sql)
  const meta = body as unknown as ScormPackageMeta
  const id = String(meta.id ?? '').trim()
  if (!id) throw new Error('Не задан id пакета')
  await sql`
    INSERT INTO content (collection, id, data, sort_order)
    VALUES ('scorm', ${id}, ${JSON.stringify(meta)}::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM content WHERE collection = 'scorm'))
    ON CONFLICT (collection, id)
      DO UPDATE SET data = ${JSON.stringify(meta)}::jsonb, updated_at = NOW()
  `
  if (meta.blobBase) scormBaseCache.set(id, meta.blobBase)
  scormFilesCache.delete(id)
  return meta
}

/** Удалить метаданные и все файлы пакета из хранилища. */
async function deleteScormPackage(id: string): Promise<void> {
  const sql = getSql()
  await ensureSchema(sql)
  await sql`DELETE FROM content WHERE collection = 'scorm' AND id = ${id}`
  scormBaseCache.delete(id)
  scormFilesCache.delete(id)
  try {
    const objects = await listKeys(`scorm/${id}/`)
    if (objects.length) await deleteKeys(objects.map((o) => o.key))
  } catch (err) {
    console.error('[scorm] ошибка удаления файлов пакета из хранилища:', err)
  }
}

/**
 * Страница ошибки раздачи SCORM. Показывается внутри iframe плеера, поэтому
 * вместо голой строки отдаём аккуратную вёрстку: слушателю — общее сообщение,
 * администратору — подсказку, как починить (перезагрузить пакет через админку).
 */
function scormErrorPage(res: ApiResponse, hint: string, status = 404) {
  res.setHeader('Content-Type', 'text/html;charset=utf-8')
  // Страница собирается из наших же строк, но заголовок всё равно фиксируем:
  // без него браузер вправе угадать тип по содержимому.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.status(status).send(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Материалы недоступны</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f4f0;font-family:Georgia,serif;color:#1d232a">
<div style="max-width:32rem;padding:2rem;text-align:center">
<p style="font-size:1.4rem;margin:0 0 .75rem">Материалы курса временно недоступны</p>
<p style="font-size:.95rem;color:#5a616a;margin:0">${hint}</p>
</div></body></html>`,
  )
}

// Кэш «путь → адрес и размер» файлов пакета. Источник — карта из метаданных
// пакета в БД; для старых пакетов без карты она разово строится перечислением
// ключей в хранилище. Кэш сбрасывается при перезаписи и удалении пакета.
interface ScormFileRef {
  url: string
  size: number
}
const scormFilesCache = new Map<string, Map<string, ScormFileRef>>()

/** Ключ файла пакета в хранилище: `scorm/<id>/<путь внутри пакета>`. */
function scormKey(id: string, rel: string): string {
  return `scorm/${id}/${rel}`
}

/**
 * Карта файлов пакета. Сначала — из метаданных в БД (без обращений к
 * хранилищу), и только для старых пакетов без карты — разовое перечисление
 * ключей с самосохранением результата в метаданные.
 */
async function getScormFileMap(id: string): Promise<Map<string, ScormFileRef>> {
  const cached = scormFilesCache.get(id)
  if (cached) return cached

  const meta = await contentGet<ScormPackageMeta>('scorm', id)
  if (meta?.files && Object.keys(meta.files).length) {
    const map = new Map<string, ScormFileRef>()
    for (const [rel, ref] of Object.entries(meta.files)) {
      map.set(scormKey(id, rel), { url: ref.u, size: ref.s })
    }
    scormFilesCache.set(id, map)
    return map
  }

  // Старый пакет без карты: разово перечисляем файлы и сохраняем карту в
  // метаданные — чтобы дальше не ходить в хранилище (самоизлечение без
  // перезаливки пакета).
  const map = await loadScormFileMap(id)
  if (meta && map.size) {
    try {
      const files: Record<string, { u: string; s: number }> = {}
      for (const [key, ref] of map) {
        files[key.replace(`scorm/${id}/`, '')] = { u: ref.url, s: ref.size }
      }
      await saveScormPackage({ ...meta, files } as unknown as Record<string, unknown>)
    } catch (err) {
      console.error(`[scorm] не удалось сохранить карту файлов пакета «${id}»:`, err)
    }
  }
  return map
}

/** Резервный источник карты — перечисление ключей пакета в хранилище. */
async function loadScormFileMap(id: string): Promise<Map<string, ScormFileRef>> {
  const map = new Map<string, ScormFileRef>()
  for (const object of await listKeys(`scorm/${id}/`)) {
    map.set(object.key, { url: publicUrlFor(object.key), size: object.size })
  }
  scormFilesCache.set(id, map)
  return map
}

/**
 * Диагностика пакета: сверяет файлы, записанные в метаданных, с тем, что
 * реально лежит в хранилище. Одно перечисление ключей вместо запроса на каждый
 * файл — быстро и без нагрузки на хранилище.
 */
async function diagnoseScormPackage(id: string) {
  const started = Date.now()
  const report = {
    id,
    mode: storageMode(),
    fileCount: 0,
    okCount: 0,
    failed: [] as Array<{ path: string; sizeKb: number; via: string; status: number | string }>,
    listError: undefined as string | undefined,
    tookMs: 0,
  }

  let expected: Map<string, ScormFileRef>
  let actual: Map<string, number>
  try {
    expected = await getScormFileMap(id)
    actual = new Map((await listKeys(`scorm/${id}/`)).map((o) => [o.key, o.size]))
  } catch (err) {
    report.listError = err instanceof Error ? err.message : String(err)
    report.tookMs = Date.now() - started
    return report
  }

  report.fileCount = expected.size
  for (const [key, ref] of expected) {
    const size = actual.get(key)
    if (size === undefined) {
      report.failed.push({
        path: key.replace(`scorm/${id}/`, ''),
        sizeKb: Math.round(ref.size / 1024),
        via: 'storage',
        status: 'нет в хранилище',
      })
    } else if (size === 0 && ref.size > 0) {
      report.failed.push({
        path: key.replace(`scorm/${id}/`, ''),
        sizeKb: 0,
        via: 'storage',
        status: 'пустой файл',
      })
    } else {
      report.okCount += 1
    }
  }

  // Файлы, которые есть в хранилище, но которых нет в метаданных, — не ошибка
  // раздачи (они просто не используются), поэтому в отчёт не попадают.
  report.tookMs = Date.now() - started
  return report
}

/**
 * Отдать файл из хранилища потоком, с поддержкой Range (нужен для видео).
 * Возвращает false, если объекта нет, — вызывающий решает, что показать.
 */
async function streamStorageObject(
  key: string,
  req: ApiRequest,
  res: ApiResponse,
  options: { contentType?: string; download?: string; maxAge?: number } = {},
): Promise<boolean> {
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined
  try {
    const object = await getObject(key, range)
    res.setHeader('Content-Type', options.contentType || object.contentType || 'application/octet-stream')
    res.setHeader('Cache-Control', `public, max-age=${options.maxAge ?? 3600}`)
    res.setHeader('Accept-Ranges', 'bytes')
    if (object.contentLength !== undefined) res.setHeader('Content-Length', String(object.contentLength))
    if (object.contentRange) res.setHeader('Content-Range', object.contentRange)
    if (options.download) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(options.download)}`,
      )
    }
    res.statusCode = object.status
    await new Promise<void>((resolve, reject) => {
      object.body.on('error', reject)
      res.on('finish', () => resolve())
      res.on('close', () => resolve())
      object.body.pipe(res)
    })
    return true
  } catch (err) {
    const code = (err as { name?: string; Code?: string }).name || (err as { Code?: string }).Code
    if (code === 'NoSuchKey' || code === 'NotFound') return false
    console.error(`[storage] ошибка чтения «${key}»:`, err)
    return false
  }
}

/**
 * Отдать файл пакета SCORM через наш домен. Ключ в хранилище собирается
 * однозначно из id пакета и пути внутри него, поэтому обращений к БД в горячем
 * пути раздачи нет.
 */
async function serveScormFile(id: string, rel: string, req: ApiRequest, res: ApiResponse) {
  if (!id || !rel) {
    return scormErrorPage(res, 'Неверная ссылка на материалы. Обратитесь к администратору академии.')
  }

  // Выход за пределы папки пакета: `..` переживает encodeURIComponent, а при
  // сборке ключа схлопывается — без этой проверки по ссылке вида
  // `/scorm-store/<пакет>/../../materials/...` читались чужие объекты хранилища.
  const parts = rel.split('/')
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    return scormErrorPage(res, 'Неверная ссылка на материалы. Обратитесь к администратору академии.')
  }

  // Материалы пакета открыты только тем, кому доступна использующая его программа.
  const access = await scormAccess(id, req)
  if (!access.ok) {
    console.warn(`[scorm] отказано в доступе к пакету «${id}» (HTTP ${access.status})`)
    return scormErrorPage(res, access.hint, access.status)
  }

  if (!isStorageConfigured()) {
    return scormErrorPage(
      res,
      'Файловое хранилище не настроено. Администратору: задайте STORAGE_DIR (диск сервера) либо переменные S3_* (Object Storage) и перезапустите сервис.',
    )
  }

  const ok = await streamStorageObject(scormKey(id, rel), req, res, { contentType: scormMime(rel) })
  if (ok) return

  console.error(`[scorm] файл «${rel}» пакета «${id}» отсутствует в хранилище`)
  return scormErrorPage(
    res,
    'Файлы пакета отсутствуют в серверном хранилище. Администратору: загрузите пакет заново в разделе «SCORM-пакеты» админ-панели — курсы, использующие пакет, восстановятся автоматически.',
  )
}

/**
 * Отдать произвольный файл хранилища по адресу `/files/<ключ>` (файлы,
 * прикреплённые к учебным материалам). `?download=<имя>` заставляет браузер
 * скачать файл, а не открывать его во вкладке.
 */
export async function serveStorageFile(key: string, req: ApiRequest, res: ApiResponse) {
  if (!key) return res.status(404).json({ message: 'Файл не найден' })
  const download = typeof req.query.download === 'string' ? req.query.download : undefined
  const ok = await streamStorageObject(key, req, res, { download, maxAge: 86_400 })
  if (!ok) return res.status(404).json({ message: 'Файл не найден' })
}

/** Потолок размера одного загружаемого файла (МБ). */
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 256)

/** Безопасный ключ объекта: без «..», ведущих слэшей и обратных слэшей. */
function safeKey(prefix: string, raw: string): string {
  const cleaned = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
  if (!cleaned) throw new Error('Не задан ключ файла (параметр key).')
  const key = cleaned.startsWith(prefix) ? cleaned : `${prefix}${cleaned}`
  if (!key.startsWith(prefix)) throw new Error('Недопустимый путь загрузки.')
  return key
}

/**
 * Загрузка файла в Object Storage через наш сервер.
 *
 *   POST /api/scorm/upload?key=scorm/<id>/<путь>      (тело — сырые байты)
 *   POST /api/materials/upload?key=materials/<имя>
 *
 * На Vercel файлы шли из браузера напрямую в Blob, потому что тело запроса к
 * serverless-функции ограничено 4,5 МБ. На своём сервере такого лимита нет:
 * файл принимается целиком и кладётся в хранилище одним запросом. Права
 * администратора проверены общим гардом роутера (это мутация вне списка
 * публичных).
 */
async function storageUpload(prefix: string, req: ApiRequest, res: ApiResponse) {
  try {
    if (!isStorageConfigured()) {
      return res.status(503).json({
        message:
          'Файловое хранилище не настроено: задайте STORAGE_DIR (диск сервера) либо S3_BUCKET, ' +
          'S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY (Object Storage) в окружении сервиса и перезапустите его.',
      })
    }

    const rawKey = req.query.key
    const key = safeKey(prefix, typeof rawKey === 'string' ? decodeURIComponent(rawKey) : '')

    const body = req.body
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ message: 'Пустое тело запроса — файл не получен.' })
    }
    if (body.length > MAX_UPLOAD_MB * 1024 * 1024) {
      return res.status(413).json({
        message: `Файл больше допустимых ${MAX_UPLOAD_MB} МБ. Увеличьте MAX_UPLOAD_MB и client_max_body_size в nginx.`,
      })
    }

    const contentType =
      (typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined) ||
      'application/octet-stream'
    await putObject(key, body, contentType)
    // Карта файлов пакета могла измениться — сбрасываем кэш раздачи.
    const scormId = key.startsWith('scorm/') ? key.split('/')[1] : undefined
    if (scormId) scormFilesCache.delete(scormId)

    return res.status(201).json({ key, url: publicUrlFor(key), size: body.length })
  } catch (err) {
    console.error(`[${prefix}] ошибка загрузки в хранилище:`, err)
    const message = err instanceof Error ? err.message : 'Ошибка загрузки файла'
    return res.status(400).json({ message })
  }
}

/**
 * Состояние хранилища перед загрузкой: есть ли права администратора и настроено
 * ли Object Storage. Клиент показывает администратору причину отказа до того,
 * как начнёт заливать файлы.
 */
async function uploadPreflight(req: ApiRequest) {
  const admin = verifyToken(bearer(req))?.kind === 'admin'
  const storage = isStorageConfigured()
  return {
    admin,
    // Поле `blob` сохранено в ответе ради совместимости со старыми вкладками
    // админки, открытыми до обновления.
    blob: storage,
    storage,
    mode: storage ? ('server' as const) : undefined,
    // Куда именно ложатся файлы: диск сервера или Object Storage.
    storageMode: storageMode(),
    maxUploadMb: MAX_UPLOAD_MB,
    // Имена (без значений) переменных хранилища — чтобы отличить «не настроено»
    // от «ключ задан под другим именем».
    storageEnv: admin ? storageEnvNames() : undefined,
  }
}

// ---------------- материалы ----------------

/**
 * Обновление материала с уборкой в хранилище: если файл заменили или отвязали,
 * старый объект удаляем — иначе он останется висеть навсегда.
 */
async function updateMaterial(id: string, req: ApiRequest, res: ApiResponse) {
  const previous = await contentGet<Material>('materials', id)
  const next = await contentUpdate<Material>('materials', id, parseBody(req))
  if (previous?.fileUrl && previous.fileUrl !== next.fileUrl) {
    await removeStoredFile(previous.fileUrl)
  }
  return res.json(next)
}

/** Удаление материала вместе с прикреплённым файлом. */
async function deleteMaterial(id: string, res: ApiResponse) {
  const material = await contentGet<Material>('materials', id)
  await contentRemove('materials', id)
  if (material?.fileUrl) await removeStoredFile(material.fileUrl)
  return res.status(204).end()
}

/** Удалить файл из хранилища, не роняя основную операцию из-за его ошибки. */
async function removeStoredFile(url: string): Promise<void> {
  const key = keyFromUrl(url)
  // Файл может лежать вне нашего хранилища (например, внешняя ссылка на
  // материал) — тогда удалять нечего.
  if (!key || !key.startsWith('materials/')) return
  try {
    await deleteKeys([key])
  } catch (err) {
    console.error('[storage] ошибка удаления файла:', err)
  }
}

// ---------------- универсальное хранилище контента ----------------
// События, материалы, опросники, разделы/темы форума и уведомления хранятся в
// общей таблице content, ключ — (collection, id). Наполняются из админ-панели.

type WithId = { id: string; title?: string }

async function contentList<T extends WithId>(collection: string): Promise<T[]> {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`SELECT data FROM content WHERE collection = ${collection} ORDER BY sort_order ASC`
  return rows.map((r) => r.data as T)
}

async function contentGet<T extends WithId>(collection: string, id: string): Promise<T | undefined> {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`SELECT data FROM content WHERE collection = ${collection} AND id = ${id} LIMIT 1`
  return rows[0] ? (rows[0].data as T) : undefined
}

async function contentCreate<T extends WithId>(
  collection: string,
  item: T,
  fallbackSlug: string,
  prepend = false,
): Promise<T> {
  const sql = getSql()
  await ensureSchema(sql)
  const taken = await sql`SELECT id FROM content WHERE collection = ${collection}`
  const ids = new Set(taken.map((r) => r.id as string))
  const desired = (item.id && String(item.id).trim()) || slugify(item.title ?? fallbackSlug) || fallbackSlug
  const id = uniqueId(desired, ids)
  const created = { ...item, id }
  const [{ pos }] = prepend
    ? await sql`SELECT COALESCE(MIN(sort_order), 0) - 1 AS pos FROM content WHERE collection = ${collection}`
    : await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS pos FROM content WHERE collection = ${collection}`
  await sql`
    INSERT INTO content (collection, id, data, sort_order)
    VALUES (${collection}, ${id}, ${JSON.stringify(created)}::jsonb, ${Number(pos)})
  `
  return created
}

async function contentUpdate<T extends WithId>(
  collection: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const sql = getSql()
  await ensureSchema(sql)
  const rows = await sql`SELECT data FROM content WHERE collection = ${collection} AND id = ${id} LIMIT 1`
  const current = (rows[0]?.data as T) ?? ({ id } as T)
  const next = { ...current, ...patch, id } as T
  await sql`
    INSERT INTO content (collection, id, data, sort_order)
    VALUES (${collection}, ${id}, ${JSON.stringify(next)}::jsonb, 0)
    ON CONFLICT (collection, id) DO UPDATE SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW()
  `
  return next
}

async function contentRemove(collection: string, id: string): Promise<void> {
  const sql = getSql()
  await ensureSchema(sql)
  await sql`DELETE FROM content WHERE collection = ${collection} AND id = ${id}`
}

/** Разделы форума со счётчиком тем, посчитанным по фактическим темам. */
async function forumSectionsWithCounts(): Promise<ForumSection[]> {
  const sections = await contentList<ForumSection>('forum_sections')
  const topics = await contentList<ForumTopic>('forum_topics')
  return sections.map((s) => ({
    ...s,
    topicsCount: topics.filter((t) => t.sectionId === s.id).length,
  }))
}
