import { scormStore } from '@/lib/scormStore'
import type {
  ScormPackage,
  UploadProgress,
  ScormBlobStatus,
  ScormProbe,
  ScormLastError,
} from '@/lib/scormStore'

export type { ScormPackage, ScormProbe, ScormBlobStatus, ScormLastError } from '@/lib/scormStore'

/**
 * Ресурс «SCORM-пакеты».
 *
 * Файлы пакета распаковываются в браузере и грузятся напрямую в Vercel Blob
 * (прямая загрузка обходит лимит тела запроса Vercel 4.5 МБ), а метаданные
 * пакета хранятся в общей БД. Отдаются файлы через прокси на нашем домене
 * (/scorm-store/<id>/...), поэтому пакет доступен со всех устройств.
 * Подробности — src/lib/scormStore.ts и api/router.ts.
 */
export const scormApi = {
  async list(): Promise<ScormPackage[]> {
    return scormStore.list()
  },

  async status(): Promise<ScormBlobStatus> {
    return scormStore.status()
  },

  async probe(): Promise<ScormProbe[]> {
    return scormStore.probe()
  },

  async lastError(): Promise<ScormLastError> {
    return scormStore.lastError()
  },

  async upload(file: File, onProgress?: UploadProgress): Promise<ScormPackage> {
    return scormStore.upload(file, onProgress)
  },

  async remove(id: string): Promise<void> {
    return scormStore.remove(id)
  },
}
