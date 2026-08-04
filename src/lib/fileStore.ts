/**
 * Загрузка одиночных файлов в серверное хранилище (Vercel Blob).
 *
 * Файл идёт из браузера прямо в хранилище — так же, как файлы SCORM-пакетов
 * (см. src/lib/scormStore.ts). Прямая загрузка обходит лимит тела запроса
 * Vercel в 4.5 МБ, поэтому презентацию или PDF на десятки мегабайт можно
 * приложить к материалу без прокси через serverless-функцию.
 */

import { upload, uploadPresigned } from '@vercel/blob/client'
import { http, getToken } from '@/api/config'

/** Порог, выше которого файл грузится частями (устойчивее к обрывам сети). */
const MULTIPART_THRESHOLD = 4 * 1024 * 1024

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

interface Preflight {
  admin: boolean
  blob: boolean
  mode?: 'token' | 'presigned'
  presignError?: string
  blobEnv?: string[]
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
 * Проверить готовность хранилища и объяснить отказ понятным текстом: SDK
 * @vercel/blob прячет любую причину за общей фразой про токен.
 */
async function preflight(): Promise<Preflight> {
  const pre = await http<Preflight>('/storage/upload-preflight')
  if (!pre.admin) {
    throw new Error(
      'Сессия администратора истекла. Выйдите и войдите снова, затем повторите загрузку.',
    )
  }
  if (!pre.blob) {
    const found = pre.blobEnv?.length
      ? ` В окружении найдены переменные: ${pre.blobEnv.join(', ')}.`
      : ' В окружении деплоя нет ни одной переменной Blob.'
    throw new Error(
      'Серверу недоступно хранилище Vercel Blob: нет ни BLOB_READ_WRITE_TOKEN, ни BLOB_STORE_ID.' +
        found +
        ' Как починить: Vercel → Storage → ваш Blob-store → вкладка Projects → Connect Project,' +
        ' затем Redeploy Production.',
    )
  }
  if (pre.mode === 'presigned' && pre.presignError) {
    if (/suspend/i.test(pre.presignError)) {
      throw new Error(
        'Хранилище Vercel Blob приостановлено (suspended) на стороне Vercel — пока оно в этом ' +
          'состоянии, не работают ни загрузка, ни отдача уже загруженных файлов. Проверьте ' +
          'статус и лимиты: Vercel → Storage → ваш Blob-store.',
      )
    }
    throw new Error(
      `Сервер не смог авторизоваться в Vercel Blob по OIDC: ${pre.presignError}` +
        ' Обычно это выключенный OIDC у проекта: Vercel → Project Settings → Security →' +
        ' Secure Backend Access (OIDC) → Enabled, затем Redeploy Production.',
    )
  }
  return pre
}

/**
 * Залить файл в хранилище под префиксом раздела (`materials/`) и вернуть его
 * адреса. Права администратора проверяет сервер по токену из clientPayload.
 */
export async function uploadFile(prefix: string, file: File): Promise<StoredFile> {
  const pre = await preflight()
  // При OIDC-подключении store у сервера нет RW-токена, из которого SDK делает
  // клиентский токен, — вместо этого сервер подписывает пресайнд-URL.
  const putFile = pre.mode === 'presigned' ? uploadPresigned : upload

  const result = await putFile(`${prefix}${safeName(file.name)}`, file, {
    access: 'public',
    handleUploadUrl: `/api/${prefix}blob-upload`,
    contentType: file.type || 'application/octet-stream',
    clientPayload: JSON.stringify({ token: getToken() }),
    multipart: file.size > MULTIPART_THRESHOLD,
  })

  return {
    url: result.url,
    downloadUrl: result.downloadUrl ?? result.url,
    name: file.name,
    size: file.size,
  }
}
