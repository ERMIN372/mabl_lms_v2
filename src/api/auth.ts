import type { User } from '@/types'
import { http, setToken } from './config'

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

  /** Запросить письмо со ссылкой на смену пароля. */
  async recover(email: string): Promise<string> {
    return http<{ message: string }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }).then((r) => r.message)
  },

  /**
   * Задать новый пароль по одноразовому токену из письма. Сервер сразу выдаёт
   * токен сессии — после смены пароля пользователь уже авторизован.
   */
  async reset(token: string, password: string): Promise<User> {
    const res = await http<User & { token?: string }>('/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
    if (res.token) setToken(res.token)
    const { token: _token, ...user } = res
    return user
  },

  /** Завершить сессию: убрать токен. */
  logout(): void {
    setToken(null)
  },
}
