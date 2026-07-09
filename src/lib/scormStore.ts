/**
 * Загрузка SCORM-пакетов в серверное хранилище (Vercel Blob).
 *
 * Раньше пакет распаковывался только в браузере (Cache Storage), поэтому курс
 * работал лишь на том компьютере, с которого его загрузили. Теперь файлы
 * распаковываются в браузере и грузятся напрямую в Vercel Blob (прямая загрузка
 * обходит лимит тела запроса Vercel в 4.5 МБ), а метаданные пакета сохраняются
 * в общей БД. Благодаря этому пакет доступен со всех устройств.
 *
 * Файлы лежат в Blob под путями scorm/<id>/<путь>, но отдаются приложением через
 * СВОЙ домен по /scorm-store/<id>/<путь> (прокси в api/router.ts). Same-origin
 * важен: контент SCORM ищет window.API, поднимаясь по родительским фреймам, а
 * это работает только в пределах одного источника.
 */

import { uploadPresigned } from '@vercel/blob/client'
import { http, getToken } from '@/api/config'

const BASE = '/scorm-store'

/** Порог, выше которого файл грузится частями (multipart) — обходит лимит на
 * размер одиночного запроса, крупные ассеты (видео, тяжёлые PNG) не дают 413. */
const MULTIPART_THRESHOLD = 4 * 1024 * 1024

export interface ScormPackage {
  id: string
  title: string
  /** URL точки входа на нашем домене: /scorm-store/<id>/<launch>. */
  launchUrl: string
  /** Относительный путь точки входа внутри пакета. */
  launch: string
  fileCount: number
  uploadedAt: string
  /** Origin хранилища Blob (для прокси). Проставляется при загрузке. */
  blobBase?: string
  /** Карта путь-в-пакете → фактический URL файла в Blob (авторитетно для раздачи). */
  files?: Record<string, string>
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
  // Транслитерируем кириллицу в латиницу: путь к файлам в Blob должен быть
  // ASCII. Иначе Blob API портит UTF-8 в scope signed-token и presigned-загрузка
  // падает с «Blob path does not match the signed token scope».
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ' ': '-',
  }
  const base = value
    .toLowerCase()
    .split('')
    .map((ch) => (ch in map ? map[ch] : /[a-z0-9-]/.test(ch) ? ch : ''))
    .join('')
    .replace(/-+/g, '-')
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

  /** Подключено ли хранилище Vercel Blob (иначе загрузка невозможна). */
  async status(): Promise<{ configured: boolean }> {
    try {
      return await http<{ configured: boolean }>('/scorm/blob-status')
    } catch {
      return { configured: false }
    }
  },

  /**
   * Распаковать zip в браузере, залить файлы в Vercel Blob и сохранить
   * метаданные пакета в БД. Возвращает метаданные пакета.
   */
  async upload(file: File, onProgress?: UploadProgress): Promise<ScormPackage> {
    // JSZip подгружается отдельным чанком только при загрузке пакета.
    const { default: JSZip } = await import('jszip')
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

    // id должен быть уникальным среди уже загруженных пакетов (пути в Blob).
    const existing = new Set((await scormStore.list()).map((p) => p.id))
    let id = slugify(title ?? file.name.replace(/\.zip$/i, ''))
    if (existing.has(id)) id = `${id}-${Date.now().toString(36)}`

    const entries = Object.values(zip.files).filter(
      (f) => !f.dir && f.name.startsWith(manifestDir),
    )
    if (entries.length === 0) {
      throw new Error('SCORM-пакет пуст: внутри архива нет файлов.')
    }

    // Токен сессии администратора кладём в clientPayload — сервер проверяет
    // права в /api/scorm/blob-upload перед выдачей presigned-URL.
    const clientPayload = JSON.stringify({ token: getToken() })

    let blobBase = ''
    const files: Record<string, string> = {}
    // Файлы грузим напрямую в Blob по presigned-URL (авторизация сервера — OIDC).
    // Крупные файлы — частями (multipart), чтобы не упереться в лимит 4.5 МБ.
    await runPool(
      entries,
      6,
      async (entry) => {
        const rel = entry.name.slice(manifestDir.length)
        const blob = await entry.async('blob')
        const result = await uploadPresigned(`scorm/${id}/${rel}`, blob, {
          access: 'public',
          handleUploadUrl: '/api/scorm/blob-upload',
          contentType: mimeFor(rel),
          clientPayload,
          multipart: blob.size > MULTIPART_THRESHOLD,
        })
        files[rel] = result.url
        if (!blobBase) blobBase = new URL(result.url).origin
      },
      onProgress,
    )

    const pkg: ScormPackage = {
      id,
      title: title || id,
      launch,
      launchUrl: `${BASE}/${id}/${launch}`,
      fileCount: entries.length,
      uploadedAt: new Date().toISOString(),
      blobBase,
      files,
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
