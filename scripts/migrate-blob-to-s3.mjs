#!/usr/bin/env node
/**
 * Перенос файлов из Vercel Blob в Yandex Object Storage.
 *
 * Что делает:
 *   1. Читает из БД метаданные SCORM-пакетов (collection = 'scorm') и учебных
 *      материалов (collection = 'materials').
 *   2. Скачивает каждый файл по адресу, записанному в БД (публичные ссылки
 *      Vercel Blob), и кладёт в бакет под тем же ключом: `scorm/<id>/<путь>`
 *      и `materials/<имя>`.
 *   3. Переписывает адреса в БД на наши: `/files/<ключ>` — чтобы после
 *      отключения Vercel ссылки не протухли.
 *
 * Запуск (на VM, после настройки /etc/mabl-lms.env):
 *   set -a; . /etc/mabl-lms.env; set +a
 *   node scripts/migrate-blob-to-s3.mjs           # перенос
 *   node scripts/migrate-blob-to-s3.mjs --dry-run # только показать план
 *
 * Скрипт идемпотентен: уже перенесённые файлы (адрес начинается с /files/)
 * пропускаются, поэтому его можно запускать повторно.
 */

import fs from 'node:fs'
import process from 'node:process'
import pg from 'pg'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const DRY_RUN = process.argv.includes('--dry-run')

// ---------- подключения ----------

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`!! Не задана переменная окружения ${name}`)
    process.exit(1)
  }
  return value
}

const BUCKET = requireEnv('S3_BUCKET')

const s3 = new S3Client({
  region: process.env.S3_REGION || 'ru-central1',
  endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
  forcePathStyle: true,
  credentials: {
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
  },
})

const caFile = process.env.DATABASE_CA_FILE
const pool = new pg.Pool({
  connectionString: requireEnv('DATABASE_URL'),
  ssl:
    caFile && fs.existsSync(caFile)
      ? { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: false },
})

// ---------- помощники ----------

const stats = { copied: 0, skipped: 0, failed: 0, bytes: 0 }

/** Уже лежит ли объект в бакете. */
async function existsInBucket(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

/** Скачать файл по адресу и положить в бакет под ключом. */
async function copyToBucket(url, key, contentType) {
  if (await existsInBucket(key)) {
    stats.skipped += 1
    return true
  }
  if (DRY_RUN) {
    console.log(`   [dry-run] ${url} → ${key}`)
    stats.copied += 1
    return true
  }

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`   !! ${key}: источник ответил HTTP ${res.status} (${url})`)
    stats.failed += 1
    return false
  }
  const body = Buffer.from(await res.arrayBuffer())
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || res.headers.get('content-type') || 'application/octet-stream',
    }),
  )
  stats.copied += 1
  stats.bytes += body.length
  return true
}

/** Наш адрес файла: ключ → /files/<ключ>. */
function publicUrlFor(key) {
  return `/files/${key.split('/').map(encodeURIComponent).join('/')}`
}

/** Уже перенесённый адрес (или вообще не из Vercel Blob). */
function alreadyLocal(url) {
  return typeof url === 'string' && (url.startsWith('/files/') || url.startsWith('/scorm-store/'))
}

// ---------- перенос SCORM-пакетов ----------

async function migrateScorm() {
  const { rows } = await pool.query(
    "SELECT id, data FROM content WHERE collection = 'scorm' ORDER BY sort_order",
  )
  console.log(`\n== SCORM-пакеты: ${rows.length}`)

  for (const row of rows) {
    const meta = row.data
    const files = meta.files ?? {}
    const names = Object.keys(files)
    if (!names.length) {
      console.log(` - ${row.id}: карта файлов пуста — пакет придётся залить заново через админку`)
      continue
    }

    console.log(` - ${row.id}: файлов ${names.length}`)
    const nextFiles = {}
    let ok = true
    for (const rel of names) {
      const ref = files[rel]
      const key = `scorm/${row.id}/${rel}`
      if (alreadyLocal(ref.u)) {
        nextFiles[rel] = ref
        stats.skipped += 1
        continue
      }
      const copied = await copyToBucket(ref.u, key)
      if (!copied) ok = false
      nextFiles[rel] = { u: publicUrlFor(key), s: ref.s }
    }

    if (!DRY_RUN) {
      // blobBase больше не нужен — раздача собирает ключ из id и пути.
      const { blobBase, ...rest } = meta
      const next = { ...rest, files: nextFiles }
      await pool.query(
        'UPDATE content SET data = $1::jsonb, updated_at = NOW() WHERE collection = $2 AND id = $3',
        [JSON.stringify(next), 'scorm', row.id],
      )
    }
    if (!ok) console.log(`   ! у пакета «${row.id}» часть файлов не перенеслась — см. ошибки выше`)
  }
}

// ---------- перенос файлов материалов ----------

async function migrateMaterials() {
  const { rows } = await pool.query(
    "SELECT id, data FROM content WHERE collection = 'materials' ORDER BY sort_order",
  )
  const withFiles = rows.filter((r) => r.data?.fileUrl)
  console.log(`\n== Материалы с файлами: ${withFiles.length} (всего материалов ${rows.length})`)

  for (const row of withFiles) {
    const meta = row.data
    if (alreadyLocal(meta.fileUrl)) {
      stats.skipped += 1
      continue
    }

    // Имя объекта берём из адреса в Blob: .../materials/otchet-1k2x3.pdf
    let name
    try {
      name = decodeURIComponent(new URL(meta.fileUrl).pathname.split('/').pop() || '')
    } catch {
      name = meta.fileUrl.split('/').pop() || ''
    }
    if (!name) {
      console.error(` !! материал «${row.id}»: не удалось определить имя файла (${meta.fileUrl})`)
      stats.failed += 1
      continue
    }

    const key = `materials/${name}`
    console.log(` - ${row.id}: ${name}`)
    const copied = await copyToBucket(meta.fileUrl, key)
    if (!copied) continue

    if (!DRY_RUN) {
      const next = {
        ...meta,
        fileUrl: publicUrlFor(key),
        fileDownloadUrl: meta.fileName
          ? `${publicUrlFor(key)}?download=${encodeURIComponent(meta.fileName)}`
          : publicUrlFor(key),
      }
      await pool.query(
        'UPDATE content SET data = $1::jsonb, updated_at = NOW() WHERE collection = $2 AND id = $3',
        [JSON.stringify(next), 'materials', row.id],
      )
    }
  }
}

// ---------- запуск ----------

try {
  console.log(DRY_RUN ? 'Режим: пробный прогон (ничего не меняется)' : 'Режим: перенос')
  console.log(`Бакет: ${BUCKET}`)
  await migrateScorm()
  await migrateMaterials()
  console.log(
    `\nИтог: скопировано ${stats.copied}, пропущено ${stats.skipped}, ошибок ${stats.failed}, объём ${(stats.bytes / 1024 / 1024).toFixed(1)} МБ`,
  )
  if (stats.failed) process.exitCode = 1
} catch (err) {
  console.error('!! Ошибка переноса:', err)
  process.exitCode = 1
} finally {
  await pool.end()
}
