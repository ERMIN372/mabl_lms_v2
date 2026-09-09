import type { Sql } from './_db.js'
import type { NewsItem } from '../src/types/index.js'
import { ensureSchema } from './_seed.js'

/**
 * Импорт новостей из публичного Telegram-канала.
 *
 * Используется веб-превью канала `https://t.me/s/<channel>` — оно отдаёт
 * последние посты (текст + изображения + дата) в виде HTML и не требует бота,
 * токена или подписки. Подходит только для ПУБЛИЧНЫХ каналов с включённым
 * предпросмотром. Имя канала берётся из переменной окружения TELEGRAM_CHANNEL
 * (можно с «@» или без, либо как полная ссылка t.me/<channel>).
 *
 * Файлы с префиксом `_` Vercel не считает HTTP-маршрутами.
 */



/** Сырой пост, извлечённый из HTML веб-превью канала. */
interface RawPost {
  messageId: string
  rawText: string
  images: string[]
  date: string
}

/** Нормализует значение TELEGRAM_CHANNEL к «голому» имени канала. */
export function normalizeChannel(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .replace(/^\/?s\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim()
}

/** Возвращает имя канала из окружения или бросает понятную ошибку. */
export function getChannel(): string {
  const raw = process.env.TELEGRAM_CHANNEL
  if (!raw || !normalizeChannel(raw)) {
    throw new Error(
      'Не задана переменная окружения TELEGRAM_CHANNEL (публичный @username канала).',
    )
  }
  return normalizeChannel(raw)
}

/** Загружает и разбирает последние посты публичного канала. */
export async function fetchTelegramPosts(channel: string): Promise<RawPost[]> {
  const url = `https://t.me/s/${channel}`
  const res = await fetch(url, {
    headers: {
      // Telegram отдаёт превью только «браузерным» клиентам.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'ru,en;q=0.9',
    },
  })
  if (!res.ok) {
    throw new Error(`Не удалось загрузить канал @${channel} (HTTP ${res.status}).`)
  }
  const html = await res.text()
  return parsePosts(html)
}

/** Извлекает посты из HTML веб-превью. */
function parsePosts(html: string): RawPost[] {
  // Каждый пост обёрнут в .tgme_widget_message_wrap — режем по обёрткам.
  const blocks = html.split('tgme_widget_message_wrap').slice(1)
  const posts: RawPost[] = []

  for (const block of blocks) {
    const idMatch = block.match(/data-post="[^"/]+\/(\d+)"/)
    if (!idMatch) continue
    const messageId = idMatch[1]

    // Текст поста лежит в .tgme_widget_message_text и не содержит вложенных
    // <div>, поэтому берём содержимое до первого </div>. Это важно: иначе
    // в текст затягивался блок реакций из футера поста.
    const textMatch = block.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    )
    const rawText = textMatch ? textMatch[1] : ''

    // Берём фон ТОЛЬКО у настоящих медиа-блоков (фото/видео), но не у эмодзи —
    // Telegram рендерит эмодзи тем же background-image, их включать не нужно.
    const images: string[] = []
    const imgRe =
      /tgme_widget_message_(?:photo_wrap|video_thumb|roundvideo_thumb)[^"]*"[^>]*?background-image:url\('([^']+)'\)/g
    let imgMatch: RegExpExecArray | null
    while ((imgMatch = imgRe.exec(block)) !== null) {
      const url = imgMatch[1].replace(/&amp;/g, '&')
      if (url.includes('/img/emoji/')) continue
      if (!images.includes(url)) images.push(url)
    }

    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/)
    const date = timeMatch ? timeMatch[1] : new Date().toISOString()

    // Пропускаем посты без текста и без картинки (служебные / опросы).
    if (!rawText && images.length === 0) continue

    posts.push({ messageId, rawText, images, date })
  }

  return posts
}

/** Превращает HTML-фрагмент текста поста в чистый текст с переносами строк. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    // Ссылки: сохраняем адрес, чтобы он остался кликабельным в тексте.
    // Если текст ссылки отличается от адреса — выводим «текст (адрес)».
    .replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim()
      if (!label || label === href || /^https?:\/\//i.test(label)) return href
      return `${label} (${href})`
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Обрезает строку до max символов по границе слова, добавляя «…». */
function truncate(value: string, max: number): string {
  const v = value.trim()
  if (v.length <= max) return v
  const slice = v.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  const base = (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()
  return `${base.replace(/[.,;:—–-]+$/, '')}…`
}

/** Маппит сырой пост в доменную модель новости. */
export function postToNewsItem(post: RawPost, channel: string): NewsItem {
  const text = htmlToText(post.rawText)
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  // Заголовок — короткая «шапка» из первой строки поста (для карточек и H1).
  const title = lines.length > 0 ? truncate(lines[0], 90) : 'Новость канала'
  // Тело — ПОЛНЫЙ текст поста (первая строка не теряется), абзацами.
  const body = lines.length > 0 ? lines : [title]
  // Анонс — продолжение после первой строки, иначе сам текст.
  const rest = lines.slice(1).join(' ')
  const excerpt = truncate(rest || lines.join(' ') || title, 200)

  const words = text ? text.split(/\s+/).filter(Boolean).length : 0
  const minutes = Math.max(1, Math.round(words / 150))

  return {
    id: `tg-${channel}-${post.messageId}`,
    title,
    excerpt,
    body,
    category: 'Академия',
    date: post.date,
    readingTime: `${minutes} мин`,
    cover: post.images[0],
    images: post.images,
  }
}

/**
 * Синхронизирует новости канала в таблицу `news` (idempotent upsert).
 * Возвращает имя канала и число обработанных постов.
 */
export async function syncTelegramNews(
  sql: Sql,
): Promise<{ channel: string; synced: number }> {
  const channel = getChannel()
  await ensureSchema(sql)

  const posts = await fetchTelegramPosts(channel)
  let synced = 0

  for (const post of posts) {
    const item = postToNewsItem(post, channel)
    await sql`
      INSERT INTO news (id, data, published_at, source)
      VALUES (${item.id}, ${JSON.stringify(item)}::jsonb, ${item.date}, 'telegram')
      ON CONFLICT (id) DO UPDATE
        SET data = EXCLUDED.data,
            published_at = EXCLUDED.published_at,
            updated_at = NOW()
    `
    synced += 1
  }

  return { channel, synced }
}
