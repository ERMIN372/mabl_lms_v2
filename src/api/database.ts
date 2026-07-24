import { http } from './config'

/** Ресурс «Управление базой данных» для админ-панели (реальная БД Neon). */

export interface DbTable {
  name: string
  label: string
  rows: number
}

export interface DbUser {
  id: string
  name: string
  email: string
  role: string
  kind: 'admin' | 'student'
  createdAt?: string
}

export interface DbStatus {
  tables: DbTable[]
  users: DbUser[]
}

export interface NewDbUser {
  name: string
  email: string
  role?: string
  kind: 'admin' | 'student'
  password: string
}

export interface DbUserPatch {
  name?: string
  role?: string
  kind?: 'admin' | 'student'
  password?: string
}

export const databaseApi = {
  async status(): Promise<DbStatus> {
    return http<DbStatus>('/admin/db')
  },

  async init(): Promise<{ ok: boolean; counts: { courses: number; users: number } }> {
    return http('/admin/db/init', { method: 'POST' })
  },

  async resetCourses(): Promise<unknown> {
    return http('/admin/db/reset-courses', { method: 'POST' })
  },

  async createUser(user: NewDbUser): Promise<DbUser> {
    return http<DbUser>('/admin/db/users', { method: 'POST', body: JSON.stringify(user) })
  },

  async updateUser(id: string, patch: DbUserPatch): Promise<DbUser> {
    return http<DbUser>(`/admin/db/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async deleteUser(id: string): Promise<void> {
    await http(`/admin/db/users/${id}`, { method: 'DELETE' })
  },
}
