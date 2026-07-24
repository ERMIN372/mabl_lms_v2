import { scormStore } from '@/lib/scormStore'
import type { ScormPackage, UploadProgress } from '@/lib/scormStore'

export type { ScormPackage } from '@/lib/scormStore'

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

  async upload(file: File, onProgress?: UploadProgress): Promise<ScormPackage> {
    return scormStore.upload(file, onProgress)
  },

  async remove(id: string): Promise<void> {
    return scormStore.remove(id)
  },
}
