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

/** Имя для обращения: первое слово из полного имени. */
function firstName(name: string): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'Коллега'
}

/**
 * Содержимое письма в общем брендовом шаблоне. Все письма академии собираются
 * через него: одинаковая шапка, типографика и подвал, а различается только
 * текст, код или кнопка.
 */
interface MailContent {
  heading: string
  paragraphs: string[]
  /** Крупный код подтверждения. */
  code?: string
  button?: { label: string; url: string }
  footnote?: string
}

function renderText(content: MailContent): string {
  const lines = [content.heading, '', ...content.paragraphs]
  if (content.code) lines.push('', `Код: ${content.code}`)
  if (content.button) lines.push('', `${content.button.label}: ${content.button.url}`)
  if (content.footnote) lines.push('', content.footnote)
  lines.push(
    '',
    'МАБЛ · Международная академия бизнес лидерства',
    'Sapere · Ducere — Знать, чтобы лидировать',
  )
  return lines.join('\n')
}

// Брендовая палитра: Нефть #212128, Океан #3552AF, Мудрость #FFFFFF.
function renderHtml(content: MailContent): string {
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3c3c46;">${escapeHtml(p)}</p>`,
    )
    .join('')

  const code = content.code
    ? `<div style="margin:28px 0;padding:20px;background:#f4f5f8;border-radius:12px;text-align:center;">
         <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#70707d;">Код подтверждения</div>
         <div style="margin-top:8px;font-size:34px;letter-spacing:.28em;font-weight:600;color:#212128;">${escapeHtml(content.code)}</div>
       </div>`
    : ''

  const button = content.button
    ? `<div style="margin:28px 0;">
         <a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 28px;background:#3552AF;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;">${escapeHtml(content.button.label)}</a>
       </div>
       <p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#70707d;word-break:break-all;">Если кнопка не работает, откройте ссылку: ${escapeHtml(content.button.url)}</p>`
    : ''

  const footnote = content.footnote
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#70707d;">${escapeHtml(content.footnote)}</p>`
    : ''

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e7ec;">
        <tr><td style="background:#212128;padding:28px 32px;">
          <div style="font-size:18px;letter-spacing:.18em;text-transform:uppercase;color:#ffffff;font-weight:600;">МАБЛ</div>
          <div style="margin-top:6px;font-size:11px;letter-spacing:.1em;color:rgba(255,255,255,.55);">Международная академия бизнес лидерства</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#212128;font-weight:600;">${escapeHtml(content.heading)}</h1>
          ${paragraphs}
          ${code}
          ${button}
          ${footnote}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e6e7ec;background:#fafafb;">
          <p style="margin:0;font-size:11px;line-height:1.6;color:#70707d;">
            Sapere · Ducere — Знать, чтобы лидировать<br>
            Письмо отправлено автоматически, отвечать на него не нужно.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

/** Собрать письмо из содержимого и темы. */
function compose(to: string, subject: string, content: MailContent): MailMessage {
  return { to, subject, html: renderHtml(content), text: renderText(content) }
}

/** Письмо со ссылкой на восстановление пароля. */
export function passwordResetMessage(params: {
  to: string
  name: string
  link: string
  ttlHours: number
}): MailMessage {
  return compose(params.to, 'Восстановление доступа — МАБЛ', {
    heading: `${firstName(params.name)}, восстановление доступа`,
    paragraphs: [
      'Мы получили запрос на смену пароля от личного кабинета МАБЛ.',
      `Нажмите кнопку ниже и задайте новый пароль. Ссылка действует ${params.ttlHours} ч. и сработает один раз.`,
    ],
    button: { label: 'Задать новый пароль', url: params.link },
    footnote:
      'Если вы не запрашивали смену пароля, ничего делать не нужно — текущий пароль продолжит работать.',
  })
}

/**
 * Письмо с кодом подтверждения e-mail. `welcome` — первое письмо сразу после
 * регистрации: у него другой заголовок и тема.
 */
export function verificationCodeMessage(params: {
  to: string
  name: string
  code: string
  ttlMinutes: number
  welcome?: boolean
}): MailMessage {
  const subject = params.welcome ? 'Подтвердите e-mail — МАБЛ' : `Код подтверждения: ${params.code}`
  return compose(params.to, subject, {
    heading: params.welcome
      ? `${firstName(params.name)}, добро пожаловать в МАБЛ`
      : 'Подтверждение e-mail',
    paragraphs: params.welcome
      ? [
          'Аккаунт в личном кабинете академии создан. Осталось подтвердить адрес — это нужно, чтобы вы могли восстановить пароль и получать письма о доступе к программам.',
          `Введите код на сайте. Он действует ${params.ttlMinutes} минут.`,
        ]
      : [
          `Введите этот код на сайте, чтобы подтвердить адрес. Он действует ${params.ttlMinutes} минут.`,
        ],
    code: params.code,
    footnote:
      'Если вы не регистрировались в МАБЛ, просто удалите это письмо — аккаунт останется неподтверждённым.',
  })
}

/** Письмо об открытом доступе к программе (после подтверждённой оплаты). */
export function courseAccessMessage(params: {
  to: string
  name: string
  courseTitle: string
  courseUrl: string
}): MailMessage {
  return compose(params.to, `Доступ к программе «${params.courseTitle}» открыт`, {
    heading: `${firstName(params.name)}, доступ открыт`,
    paragraphs: [
      `Оплата получена, программа «${params.courseTitle}» добавлена в ваш личный кабинет.`,
      'Материалы доступны в любой момент — с компьютера и с телефона, после входа в кабинет.',
    ],
    button: { label: 'Перейти к обучению', url: params.courseUrl },
    footnote: 'Кассовый чек придёт отдельным письмом от ЮKassa.',
  })
}
