import type { User } from '@/types'
import { http, setToken, getToken } from './config'

/**
 * Ресурс «Аутентификация». Обращается к реальному бэкенду (/auth/login,
 * /auth/recover). При успешном входе сервер возвращает токен сессии, который
 * сохраняется и подставляется в последующие запросы.
 */
export const authApi = {
  async login(email: string, password: string): Promise<User> {
    const res = await http<User & { token?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (res.token) setToken(res.token)
    const { token: _token, ...user } = res
    return user
  },

  /** Регистрация слушателя: аккаунт нужен для покупки и доступа к программам. */
  async register(input: { name: string; email: string; password: string }): Promise<User> {
    const res = await http<User & { token?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (res.token) setToken(res.token)
    const { token: _token, ...user } = res
    return user
  },

  async recover(email: string): Promise<string> {
    return http<{ message: string }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }).then((r) => r.message)
  },

  /**
   * Подтвердить сессию серверу, чтобы он выставил cookie.
   *
   * Файлы SCORM-пакета запрашивает сам браузер изнутри iframe — заголовок
   * Authorization туда не поставить, и раздача узнаёт слушателя только по
   * cookie. При входе её ставит сервер; этот вызов нужен тем, кто вошёл раньше
   * и у кого в браузере есть токен, но ещё нет cookie.
   */
  async syncSession(): Promise<void> {
    if (!getToken()) return
    try {
      await http<{ ok: boolean }>('/auth/session', { method: 'POST' })
    } catch {
      /* сессия истекла — доступ к материалам просто попросит войти заново */
    }
  },

  /** Завершить сессию: убрать токен и погасить cookie на сервере. */
  async logout(): Promise<void> {
    try {
      await http<{ ok: boolean }>('/auth/logout', { method: 'POST' })
    } catch {
      /* сервер недоступен — локальный токен всё равно убираем */
    }
    setToken(null)
  },
}
