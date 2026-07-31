import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { sendMail, isMailConfigured } from './_mail.js'

/**
 * Подтверждение e-mail и восстановление пароля.
 *
 * Секреты не хранятся в открытом виде: в БД лежат только SHA-256 хеши кода
 * подтверждения и токена сброса. Все операции ограничены по частоте, чтобы
 * форму нельзя было использовать как бесплатный рассыльщик писем с нашего ящика.
 */

type Sql = NeonQueryFunction<false, false>

/** Код подтверждения живёт 15 минут. */
const CODE_TTL_MIN = 15
/** Ссылка сброса пароля живёт 60 минут. */
const RESET_TTL_MIN = 60
/** Не больше 5 писем с кодом на адрес в час. */
const CODE_MAX_PER_HOUR = 5
/** Не чаще одного письма с кодом в минуту. */
const CODE_MIN_INTERVAL_SEC = 60
/** Не больше 3 писем со сбросом пароля на адрес в час. */
const RESET_MAX_PER_HOUR = 3
/** Не больше 5 попыток ввода одного кода. */
const CODE_MAX_ATTEMPTS = 5

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** Сравнение хешей за постоянное время. */
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
  | { ok: true; sent: boolean }
  | { ok: false; message: string; retryAfterSec?: number }

/**
 * Выписать код подтверждения e-mail и отправить письмо.
 * `welcome = true` — первое письмо после регистрации (другой текст).
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

  const firstName = user.name.split(' ')[0] || user.name
  const sent = await sendMail({
    to: email,
    subject: options.welcome
      ? 'Подтвердите e-mail — МАБЛ'
      : `Код подтверждения: ${code}`,
    heading: options.welcome ? `${firstName}, добро пожаловать в МАБЛ` : 'Подтверждение e-mail',
    paragraphs: options.welcome
      ? [
          'Аккаунт в личном кабинете академии создан. Осталось подтвердить адрес — это нужно, чтобы вы могли восстановить пароль и получать письма о доступе к программам.',
          `Введите код на сайте. Он действует ${CODE_TTL_MIN} минут.`,
        ]
      : [`Введите этот код на сайте, чтобы подтвердить адрес. Он действует ${CODE_TTL_MIN} минут.`],
    code,
    footnote: 'Если вы не регистрировались в МАБЛ, просто удалите это письмо — аккаунт останется неподтверждённым.',
  })

  return { ok: true, sent }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; message: string }

/** Проверить код подтверждения и отметить e-mail подтверждённым. */
export async function verifyEmailCode(sql: Sql, userId: string, code: string): Promise<VerifyResult> {
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
      message: left > 0 ? `Неверный код. Осталось попыток: ${left}.` : 'Неверный код. Запросите новый.',
    }
  }

  await sql`UPDATE email_codes SET used_at = NOW() WHERE id = ${row.id as string}`
  await sql`UPDATE users SET email_verified = TRUE WHERE id = ${userId}`
  return { ok: true }
}

/**
 * Запросить ссылку для сброса пароля.
 *
 * Наружу всегда отдаётся один и тот же ответ — по нему нельзя понять,
 * зарегистрирован ли адрес.
 */
export async function requestPasswordReset(sql: Sql, rawEmail: string, origin: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase()

  const [{ recent }] = await sql`
    SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS recent
    FROM password_resets WHERE email = ${email}
  `
  if (Number(recent) >= RESET_MAX_PER_HOUR) return

  const users = await sql`SELECT id, name, email FROM users WHERE email = ${email} LIMIT 1`
  const user = users[0]
  if (!user) return

  const token = crypto.randomBytes(32).toString('hex')
  await sql`
    INSERT INTO password_resets (token_hash, user_id, email, expires_at)
    VALUES (${sha256(token)}, ${user.id as string}, ${email},
      NOW() + ${`${RESET_TTL_MIN} minutes`}::interval)
  `

  const firstName = String(user.name ?? '').split(' ')[0] || 'Коллега'
  await sendMail({
    to: email,
    subject: 'Восстановление доступа — МАБЛ',
    heading: `${firstName}, восстановление доступа`,
    paragraphs: [
      'Мы получили запрос на смену пароля от личного кабинета МАБЛ.',
      `Нажмите кнопку ниже и задайте новый пароль. Ссылка действует ${RESET_TTL_MIN} минут и сработает один раз.`,
    ],
    button: { label: 'Задать новый пароль', url: `${origin}/reset-password?token=${token}` },
    footnote: 'Если вы не запрашивали смену пароля, ничего делать не нужно — текущий пароль продолжит работать.',
  })
}

/** Установить новый пароль по одноразовому токену. */
export async function resetPassword(
  sql: Sql,
  token: string,
  password: string,
): Promise<VerifyResult> {
  if (password.length < 8) return { ok: false, message: 'Пароль должен быть не короче 8 символов.' }
  const rows = await sql`
    SELECT token_hash, user_id, expires_at, used_at
    FROM password_resets WHERE token_hash = ${sha256(token)} LIMIT 1
  `
  const row = rows[0]
  if (!row) return { ok: false, message: 'Ссылка недействительна. Запросите восстановление заново.' }
  if (row.used_at) return { ok: false, message: 'Ссылка уже использована. Запросите новую.' }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return { ok: false, message: 'Срок действия ссылки истёк. Запросите новую.' }
  }

  const userId = row.user_id as string
  const hash = await bcrypt.hash(password, 10)
  // Переход по ссылке из письма доказывает владение почтой — заодно
  // подтверждаем адрес.
  await sql`UPDATE users SET password_hash = ${hash}, email_verified = TRUE WHERE id = ${userId}`
  await sql`UPDATE password_resets SET used_at = NOW() WHERE user_id = ${userId} AND used_at IS NULL`
  return { ok: true }
}

/** Письмо об открытом доступе к программе (после подтверждённой оплаты). */
export async function sendCourseAccessEmail(
  to: string,
  userName: string,
  courseTitle: string,
  courseId: string,
  origin: string,
): Promise<boolean> {
  if (!isMailConfigured() || !to) return false
  const firstName = userName.split(' ')[0] || 'Коллега'
  return sendMail({
    to,
    subject: `Доступ к программе «${courseTitle}» открыт`,
    heading: `${firstName}, доступ открыт`,
    paragraphs: [
      `Оплата получена, программа «${courseTitle}» добавлена в ваш личный кабинет.`,
      'Материалы доступны в любой момент — с компьютера и с телефона, после входа в кабинет.',
    ],
    button: { label: 'Перейти к обучению', url: `${origin}/courses/${courseId}` },
    footnote: 'Кассовый чек придёт отдельным письмом от ЮKassa.',
  })
}
