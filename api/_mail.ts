import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

/**
 * Отправка писем через SMTP (по умолчанию — Яндекс 360, smtp.yandex.ru:465).
 *
 * Переменные окружения:
 *   SMTP_HOST      — сервер (по умолчанию smtp.yandex.ru)
 *   SMTP_PORT      — порт (по умолчанию 465, SSL)
 *   SMTP_USER      — полный адрес ящика, например no-reply@mabl.ru
 *   SMTP_PASSWORD  — пароль приложения (не пароль от аккаунта!)
 *   MAIL_FROM      — (опц.) адрес в поле «От кого», по умолчанию SMTP_USER
 *   MAIL_FROM_NAME — (опц.) имя отправителя, по умолчанию «МАБЛ»
 *   SITE_URL       — (опц.) базовый адрес сайта для ссылок в письмах
 *
 * Если SMTP не настроен, отправка не выполняется: функция возвращает false, а
 * вызывающий код решает сам, критично это или нет (регистрация и оплата
 * работают и без писем).
 */

let cached: Transporter | null = null

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD)
}

function transport(): Transporter {
  if (cached) return cached
  const port = Number(process.env.SMTP_PORT || 465)
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.yandex.ru',
    port,
    // 465 — SMTPS (шифрование сразу), 587 — STARTTLS.
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER as string,
      pass: process.env.SMTP_PASSWORD as string,
    },
  })
  return cached
}

/** Базовый адрес сайта для ссылок в письмах. */
export function siteUrl(fallbackHost?: string): string {
  const fromEnv = process.env.SITE_URL || process.env.YOOKASSA_RETURN_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (fallbackHost) return `https://${fallbackHost}`
  return 'https://mabl.ru'
}

export interface MailInput {
  to: string
  subject: string
  /** Основной заголовок письма. */
  heading: string
  /** Абзацы текста (простые строки, без HTML). */
  paragraphs: string[]
  /** Крупный код подтверждения, если нужен. */
  code?: string
  /** Кнопка-ссылка, если нужна. */
  button?: { label: string; url: string }
  /** Мелкая приписка внизу. */
  footnote?: string
}

/**
 * Отправить письмо по брендовому шаблону.
 * Возвращает false, если SMTP не настроен или отправка не удалась —
 * исключение наружу не бросается, чтобы письмо не ломало основной сценарий.
 */
export async function sendMail(input: MailInput): Promise<boolean> {
  if (!isMailConfigured()) {
    console.warn('[mail] SMTP не настроен — письмо не отправлено:', input.subject)
    return false
  }
  try {
    const from = process.env.MAIL_FROM || (process.env.SMTP_USER as string)
    const fromName = process.env.MAIL_FROM_NAME || 'МАБЛ'
    await transport().sendMail({
      from: `"${fromName}" <${from}>`,
      to: input.to,
      subject: input.subject,
      text: renderText(input),
      html: renderHtml(input),
    })
    return true
  } catch (err) {
    console.error('[mail] ошибка отправки:', err)
    return false
  }
}

function renderText(input: MailInput): string {
  const lines = [input.heading, '', ...input.paragraphs]
  if (input.code) lines.push('', `Код: ${input.code}`)
  if (input.button) lines.push('', `${input.button.label}: ${input.button.url}`)
  if (input.footnote) lines.push('', input.footnote)
  lines.push('', 'МАБЛ · Международная академия бизнес лидерства', 'Sapere · Ducere — Знать, чтобы лидировать')
  return lines.join('\n')
}

/** Экранирование пользовательских значений в HTML письма. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Брендовая палитра: Нефть #212128, Океан #3552AF, Мудрость #FFFFFF.
function renderHtml(input: MailInput): string {
  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3c3c46;">${esc(p)}</p>`,
    )
    .join('')

  const code = input.code
    ? `<div style="margin:28px 0;padding:20px;background:#f4f5f8;border-radius:12px;text-align:center;">
         <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#70707d;">Код подтверждения</div>
         <div style="margin-top:8px;font-size:34px;letter-spacing:.28em;font-weight:600;color:#212128;">${esc(input.code)}</div>
       </div>`
    : ''

  const button = input.button
    ? `<div style="margin:28px 0;">
         <a href="${esc(input.button.url)}" style="display:inline-block;padding:14px 28px;background:#3552AF;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;">${esc(input.button.label)}</a>
       </div>
       <p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#70707d;word-break:break-all;">Если кнопка не работает, откройте ссылку: ${esc(input.button.url)}</p>`
    : ''

  const footnote = input.footnote
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#70707d;">${esc(input.footnote)}</p>`
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
          <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#212128;font-weight:600;">${esc(input.heading)}</h1>
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
