import crypto from 'node:crypto'
import type { ApiRequest, ApiResponse } from './_http.js'

/**
 * Простая аутентификация по подписанному токену (HMAC-SHA256), без внешних
 * зависимостей. Токен выдаётся при входе и проверяется на защищённых маршрутах.
 *
 * Секрет берётся ТОЛЬКО из AUTH_SECRET. Прежние запасные варианты (строка
 * подключения к БД и константа в коде) убраны намеренно: константа лежала в
 * открытом репозитории, то есть в любом окружении без переменных окружения
 * подпись знал каждый, кто видел исходники, — и мог выписать себе админский
 * токен. Строка подключения в роли ключа не лучше: её видит всякий, у кого есть
 * доступ к базе, а её ротация молча разлогинивает всех.
 *
 * Вне продакшена, чтобы не мешать локальной разработке, ключ генерируется
 * случайным при старте процесса: сессии живут до перезапуска и наружу не ходят.
 */
/**
 * Рекомендуемая длина секрета. Короче — предупреждаем в логах, но НЕ отказываем:
 * заблокировать вход из-за длины ключа несоразмерно, а любой заданный секрет
 * несравнимо лучше прежней константы из открытого репозитория.
 */
const RECOMMENDED_SECRET_LENGTH = 32

/** Разобранный секрет. Считается лениво — см. комментарий у `secret()`. */
let cachedSecret: string | undefined

/**
 * Секрет подписи. Резолвится ЛЕНИВО и намеренно.
 *
 * Раньше он вычислялся на верхнем уровне модуля и при отсутствии AUTH_SECRET
 * бросал исключение. Исключение на импорте роняет функцию целиком — до
 * try/catch в обработчике, — поэтому наружу уходил голый HTTP 500 без тела, и
 * весь API (включая вход и публичные страницы) отвечал ошибкой без объяснения.
 * Ошибка конфигурации не должна выглядеть как поломка платформы.
 *
 * Теперь: нет секрета — не выпускаем и не принимаем токены (fail closed), но
 * говорим об этом понятным текстом там, где это действительно нужно.
 */
function secret(): string | undefined {
  if (cachedSecret) return cachedSecret

  const configured = process.env.AUTH_SECRET?.trim()
  if (configured) {
    if (configured.length < RECOMMENDED_SECRET_LENGTH) {
      console.warn(
        `[auth] AUTH_SECRET короче ${RECOMMENDED_SECRET_LENGTH} символов — замените на более ` +
          'длинный (`openssl rand -base64 48`). Вход при этом работает.',
      )
    }
    cachedSecret = configured
    return cachedSecret
  }

  if (process.env.NODE_ENV === 'production') return undefined

  console.warn(
    '[auth] AUTH_SECRET не задан: вне продакшена используется случайный ключ на время процесса. ' +
      'Сессии не переживут перезапуск сервера.',
  )
  cachedSecret = crypto.randomBytes(48).toString('base64url')
  return cachedSecret
}

/**
 * Текст проблемы с настройкой подписи — или null, если всё в порядке.
 * Обработчик показывает его на маршрутах входа вместо безликой ошибки 500.
 */
export function authSecretProblem(): string | null {
  if (secret()) return null
  return (
    'На сервере не задан AUTH_SECRET — секрет подписи токенов сессии, поэтому вход недоступен. ' +
    'Администратору: добавьте переменную окружения AUTH_SECRET (значение — вывод ' +
    '`openssl rand -base64 48`) в настройках проекта и СДЕЛАЙТЕ НОВЫЙ ДЕПЛОЙ: ' +
    'уже собранная версия переменные окружения не перечитывает.'
  )
}

// Если AUTH_SECRET не задан, подпись держится на строке подключения к БД. Любая
// её смена (ротация пароля Neon, переход с pooled на direct, разные значения в
// prod и preview) мгновенно делает недействительными ВСЕ выданные токены: люди
// остаются «залогинены» в браузере, но сервер их больше не узнаёт и доступ к
// оплаченным программам пропадает. Предупреждаем об этом в логах.
if (!process.env.AUTH_SECRET) {
  console.warn(
    '[auth] AUTH_SECRET не задан: подпись токенов выводится из строки подключения к БД. ' +
      'При её смене все сессии слетают, а доступ к оплаченным программам «обнуляется». ' +
      'Задайте AUTH_SECRET в переменных окружения.',
  )
}

/** Время жизни токена — 30 суток (продлевается на каждом запросе к /api/me/*). */
export const TTL_MS = 1000 * 60 * 60 * 24 * 30

/** Порог продления: токен переподписывается, когда истекла половина срока. */
const RENEW_AFTER_MS = TTL_MS / 2

/**
 * Имя cookie с тем же токеном сессии.
 *
 * Зачем cookie, если API работает по заголовку Authorization: файлы SCORM-пакета
 * запрашивает браузер изнутри iframe (и вложенными подзапросами самого пакета),
 * добавить туда заголовок неоткуда. Cookie уходит с этими запросами сама, и
 * только по ней раздача `/scorm-store/*` может понять, кто пришёл.
 *
 * HttpOnly — чтобы содержимое пакета, исполняемое на нашем же домене, не могло
 * прочитать сессию через document.cookie. SameSite=Lax достаточно: cookie нужна
 * только на собственных GET-запросах, а API её не читает — значит, CSRF на
 * изменяющих маршрутах она не открывает.
 */
export const SESSION_COOKIE = 'mabl_session'

export interface TokenPayload {
  id: string
  kind: string
}

/** Проверенный токен: полезная нагрузка плюс момент истечения (мс эпохи). */
export interface VerifiedToken extends TokenPayload {
  exp: number
}

function hmac(input: string, key: string): string {
  return crypto.createHmac('sha256', key).update(input).digest('hex')
}

/** Выпустить токен для пользователя. Без секрета выдавать сессии нельзя. */
export function signToken(payload: TokenPayload): string {
  const key = secret()
  if (!key) throw new Error(authSecretProblem() as string)
  const body = { id: payload.id, kind: payload.kind, exp: Date.now() + TTL_MS }
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${b64}.${hmac(b64, key)}`
}

/**
 * Проверить токен; вернуть полезную нагрузку или null.
 * Без секрета проверить подпись нечем — значит, никто не авторизован.
 */
export function verifyToken(token: string | undefined): VerifiedToken | null {
  if (!token) return null
  const key = secret()
  if (!key) return null
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return null
  const expected = hmac(b64, key)
  // Длины должны совпадать, иначе timingSafeEqual бросит исключение.
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const body = JSON.parse(Buffer.from(b64, 'base64url').toString()) as {
      id?: string
      kind?: string
      exp?: number
    }
    if (typeof body.exp !== 'number' || body.exp < Date.now()) return null
    if (!body.id || !body.kind) return null
    return { id: body.id, kind: body.kind, exp: body.exp }
  } catch {
    return null
  }
}

/**
 * Скользящее продление сессии: если до конца срока осталось меньше половины
 * TTL, выдаём свежий токен. Возвращает null, когда продлевать нечего, — чтобы
 * активные слушатели не разлогинивались посреди обучения.
 */
export function renewToken(session: VerifiedToken): string | null {
  const remaining = session.exp - Date.now()
  if (remaining > RENEW_AFTER_MS) return null
  return signToken({ id: session.id, kind: session.kind })
}

/** Достать Bearer-токен из заголовка Authorization. */
export function bearer(req: ApiRequest): string | undefined {
  const h = req.headers['authorization'] || req.headers['Authorization']
  const value = Array.isArray(h) ? h[0] : h
  if (typeof value === 'string' && value.startsWith('Bearer ')) return value.slice(7)
  return undefined
}

/** Достать токен сессии из cookie (используется раздачей файлов SCORM). */
export function cookieToken(req: ApiRequest): string | undefined {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Сессия запроса с учётом cookie: сначала заголовок Authorization, затем cookie.
 *
 * ВАЖНО: применять только на безопасных GET-маршрутах, отдающих файлы (раздача
 * SCORM). На изменяющих маршрутах авторизация должна оставаться строго по
 * заголовку Authorization — иначе запрос, отправленный чужим сайтом, приедет с
 * cookie пользователя и получится CSRF. Сейчас единственный потребитель —
 * `serveScormFile`.
 */
export function browserSession(req: ApiRequest): VerifiedToken | null {
  return verifyToken(bearer(req)) ?? verifyToken(cookieToken(req))
}

/** Значение Set-Cookie с токеном сессии. */
export function sessionCookie(token: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ]
  // Secure ломает локальную разработку по http, в проде обязателен.
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

/** Значение Set-Cookie, стирающее сессию (выход). */
export function clearSessionCookie(): string {
  const attrs = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

/**
 * Гард администратора: пропускает только запросы с валидным токеном роли admin.
 * При отказе сам отвечает 401 и возвращает false.
 */
export function requireAdmin(req: ApiRequest, res: ApiResponse): boolean {
  const payload = verifyToken(bearer(req))
  if (!payload || payload.kind !== 'admin') {
    res.status(401).json({ message: 'Требуются права администратора. Войдите заново.' })
    return false
  }
  return true
}
