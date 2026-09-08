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

  /**
   * Проверка сессии на сервере. Возвращает актуальный профиль или бросает
   * ApiError со статусом 401, если токен протух либо аккаунт удалён. Если
   * сервер прислал продлённый токен — сохраняем его: активная работа в кабинете
   * продлевает сессию, и она не рвётся посреди обучения.
   */
  async session(): Promise<User> {
    const res = await http<{ user: User; token?: string }>('/me/session')
    if (res.token) setToken(res.token)
    return res.user
  },

  async recover(email: string): Promise<string> {
    return http<{ message: string }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }).then((r) => r.message)
  },

  /** Завершить сессию: убрать токен. */
  logout(): void {
    setToken(null)
  },
}
