import type { AdminUser, AdminUserStatus } from '@/types'
import { http } from './config'

/** Ресурс «Участники» для админ-панели. Данные хранятся в БД. */
export const usersApi = {
  async list(): Promise<AdminUser[]> {
    return http<AdminUser[]>('/admin/users')
  },

  async get(id: string): Promise<AdminUser | undefined> {
    return http<AdminUser>(`/admin/users/${id}`)
  },

  async setStatus(id: string, status: AdminUserStatus): Promise<AdminUser> {
    return http<AdminUser>(`/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },

  async create(user: AdminUser): Promise<AdminUser> {
    return http<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(user) })
  },

  async update(id: string, patch: Partial<AdminUser>): Promise<AdminUser> {
    return http<AdminUser>(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/admin/users/${id}`, { method: 'DELETE' })
  },

  /** Сброс к исходным данным (сидам). */
  async reset(): Promise<AdminUser[]> {
    return http<AdminUser[]>('/admin/users/reset', { method: 'POST' })
  },
}
