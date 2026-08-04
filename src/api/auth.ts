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

  /**
   * Регистрация слушателя: аккаунт нужен для покупки и доступа к программам.
   * Вместе с аккаунтом уходит письмо с кодом подтверждения; если отправить его
   * не удалось, сервер сообщает причину в `codeError` — регистрацию это не
   * отменяет, но и молчать о неработающей почте не нужно.
   */
  async register(input: {
    name: string
    email: string
    password: string
  }): Promise<{ user: User; codeError?: string }> {
    const res = await http<User & { token?: string; codeError?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (res.token) setToken(res.token)
    const { token: _token, codeError, ...user } = res
    return { user, codeError }
  },

  /** Актуальный профиль с сервера (статус подтверждения почты). */
  async me(): Promise<User> {
    return http<User>('/me')
  },

  /** Подтвердить e-mail кодом из письма. */
  async verifyEmail(code: string): Promise<void> {
    await http<{ ok: boolean }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },

  /** Выслать код подтверждения повторно. */
  async resendCode(): Promise<string> {
    return http<{ message: string }>('/auth/resend-code', { method: 'POST' }).then((r) => r.message)
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
