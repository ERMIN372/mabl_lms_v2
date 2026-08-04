import type { ProgramApplication } from '@/types'
import { http } from './config'

/** Данные формы «Оставить заявку» на странице программы. */
export interface ApplicationDraft {
  programId: string
  programTitle: string
  name: string
  email: string
  phone: string
  comment?: string
}

/**
 * Заявки на поступление.
 *
 * Отправка (`create`) публичная — её вызывает форма на странице программы,
 * остальные методы доступны только приёмной комиссии в админ-панели.
 */
export const applicationsApi = {
  async create(draft: ApplicationDraft): Promise<ProgramApplication> {
    return http<ProgramApplication>('/applications', {
      method: 'POST',
      body: JSON.stringify(draft),
    })
  },

  async list(): Promise<ProgramApplication[]> {
    return http<ProgramApplication[]>('/admin/applications')
  },

  async update(id: string, patch: Partial<ProgramApplication>): Promise<ProgramApplication> {
    return http<ProgramApplication>(`/admin/applications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/admin/applications/${id}`, { method: 'DELETE' })
  },
}
