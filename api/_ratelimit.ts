import type { ApiRequest } from './_http.js'
import type { Sql } from './_db.js'

/**
 * Ограничение частоты запросов.
 *
 * Счётчики лежат в той же базе: она уже подключена, а счётчик остаётся общим,
 * если приложение когда-нибудь поднимут в нескольких экземплярах (у счётчика в
 * памяти процесса было бы своё окно на каждый, и реальный лимит умножался бы на
 * их число). Отдельное хранилище (KV/Redis) дало бы то же самое, но ценой ещё
 * одного сервиса и переменных окружения в проде.
 *
 * Окно фиксированное: одна строка на пару «действие + ключ», по истечении окна
 * счётчик начинается заново. Точности скользящего окна здесь не нужно —
 * задача в том, чтобы перебор стоил дорого, а не в идеальном учёте.
 */


export interface RateLimitVerdict {
  /** Можно ли выполнять действие. */
  allowed: boolean
  /** Через сколько секунд лимит освободится (0, если лимит не исчерпан). */
  retryAfterSec: number
}

const ALLOWED: RateLimitVerdict = { allowed: true, retryAfterSec: 0 }

/**
 * Учесть попытку и сказать, не исчерпан ли лимит.
 *
 * При ошибке базы пропускаем запрос (fail open) и пишем в лог: сломанный
 * счётчик не должен превращаться в отказ входа для всех.
 */
export async function hitRateLimit(
  sql: Sql,
  scope: string,
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitVerdict> {
  if (!key) return ALLOWED
  try {
    const rows = await sql`
      INSERT INTO rate_limits (scope, key, count, window_start)
      VALUES (${scope}, ${key}, 1, NOW())
      ON CONFLICT (scope, key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < NOW() - (${windowSec} * INTERVAL '1 second')
            THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < NOW() - (${windowSec} * INTERVAL '1 second')
            THEN NOW()
          ELSE rate_limits.window_start
        END
      RETURNING
        count,
        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (
            window_start + (${windowSec} * INTERVAL '1 second') - NOW()
          )))
        )::int AS retry_after
    `
    const row = rows[0]
    if (!row) return ALLOWED
    const count = Number(row.count)
    if (count <= limit) return ALLOWED
    return { allowed: false, retryAfterSec: Number(row.retry_after) || windowSec }
  } catch (err) {
    console.error(`[ratelimit] счётчик «${scope}» недоступен, пропускаем запрос:`, err)
    return ALLOWED
  }
}

/**
 * Убрать отжившие счётчики. Строка нужна только пока идёт её окно, самое
 * длинное из которых — час; сутки взяты с запасом. Вызывается из ежедневной
 * синхронизации новостей, чтобы не заводить отдельное расписание.
 */
export async function purgeStaleRateLimits(sql: Sql): Promise<void> {
  try {
    await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`
  } catch (err) {
    console.error('[ratelimit] уборка счётчиков не удалась:', err)
  }
}

/** Обнулить счётчик — вызывается после успешного действия (удачный вход). */
export async function resetRateLimit(sql: Sql, scope: string, key: string): Promise<void> {
  if (!key) return
  try {
    await sql`DELETE FROM rate_limits WHERE scope = ${scope} AND key = ${key}`
  } catch (err) {
    console.error(`[ratelimit] не удалось сбросить счётчик «${scope}»:`, err)
  }
}

/**
 * IP клиента.
 *
 * Заголовкам от клиента доверять нельзя — X-Forwarded-For подделывается, и по
 * подделанному значению перебор шёл бы с «новым IP» на каждой попытке. Поэтому
 * сначала берём заголовки, которые проставляет сам Vercel, и лишь в последнюю
 * очередь — ПРАВЫЙ элемент X-Forwarded-For: слева в цепочке стоит то, что
 * прислал клиент, справа — то, что дописал ближайший к нам прокси.
 */
export function clientIp(req: ApiRequest): string {
  const pick = (name: string): string => {
    const raw = req.headers[name]
    const value = Array.isArray(raw) ? raw[0] : raw
    return typeof value === 'string' ? value.trim() : ''
  }

  // Заголовку x-vercel-forwarded-for здесь верить нельзя: его проставляла
  // платформа, а на своём сервере его подделает любой клиент и обойдёт лимит.
  // Доверенные заголовки ставит наш nginx (X-Real-IP, X-Forwarded-For).
  const realIp = pick('x-real-ip')
  if (realIp) return realIp

  const forwarded = pick('x-forwarded-for')
  if (forwarded) return forwarded.split(',').pop()?.trim() ?? ''

  return ''
}

/** Ответ «слишком часто» с корректным заголовком Retry-After. */
export function tooManyRequests(
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => unknown } },
  verdict: RateLimitVerdict,
  message: string,
) {
  res.setHeader('Retry-After', String(verdict.retryAfterSec))
  return res.status(429).json({ message, retryAfterSec: verdict.retryAfterSec })
}
