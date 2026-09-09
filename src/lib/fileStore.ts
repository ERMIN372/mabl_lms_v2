/**
 * Загрузка одиночных файлов в серверное хранилище (Yandex Object Storage).
 *
 * Файл уходит POST'ом на наш API, сервер кладёт его в бакет и возвращает адрес
 * на нашем домене (`/files/<ключ>`). Раньше здесь был SDK Vercel Blob с прямой
 * загрузкой в обход лимита тела запроса в 4,5 МБ — на своём сервере этот лимит
 * отсутствует, потолок задают nginx (client_max_body_size) и MAX_UPLOAD_MB.
 */

import { putToStorage, storagePreflight } from '@/lib/storageClient'

export interface StoredFile {
  /** Каноничный адрес файла в хранилище. */
  url: string
  /** Тот же файл с принудительной отдачей на скачивание. */
  downloadUrl: string
  /** Исходное имя файла. */
  name: string
  /** Размер в байтах. */
  size: number
}

/** Безопасное имя объекта в хранилище: без пробелов и служебных символов. */
function safeName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${base || 'file'}-${Date.now().toString(36)}${ext ? `.${ext}` : ''}`
}

/** Человекочитаемый объём файла: «3,4 МБ». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace('.', ',')} КБ`
  const mb = kb / 1024
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace('.', ',')} МБ`
}

/**
 * Залить файл в хранилище под префиксом раздела (`materials/`) и вернуть его
 * адреса. Права администратора проверяет сервер по токену сессии.
 */
export async function uploadFile(prefix: string, file: File): Promise<StoredFile> {
  const pre = await storagePreflight()

  const limitMb = pre.maxUploadMb ?? 256
  if (file.size > limitMb * 1024 * 1024) {
    throw new Error(
      `Файл ${formatFileSize(file.size)} больше допустимых ${limitMb} МБ. ` +
        'Увеличьте MAX_UPLOAD_MB в /etc/mabl-lms.env и client_max_body_size в nginx.',
    )
  }

  const stored = await putToStorage(
    'materials',
    `${prefix}${safeName(file.name)}`,
    file,
    file.type || 'application/octet-stream',
  )

  return {
    url: stored.url,
    // Тот же файл, но с заголовком Content-Disposition: attachment.
    downloadUrl: `${stored.url}?download=${encodeURIComponent(file.name)}`,
    name: file.name,
    size: file.size,
  }
}
