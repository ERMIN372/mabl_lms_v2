import type { Survey } from '@/types'
import { http } from './config'

/** Ресурс «Опросники». Данные хранятся в БД. */
export const surveysApi = {
  async list(): Promise<Survey[]> {
    return http<Survey[]>('/surveys')
  },
  async get(id: string): Promise<Survey | undefined> {
    return http<Survey>(`/surveys/${id}`)
  },
  async create(survey: Survey): Promise<Survey> {
    return http<Survey>('/surveys', { method: 'POST', body: JSON.stringify(survey) })
  },
  async update(id: string, patch: Partial<Survey>): Promise<Survey> {
    return http<Survey>(`/surveys/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },
  async remove(id: string): Promise<void> {
    return http<void>(`/surveys/${id}`, { method: 'DELETE' })
  },
}
