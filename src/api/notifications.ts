import type { AppNotification } from '@/types'
import { http } from './config'

/** Ресурс «Уведомления». Данные хранятся в БД. */
export const notificationsApi = {
  async list(): Promise<AppNotification[]> {
    return http<AppNotification[]>('/notifications')
  },
  async create(note: AppNotification): Promise<AppNotification> {
    return http<AppNotification>('/notifications', { method: 'POST', body: JSON.stringify(note) })
  },
  async update(id: string, patch: Partial<AppNotification>): Promise<AppNotification> {
    return http<AppNotification>(`/notifications/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },
  async remove(id: string): Promise<void> {
    return http<void>(`/notifications/${id}`, { method: 'DELETE' })
  },
}
