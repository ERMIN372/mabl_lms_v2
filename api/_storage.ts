import type { Readable } from 'node:stream'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

/**
 * Файловое хранилище: Yandex Object Storage (S3-совместимое).
 *
 * Заменяет Vercel Blob. Бакет держим приватным — всё наружу отдаёт наш сервер
 * (`/scorm-store/*` для пакетов SCORM и `/files/*` для файлов материалов).
 * Так ссылки остаются same-origin (это обязательно для SCORM: контент ищет
 * window.API по родительским фреймам) и не зависят от публичности бакета.
 *
 * Переменные окружения:
 *   S3_BUCKET             — имя бакета (обязательно)
 *   S3_ENDPOINT           — https://storage.yandexcloud.net (по умолчанию)
 *   S3_REGION             — ru-central1 (по умолчанию)
 *   S3_ACCESS_KEY_ID      — статический ключ сервисного аккаунта
 *   S3_SECRET_ACCESS_KEY  — секрет этого ключа
 */

const DEFAULT_ENDPOINT = 'https://storage.yandexcloud.net'
const DEFAULT_REGION = 'ru-central1'

let client: S3Client | undefined

function accessKeyId(): string | undefined {
  return process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
}

function secretAccessKey(): string | undefined {
  return process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
}

/** Имя бакета; бросает понятную ошибку, если хранилище не настроено. */
export function bucket(): string {
  const name = process.env.S3_BUCKET
  if (!name) throw new Error('Не задан S3_BUCKET — хранилище файлов не настроено')
  return name
}

/** Настроено ли хранилище (для preflight в админке). */
export function isStorageConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET && accessKeyId() && secretAccessKey())
}

/** Какие переменные хранилища видит процесс (без значений) — для диагностики. */
export function storageEnvNames(): string[] {
  return Object.keys(process.env).filter((k) => k.startsWith('S3_') || k.startsWith('AWS_'))
}

function s3(): S3Client {
  if (!client) {
    const id = accessKeyId()
    const secret = secretAccessKey()
    if (!id || !secret) {
      throw new Error('Не заданы ключи доступа к хранилищу (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY)')
    }
    client = new S3Client({
      region: process.env.S3_REGION || DEFAULT_REGION,
      endpoint: process.env.S3_ENDPOINT || DEFAULT_ENDPOINT,
      // Object Storage Яндекса работает по path-style адресации.
      forcePathStyle: true,
      credentials: { accessKeyId: id, secretAccessKey: secret },
    })
  }
  return client
}

/** Записать объект. */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  )
}

export interface StoredObject {
  body: Readable
  contentType?: string
  contentLength?: number
  /** Заголовок Content-Range — есть только при частичном ответе. */
  contentRange?: string
  /** 206 при частичном ответе, иначе 200. */
  status: 200 | 206
}

/** Прочитать объект (с поддержкой Range — нужен для видео внутри пакетов). */
export async function getObject(key: string, range?: string): Promise<StoredObject> {
  const out = await s3().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: range }),
  )
  return {
    body: out.Body as Readable,
    contentType: out.ContentType,
    contentLength: out.ContentLength,
    contentRange: out.ContentRange,
    status: out.ContentRange ? 206 : 200,
  }
}

/** Есть ли объект и какого он размера. */
export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  try {
    const out = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
    return { size: out.ContentLength ?? 0, contentType: out.ContentType }
  } catch {
    return null
  }
}

/** Перечислить ключи с префиксом (постранично, до конца). */
export async function listKeys(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const result: Array<{ key: string; size: number }> = []
  let token: string | undefined
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    )
    for (const item of page.Contents ?? []) {
      if (item.Key) result.push({ key: item.Key, size: item.Size ?? 0 })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return result
}

/** Удалить объекты пачками по 1000 (лимит протокола S3). */
export async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    if (!chunk.length) continue
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      }),
    )
  }
}

/**
 * Публичный адрес файла на нашем домене. Ключ `materials/report.pdf` →
 * `/files/materials/report.pdf`; раздачей занимается наш сервер.
 */
export function publicUrlFor(key: string): string {
  return `/files/${key.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Обратное преобразование: из адреса файла получить ключ в хранилище.
 * Понимает и наши адреса (`/files/...`), и старые ссылки Vercel Blob
 * (`https://<store>.public.blob.vercel-storage.com/<key>`) — последние ещё
 * встречаются в записях материалов, перенесённых с Vercel.
 */
export function keyFromUrl(url: string): string | undefined {
  if (!url) return undefined
  try {
    const path = url.startsWith('http') ? new URL(url).pathname : url
    const clean = decodeURIComponent(path).replace(/^\/+/, '')
    if (clean.startsWith('files/')) return clean.slice('files/'.length)
    return clean || undefined
  } catch {
    return undefined
  }
}
