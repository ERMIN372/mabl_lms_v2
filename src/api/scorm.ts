import { scormStore } from '@/lib/scormStore'
import type { ScormPackage, UploadProgress } from '@/lib/scormStore'
import { http } from '@/api/config'

export type { ScormPackage } from '@/lib/scormStore'

/** Результат серверной диагностики пакета (см. api/router.ts). */
export interface ScormDiagnostics {
  id: string
  mode: 'token' | 'oidc' | 'none'
  fileCount: number
  okCount: number
  failed: Array<{ path: string; sizeKb: number; via: string; status: number | string }>
  listError?: string
  tookMs: number
}

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

  async upload(
    file: File,
    onProgress?: UploadProgress,
    confirmReplace?: (id: string) => boolean,
  ): Promise<ScormPackage> {
    return scormStore.upload(file, onProgress, confirmReplace)
  },

  async remove(id: string): Promise<void> {
    return scormStore.remove(id)
  },

  /** Проверить на сервере, какие файлы пакета реально отдаются. */
  async diagnose(id: string): Promise<ScormDiagnostics> {
    return http<ScormDiagnostics>(`/scorm/${encodeURIComponent(id)}/diagnose`)
  },
}
