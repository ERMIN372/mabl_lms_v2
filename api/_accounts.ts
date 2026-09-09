import crypto from 'node:crypto'
import type { Sql } from './_db.js'
import { courseAccessMessage, sendMail, verificationCodeMessage } from './_mail.js'

/**
 * Подтверждение e-mail и письмо об открытом доступе к программе.
 *
 * Секреты в открытом виде не хранятся: в базе лежит только SHA-256-хэш кода.
 * Отправка ограничена по частоте, иначе форму можно использовать как бесплатный
 * рассыльщик писем с нашего ящика — и заодно спалить репутацию домена.
 *
 * Восстановление пароля живёт в router.ts: оно появилось раньше и уже связано с
 * таблицей password_resets и страницей /reset-password.
 */


/** Код подтверждения живёт 15 минут. */
export const CODE_TTL_MIN = 15
/** Не больше 5 писем с кодом на адрес в час. */
const CODE_MAX_PER_HOUR = 5
/** Не чаще одного письма с кодом в минуту. */
const CODE_MIN_INTERVAL_SEC = 60
/** Не больше 5 попыток ввода одного кода. */
const CODE_MAX_ATTEMPTS = 5

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** Сравнение хэшей за постоянное время. */
function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** Шестизначный код (000000–999999), равномерно случайный. */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export interface AccountUser {
  id: string
  name: string
  email: string
}

export type SendCodeResult =
  | { ok: true }
  | { ok: false; message: string; retryAfterSec?: number }

/**
 * Выписать код подтверждения e-mail и отправить письмо.
 * `welcome = true` — первое письмо сразу после регистрации (другой текст).
 *
 * Ошибку отправки возвращаем текстом, а не прячем: молчаливое «код отправлен»
 * при неработающем SMTP — ровно то, из-за чего подтверждение почты выглядело
 * рабочим, а письма не приходили.
 */
export async function sendVerificationCode(
  sql: Sql,
  user: AccountUser,
  options: { welcome?: boolean } = {},
): Promise<SendCodeResult> {
  const email = user.email.toLowerCase()

  const [{ recent, last }] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS recent,
      MAX(created_at) AS last
    FROM email_codes WHERE email = ${email}
  `
  if (Number(recent) >= CODE_MAX_PER_HOUR) {
    return {
      ok: false,
      message: 'Слишком много запросов кода. Попробуйте через час или напишите в поддержку.',
    }
  }
  if (last) {
    const passed = (Date.now() - new Date(last as string).getTime()) / 1000
    if (passed < CODE_MIN_INTERVAL_SEC) {
      return {
        ok: false,
        message: 'Код уже отправлен. Повторная отправка будет доступна через минуту.',
        retryAfterSec: Math.ceil(CODE_MIN_INTERVAL_SEC - passed),
      }
    }
  }

  const code = generateCode()
  const id = `ec-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
  // Прошлые коды пользователя гасим — действителен только последний.
  await sql`UPDATE email_codes SET used_at = NOW() WHERE user_id = ${user.id} AND used_at IS NULL`
  await sql`
    INSERT INTO email_codes (id, user_id, email, code_hash, expires_at)
    VALUES (${id}, ${user.id}, ${email}, ${sha256(code)},
      NOW() + ${`${CODE_TTL_MIN} minutes`}::interval)
  `

  try {
    await sendMail(
      verificationCodeMessage({
        to: email,
        name: user.name,
        code,
        ttlMinutes: CODE_TTL_MIN,
        welcome: options.welcome,
      }),
    )
  } catch (err) {
    // Письмо не ушло — код бесполезен, гасим его сразу.
    await sql`UPDATE email_codes SET used_at = NOW() WHERE id = ${id}`
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Не удалось отправить письмо: ${reason}` }
  }

  return { ok: true }
}

export type VerifyResult = { ok: true } | { ok: false; message: string }

/** Проверить код подтверждения и отметить e-mail подтверждённым. */
export async function verifyEmailCode(
  sql: Sql,
  userId: string,
  code: string,
): Promise<VerifyResult> {
  const clean = code.replace(/\D/g, '')
  if (clean.length !== 6) return { ok: false, message: 'Код состоит из 6 цифр.' }

  const rows = await sql`
    SELECT id, code_hash, attempts, expires_at
    FROM email_codes
    WHERE user_id = ${userId} AND used_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `
  const row = rows[0]
  if (!row) return { ok: false, message: 'Код не запрашивался или уже использован. Запросите новый.' }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return { ok: false, message: 'Срок действия кода истёк. Запросите новый.' }
  }
  if (Number(row.attempts) >= CODE_MAX_ATTEMPTS) {
    return { ok: false, message: 'Слишком много неверных попыток. Запросите новый код.' }
  }

  if (!hashEquals(sha256(clean), row.code_hash as string)) {
    await sql`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ${row.id as string}`
    const left = CODE_MAX_ATTEMPTS - Number(row.attempts) - 1
    return {
      ok: false,
      message:
        left > 0 ? `Неверный код. Осталось попыток: ${left}.` : 'Неверный код. Запросите новый.',
    }
  }

  await sql`UPDATE email_codes SET used_at = NOW() WHERE id = ${row.id as string}`
  await sql`UPDATE users SET email_verified = TRUE WHERE id = ${userId}`
  return { ok: true }
}

/**
 * Письмо об открытом доступе к программе. Не роняет оплату: о неудаче
 * сообщается в лог, деньги и доступ от этого не зависят.
 */
export async function sendCourseAccessEmail(params: {
  to: string
  name: string
  courseTitle: string
  courseId: string
  origin: string
}): Promise<boolean> {
  if (!params.to) return false
  try {
    await sendMail(
      courseAccessMessage({
        to: params.to,
        name: params.name,
        courseTitle: params.courseTitle,
        courseUrl: `${params.origin}/courses/${params.courseId}`,
      }),
    )
    return true
  } catch (err) {
    console.error('[mail] письмо о доступе к программе не отправлено:', err)
    return false
  }
}
