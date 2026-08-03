import nodemailer from 'nodemailer'

/**
 * Отправка писем с сервера.
 *
 * Поддерживаются два транспорта — выбирается тот, что настроен переменными
 * окружения (SMTP имеет приоритет):
 *
 *   1) SMTP (любой почтовый провайдер: Яндекс 360, Mail.ru, Timeweb, свой сервер)
 *        SMTP_HOST      — хост, например smtp.yandex.ru
 *        SMTP_PORT      — порт: 465 (SSL) или 587 (STARTTLS). По умолчанию 465.
 *        SMTP_USER      — логин (обычно полный адрес ящика)
 *        SMTP_PASSWORD  — пароль ящика или пароль приложения
 *        SMTP_SECURE    — (опц.) 'true'/'false'; по умолчанию true для порта 465
 *
 *   2) Resend (HTTP API, без SMTP-портов)
 *        RESEND_API_KEY — ключ из личного кабинета Resend
 *
 *   Общие:
 *        MAIL_FROM      — адрес отправителя, например "МАБЛ <noreply@mabl.ru>".
 *                         Если не задан, берётся SMTP_USER.
 *
 * Если ничего не настроено, isMailConfigured() возвращает false — вызывающий код
 * отвечает понятной ошибкой вместо того, чтобы делать вид, что письмо ушло.
 */

export interface MailMessage {
  to: string
  subject: string
  /** HTML-тело письма. */
  html: string
  /** Текстовая версия (fallback для почтовых клиентов без HTML). */
  text: string
}

/** Какой транспорт настроен сейчас. */
export type MailTransport = 'smtp' | 'resend' | 'none'

export function mailTransport(): MailTransport {
  if (process.env.SMTP_HOST) return 'smtp'
  if (process.env.RESEND_API_KEY) return 'resend'
  return 'none'
}

export function isMailConfigured(): boolean {
  return mailTransport() !== 'none'
}

/** Адрес отправителя. */
function mailFrom(): string {
  return (process.env.MAIL_FROM || process.env.SMTP_USER || '').trim()
}

/**
 * Диагностика настроек почты — что именно не заполнено. Пустой массив означает,
 * что отправка сконфигурирована полностью.
 */
export function mailConfigProblems(): string[] {
  const problems: string[] = []
  const transport = mailTransport()
  if (transport === 'none') {
    problems.push('Не задан ни SMTP_HOST, ни RESEND_API_KEY — отправлять письма нечем.')
    return problems
  }
  if (transport === 'smtp') {
    if (!process.env.SMTP_USER) problems.push('Не задан SMTP_USER (логин почтового ящика).')
    if (!process.env.SMTP_PASSWORD) problems.push('Не задан SMTP_PASSWORD (пароль ящика или пароль приложения).')
  }
  if (!mailFrom()) problems.push('Не задан MAIL_FROM (адрес отправителя).')
  return problems
}

/** Отправка через SMTP. */
async function sendViaSmtp(message: MailMessage): Promise<void> {
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE.toLowerCase() === 'true'
    : port === 465

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // Serverless-функция живёт недолго: не ждём зависший SMTP дольше запроса.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })

  await transporter.sendMail({
    from: mailFrom(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}

/** Отправка через HTTP API Resend. */
async function sendViaResend(message: MailMessage): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message || `Resend вернул ошибку ${res.status}`)
  }
}

/**
 * Отправить письмо. Бросает исключение с текстом ошибки провайдера — вызывающий
 * код показывает его администратору, чтобы поломку было видно, а не «письмо
 * отправлено» при молчаливом отказе.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const problems = mailConfigProblems()
  if (problems.length > 0) throw new Error(problems.join(' '))

  const transport = mailTransport()
  const started = Date.now()
  try {
    if (transport === 'smtp') await sendViaSmtp(message)
    else await sendViaResend(message)
    console.log(`[mail] ${transport}: письмо отправлено на ${message.to} за ${Date.now() - started} мс`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[mail] ${transport}: не удалось отправить письмо на ${message.to}: ${reason}`)
    throw new Error(reason)
  }
}

/** Экранирование пользовательских данных в HTML-теле письма. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Письмо со ссылкой на восстановление пароля. */
export function passwordResetMessage(params: {
  to: string
  name: string
  link: string
  ttlHours: number
}): MailMessage {
  const name = escapeHtml(params.name || 'Коллега')
  const link = escapeHtml(params.link)
  const text = [
    `${params.name || 'Здравствуйте'}!`,
    '',
    'Вы запросили восстановление доступа к личному кабинету МАБЛ.',
    'Чтобы задать новый пароль, откройте ссылку:',
    params.link,
    '',
    `Ссылка действует ${params.ttlHours} ч. и только один раз.`,
    'Если восстановление запрашивали не вы — просто удалите это письмо: пароль останется прежним.',
    '',
    'Международная академия бизнес-лидерства (МАБЛ)',
  ].join('\n')

  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1b1b1b">
  <p>${name}, здравствуйте!</p>
  <p>Вы запросили восстановление доступа к личному кабинету МАБЛ. Нажмите кнопку, чтобы задать новый пароль:</p>
  <p style="margin:28px 0">
    <a href="${link}" style="background:#12233b;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;display:inline-block">
      Задать новый пароль
    </a>
  </p>
  <p style="font-size:14px;color:#5b5b5b">
    Если кнопка не открывается, скопируйте ссылку в адресную строку браузера:<br />
    <a href="${link}">${link}</a>
  </p>
  <p style="font-size:14px;color:#5b5b5b">
    Ссылка действует ${params.ttlHours} ч. и срабатывает один раз.
    Если восстановление запрашивали не вы — просто удалите это письмо, пароль останется прежним.
  </p>
  <p style="font-size:14px;color:#5b5b5b">Международная академия бизнес-лидерства (МАБЛ)</p>
</div>`.trim()

  return {
    to: params.to,
    subject: 'Восстановление доступа к личному кабинету МАБЛ',
    html,
    text,
  }
}
