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

/** Состояние SMTP-отправки писем. */
export interface MailStatus {
  configured: boolean
  host: string
  port: number
  user: string | null
  from: string | null
  siteUrl: string
}

/** Строка старых демо-данных, найденная в БД. */
export interface DemoRow {
  section: string
  id: string
  title: string
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

  /** Состояние отправки писем (SMTP). */
  async mailStatus(): Promise<MailStatus> {
    return http<MailStatus>('/admin/mail')
  },

  /** Отправить тестовое письмо на указанный адрес. */
  async sendTestMail(email: string): Promise<string> {
    const res = await http<{ message: string }>('/admin/mail/test', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    return res.message
  },

  /** Найти в БД остатки старых демо-данных (без удаления). */
  async findDemo(): Promise<{ rows: DemoRow[] }> {
    return http<{ rows: DemoRow[] }>('/admin/db/demo')
  },

  /** Удалить найденные демо-данные. */
  async purgeDemo(): Promise<{ deleted: number }> {
    return http<{ deleted: number }>('/admin/db/demo/purge', { method: 'POST' })
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
