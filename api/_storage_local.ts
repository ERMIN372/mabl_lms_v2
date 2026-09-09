import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

/**
 * Хранилище файлов на диске сервера.
 *
 * Альтернатива Object Storage для случая, когда облачное хранилище недоступно
 * (нет прав на бакет) или попросту избыточно. Файлы лежат в каталоге
 * STORAGE_DIR ровно теми же ключами, что были бы объектами в бакете:
 * `scorm/<id>/<путь>` и `materials/<имя>`. Наружу их так же отдаёт приложение.
 *
 * Что важно помнить: файлы живут на диске виртуальной машины, поэтому их надо
 * включить в резервное копирование (обычный tar по расписанию) и не забыть
 * перенести при пересоздании машины.
 */

/** Каталог хранилища; пустая строка означает «локальный режим выключен». */
export function localDir(): string {
  return (process.env.STORAGE_DIR ?? '').trim()
}

/** Включён ли локальный режим. */
export function isLocalStorage(): boolean {
  return Boolean(localDir())
}

/**
 * Абсолютный путь файла по ключу. Ключ нормализуется, и результат обязан
 * остаться внутри каталога хранилища: иначе ключ вида `../../etc/passwd`
 * выводил бы запись и чтение за его пределы.
 */
function resolveKey(key: string): string {
  const base = path.resolve(localDir())
  const parts = key
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
  const full = path.resolve(base, ...parts)
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('Недопустимый путь файла')
  }
  return full
}

/** MIME-тип по расширению: у файла на диске нет метаданных объекта. */
const MIME: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
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
  pdf: 'application/pdf',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function mimeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** Записать файл (каталоги создаются по мере надобности). */
export async function putLocal(key: string, body: Buffer | Uint8Array | string): Promise<void> {
  const full = resolveKey(key)
  await fsp.mkdir(path.dirname(full), { recursive: true })
  await fsp.writeFile(full, body)
}

export interface LocalObject {
  body: Readable
  contentType: string
  contentLength: number
  contentRange?: string
  status: 200 | 206
}

/**
 * Прочитать файл. Заголовок Range разбирается сами: на диске нет S3, который
 * сделал бы это за нас, а без диапазонов не перематывается видео внутри
 * SCORM-пакета.
 */
export async function getLocal(key: string, range?: string): Promise<LocalObject> {
  const full = resolveKey(key)
  const stat = await fsp.stat(full)
  const size = stat.size

  const match = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (match && (match[1] || match[2])) {
    let start: number
    let end: number
    if (match[1]) {
      start = Number(match[1])
      end = match[2] ? Number(match[2]) : size - 1
    } else {
      // Суффиксный диапазон «последние N байт».
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
      end = Math.min(end, size - 1)
      return {
        body: fs.createReadStream(full, { start, end }),
        contentType: mimeForKey(key),
        contentLength: end - start + 1,
        contentRange: `bytes ${start}-${end}/${size}`,
        status: 206,
      }
    }
  }

  return {
    body: fs.createReadStream(full),
    contentType: mimeForKey(key),
    contentLength: size,
    status: 200,
  }
}

/** Размер и тип файла; null, если файла нет. */
export async function headLocal(key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const stat = await fsp.stat(resolveKey(key))
    if (!stat.isFile()) return null
    return { size: stat.size, contentType: mimeForKey(key) }
  } catch {
    return null
  }
}

/** Рекурсивно перечислить файлы с префиксом ключа. */
export async function listLocal(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const base = path.resolve(localDir())
  const result: Array<{ key: string; size: number }> = []

  const walk = async (dir: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      // Каталога нет или он недоступен — считаем, что файлов в нём тоже нет.
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const key = path.relative(base, full).split(path.sep).join('/')
      if (key.startsWith(prefix)) {
        const stat = await fsp.stat(full)
        result.push({ key, size: stat.size })
      }
    }
  }

  // Начинаем обход с каталога префикса, если он существует, иначе с корня:
  // так перечисление пакета не читает всё хранилище целиком.
  const prefixDir = prefix.endsWith('/') ? resolveKey(prefix) : base
  await walk(fs.existsSync(prefixDir) ? prefixDir : base)
  return result
}

/** Удалить файлы и подчистить оставшиеся пустыми каталоги. */
export async function deleteLocal(keys: string[]): Promise<void> {
  const base = path.resolve(localDir())
  for (const key of keys) {
    const full = resolveKey(key)
    try {
      await fsp.unlink(full)
    } catch {
      continue
    }
    // Пустые каталоги пакета не нужны — поднимаемся вверх, пока удаляется.
    let dir = path.dirname(full)
    while (dir !== base && dir.startsWith(base + path.sep)) {
      try {
        await fsp.rmdir(dir)
      } catch {
        break
      }
      dir = path.dirname(dir)
    }
  }
}
