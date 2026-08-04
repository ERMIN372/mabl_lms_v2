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
