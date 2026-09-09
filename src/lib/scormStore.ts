/**
 * Загрузка SCORM-пакетов в серверное хранилище (Yandex Object Storage).
 *
 * Пакет распаковывается в браузере, а файлы уходят по одному POST'ом на наш
 * API — сервер кладёт их в бакет под ключами `scorm/<id>/<путь>`. Метаданные
 * пакета сохраняются в общей БД, поэтому пакет доступен со всех устройств.
 *
 * Отдаются файлы через СВОЙ домен по /scorm-store/<id>/<путь>. Same-origin
 * важен: контент SCORM ищет window.API, поднимаясь по родительским фреймам, а
 * это работает только в пределах одного источника.
 *
 * Раньше файлы грузились напрямую в Vercel Blob — так обходился лимит тела
 * запроса serverless-функции в 4,5 МБ. На своём сервере этого лимита нет.
 */

import { http } from '@/api/config'
import { putToStorage, storagePreflight } from '@/lib/storageClient'

const BASE = '/scorm-store'

/** Адрес файла в хранилище и его размер (для диагностики пакета). */
export interface ScormFileRef {
  /** Адрес файла на нашем домене. */
  u: string
  /** Размер в байтах. */
  s: number
}

export interface ScormPackage {
  id: string
  title: string
  /** URL точки входа на нашем домене: /scorm-store/<id>/<launch>. */
  launchUrl: string
  /** Относительный путь точки входа внутри пакета. */
  launch: string
  fileCount: number
  uploadedAt: string
  /** Origin прежнего хранилища Vercel Blob — только у пакетов, залитых до переезда. */
  blobBase?: string
  /**
   * Карта «путь внутри пакета → адрес и размер файла». Сохраняется при
   * загрузке и используется диагностикой пакета в админке.
   */
  files?: Record<string, ScormFileRef>
}

const MIME: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain;charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
}

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-|-$/g, '')
  return (base || 'scorm').slice(0, 40)
}

/** Достать название и точку входа из imsmanifest.xml. */
function parseManifest(xml: string): { title?: string; launch?: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const resources = Array.from(doc.getElementsByTagName('resource'))
  // Предпочитаем SCO; иначе первый ресурс с href.
  const sco =
    resources.find((r) => (r.getAttribute('adlcp:scormtype') || r.getAttribute('scormtype')) === 'sco') ??
    resources.find((r) => r.getAttribute('href'))
  const launch = sco?.getAttribute('href') ?? undefined

  const titleNode =
    doc.getElementsByTagName('langstring')[0] ||
    doc.getElementsByTagName('lom:langstring')[0] ||
    doc.querySelector('organization > title') ||
    doc.getElementsByTagName('title')[0]
  const title = titleNode?.textContent?.trim() || undefined

  return { title, launch }
}

/** Выполнить задачи с ограничением параллелизма, отдавая прогресс. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onDone?: (done: number, total: number) => void,
): Promise<void> {
  const total = items.length
  let index = 0
  let done = 0
  async function next(): Promise<void> {
    const i = index++
    if (i >= total) return
    await worker(items[i])
    done += 1
    onDone?.(done, total)
    return next()
  }
  const runners = Array.from({ length: Math.min(limit, total) }, () => next())
  await Promise.all(runners)
}

export type UploadProgress = (done: number, total: number) => void

export const scormStore = {
  async list(): Promise<ScormPackage[]> {
    return http<ScormPackage[]>('/scorm')
  },

  /**
   * Распаковать zip в браузере, залить файлы в Object Storage через наш API и
   * сохранить метаданные пакета в БД. Возвращает метаданные пакета.
   *
   * Если пакет с таким же id уже существует, confirmReplace решает, заменить ли
   * его файлы (курсы со ссылкой на пакет продолжат работать с новой версией)
   * или сохранить рядом как новый пакет с суффиксом в id.
   */
  async upload(
    file: File,
    onProgress?: UploadProgress,
    confirmReplace?: (id: string) => boolean,
  ): Promise<ScormPackage> {
    // JSZip подгружается отдельным чанком только при загрузке пакета. Если сайт
    // обновился, пока вкладка была открыта, старый чанк уже удалён с сервера —
    // просим перезагрузить страницу вместо загадочной ошибки import.
    const JSZip = await import('jszip')
      .then((m) => m.default)
      .catch(() => {
        throw new Error(
          'Вышло обновление сайта — перезагрузите страницу (Ctrl+F5 / Cmd+Shift+R) и повторите загрузку.',
        )
      })
    const zip = await JSZip.loadAsync(file)

    // Находим манифест (обычно в корне).
    const manifestPath = Object.keys(zip.files).find((p) =>
      p.toLowerCase().endsWith('imsmanifest.xml'),
    )
    if (!manifestPath) {
      throw new Error('Это не SCORM-пакет: не найден imsmanifest.xml.')
    }
    const manifestDir = manifestPath.includes('/')
      ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1)
      : ''

    const manifestXml = await zip.files[manifestPath].async('text')
    const { title, launch } = parseManifest(manifestXml)
    if (!launch) {
      throw new Error('В манифесте не найдена точка входа (resource href).')
    }

    // id должен быть уникальным среди уже загруженных пакетов (ключи в бакете),
    // кроме случая осознанной замены существующего пакета его новой версией.
    const existing = new Set((await scormStore.list()).map((p) => p.id))
    let id = slugify(title ?? file.name.replace(/\.zip$/i, ''))
    if (existing.has(id) && !confirmReplace?.(id)) id = `${id}-${Date.now().toString(36)}`

    const entries = Object.values(zip.files).filter(
      (f) => !f.dir && f.name.startsWith(manifestDir),
    )
    if (entries.length === 0) {
      throw new Error('SCORM-пакет пуст: внутри архива нет файлов.')
    }

    // Почтовые шлюзы и антивирусы «обезвреживают» архивы, переименовывая скрипты
    // .js → .j_ (реже .js_). Манифест и index.html при этом ссылаются на .js, и
    // пакет не запускается ни в одной LMS. Восстанавливаем исходные имена, если
    // одноимённого .js в архиве нет.
    const relNames = new Set(entries.map((f) => f.name.slice(manifestDir.length)))
    const restoreSanitizedExt = (rel: string): string => {
      const fixed = rel.replace(/\.js_$/i, '.js').replace(/\.j_$/i, '.js')
      return fixed !== rel && !relNames.has(fixed) ? fixed : rel
    }

    // Преflight: заранее выясняем причину возможного отказа (истёкшая сессия
    // администратора или ненастроенное хранилище) — до того, как браузер начнёт
    // заливать десятки мегабайт.
    await storagePreflight()

    const files: Record<string, ScormFileRef> = {}
    await runPool(
      entries,
      6,
      async (entry) => {
        const rel = restoreSanitizedExt(entry.name.slice(manifestDir.length))
        const blob = await entry.async('blob')
        const stored = await putToStorage('scorm', `scorm/${id}/${rel}`, blob, mimeFor(rel))
        files[rel] = { u: stored.url, s: stored.size }
      },
      onProgress,
    )

    const pkg: ScormPackage = {
      id,
      title: title || id,
      launch,
      launchUrl: `${BASE}/${id}/${launch}`,
      fileCount: entries.length,
      files,
      uploadedAt: new Date().toISOString(),
    }

    // Сохраняем метаданные в БД (доступно всем устройствам).
    await http<ScormPackage>('/scorm', {
      method: 'POST',
      body: JSON.stringify(pkg),
    })
    return pkg
  },

  async remove(id: string): Promise<void> {
    await http<void>(`/scorm/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
