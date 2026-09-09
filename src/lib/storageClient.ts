/**
 * Клиент файлового хранилища.
 *
 * Раньше браузер грузил файлы напрямую в Vercel Blob через SDK: тело запроса к
 * serverless-функции ограничено 4,5 МБ, и обойти лимит можно было только прямой
 * загрузкой в хранилище. На своём сервере (VM Yandex Cloud) такого лимита нет —
 * файл уходит обычным POST на наш API, а сервер кладёт его в Object Storage.
 */

import { API_URL, getToken } from '@/api/config'

/** Ответ сервера на загрузку файла. */
export interface UploadedObject {
  /** Ключ объекта в хранилище, например `materials/otchet-1k2x3.pdf`. */
  key: string
  /** Адрес файла на нашем домене: `/files/<ключ>`. */
  url: string
  /** Размер в байтах. */
  size: number
}

/** Состояние хранилища перед загрузкой. */
export interface StoragePreflight {
  admin: boolean
  storage: boolean
  /** Совместимость с прежним ответом сервера (Vercel Blob). */
  blob?: boolean
  mode?: 'server'
  /** Где лежат файлы: на диске сервера или в Object Storage. */
  storageMode?: 'local' | 'object-storage' | 'none'
  maxUploadMb?: number
  storageEnv?: string[]
}

/**
 * Проверить готовность к загрузке и объяснить отказ понятным текстом — до того,
 * как браузер начнёт заливать десятки мегабайт.
 */
export async function storagePreflight(): Promise<StoragePreflight> {
  const res = await fetch(`${API_URL}/storage/upload-preflight`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  })
  if (!res.ok) {
    throw new Error(`Не удалось проверить состояние хранилища (HTTP ${res.status}).`)
  }
  const pre = (await res.json()) as StoragePreflight

  if (!pre.admin) {
    throw new Error(
      'Сессия администратора истекла. Выйдите и войдите снова, затем повторите загрузку.',
    )
  }
  if (!(pre.storage ?? pre.blob)) {
    const found = pre.storageEnv?.length
      ? ` В окружении сервиса найдены переменные: ${pre.storageEnv.join(', ')}.`
      : ' В окружении сервиса нет ни одной переменной хранилища.'
    throw new Error(
      'Серверу недоступно файловое хранилище.' +
        found +
        ' Как починить: задайте в /etc/mabl-lms.env либо STORAGE_DIR (файлы на диске' +
        ' сервера), либо S3_BUCKET с ключами доступа (Object Storage), затем' +
        ' перезапустите сервис: sudo systemctl restart mabl-lms.',
    )
  }
  return pre
}

/**
 * Залить один файл в хранилище через наш сервер.
 *
 * @param section раздел API: `scorm` (файлы пакетов) или `materials` (вложения)
 * @param key     полный ключ объекта, например `scorm/<id>/index.html`
 */
export async function putToStorage(
  section: 'scorm' | 'materials',
  key: string,
  body: Blob,
  contentType: string,
): Promise<UploadedObject> {
  const token = getToken()
  const res = await fetch(`${API_URL}/${section}/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  })

  if (!res.ok) {
    let message = `Не удалось загрузить файл (HTTP ${res.status})`
    if (res.status === 413) {
      message =
        'Файл слишком большой для сервера. Увеличьте client_max_body_size в nginx и MAX_UPLOAD_MB в /etc/mabl-lms.env.'
    } else {
      try {
        const body = (await res.json()) as { message?: string }
        if (body?.message) message = body.message
      } catch {
        /* сервер ответил не JSON — оставляем сообщение со статусом */
      }
    }
    throw new Error(message)
  }

  return (await res.json()) as UploadedObject
}
