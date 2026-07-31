import type { User } from '@/types'
import { http, getToken, setToken } from './config'

/**
 * Ресурс «Аутентификация»: вход, регистрация, подтверждение e-mail кодом из
 * письма и восстановление пароля по одноразовой ссылке. При входе и регистрации
 * сервер возвращает токен сессии, который сохраняется и подставляется в
 * последующие запросы.
 */

export interface RegisterInput {
  name: string
  email: string
  password: string
}

export interface RegisterResult {
  user: User
  /** Ушло ли письмо с кодом подтверждения. */
  codeSent: boolean
}

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
  async register(input: RegisterInput): Promise<RegisterResult> {
    const res = await http<User & { token?: string; codeSent?: boolean }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (res.token) setToken(res.token)
    const { token: _token, codeSent, ...user } = res
    return { user, codeSent: Boolean(codeSent) }
  },

  /** Профиль текущей сессии (в т.ч. подтверждён ли e-mail). */
  async me(): Promise<User | null> {
    if (!getToken()) return null
    try {
      return await http<User>('/me')
    } catch {
      return null
    }
  },

  /** Выслать код подтверждения на почту аккаунта. */
  async sendCode(): Promise<string> {
    const res = await http<{ message: string }>('/auth/send-code', { method: 'POST' })
    return res.message
  },

  /** Подтвердить почту кодом из письма. */
  async verifyEmail(code: string): Promise<void> {
    await http('/auth/verify-email', { method: 'POST', body: JSON.stringify({ code }) })
  },

  /** Запросить письмо со ссылкой для смены пароля. */
  async forgotPassword(email: string): Promise<string> {
    const res = await http<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    return res.message
  },

  /** Задать новый пароль по одноразовому токену из письма. */
  async resetPassword(token: string, password: string): Promise<string> {
    const res = await http<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
    return res.message
  },

  /** Завершить сессию: убрать токен. */
  logout(): void {
    setToken(null)
  },
}
