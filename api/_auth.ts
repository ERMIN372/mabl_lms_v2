import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Простая аутентификация по подписанному токену (HMAC-SHA256), без внешних
 * зависимостей. Токен выдаётся при входе и проверяется на защищённых маршрутах.
 *
 * Секрет берётся из AUTH_SECRET; если он не задан, используется строка
 * подключения к БД (она и так есть в проде) или dev-заглушка. В проде стоит
 * задать собственный AUTH_SECRET.
 */
const SECRET =
  process.env.AUTH_SECRET ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  'mabl-insecure-dev-secret'

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

export interface TokenPayload {
  id: string
  kind: string
}

/** Полезная нагрузка вместе со сроком действия. */
export interface VerifiedToken extends TokenPayload {
  /** Момент истечения (мс эпохи). */
  exp: number
}

function hmac(input: string): string {
  return crypto.createHmac('sha256', SECRET).update(input).digest('hex')
}

/** Выпустить токен для пользователя. */
export function signToken(payload: TokenPayload): string {
  const body = { id: payload.id, kind: payload.kind, exp: Date.now() + TTL_MS }
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${b64}.${hmac(b64)}`
}

/** Проверить токен; вернуть полезную нагрузку или null. */
export function verifyToken(token: string | undefined): VerifiedToken | null {
  if (!token) return null
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return null
  const expected = hmac(b64)
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
export function bearer(req: VercelRequest): string | undefined {
  const h = req.headers['authorization'] || req.headers['Authorization']
  const value = Array.isArray(h) ? h[0] : h
  if (typeof value === 'string' && value.startsWith('Bearer ')) return value.slice(7)
  return undefined
}

/**
 * Гард администратора: пропускает только запросы с валидным токеном роли admin.
 * При отказе сам отвечает 401 и возвращает false.
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  const payload = verifyToken(bearer(req))
  if (!payload || payload.kind !== 'admin') {
    res.status(401).json({ message: 'Требуются права администратора. Войдите заново.' })
    return false
  }
  return true
}
