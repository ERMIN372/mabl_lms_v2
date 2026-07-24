/**
 * Конфигурация слоя данных.
 *
 * Приложение общается с данными ТОЛЬКО через модули `src/api/*`, которые ходят
 * на реальный бэкенд (`/api/*`, serverless-функции + БД Neon). Демонстрационный
 * mock-режим удалён — для работы нужен бэкенд и заданная переменная окружения
 * `DATABASE_URL`.
 */

/** Базовый URL API. По умолчанию — относительный путь `/api` (тот же домен). */
export const API_URL = import.meta.env.VITE_API_URL ?? '/api'

/** Ключ хранения токена сессии. */
const TOKEN_KEY = 'mabl.auth.token'

/** Токен текущей сессии (для авторизованных запросов к API). */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Сохранить/очистить токен сессии. */
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage недоступен — игнорируем */
  }
}

/** Ошибка обращения к API с HTTP-статусом (если есть). */
export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Базовый HTTP-клиент: подставляет токен сессии и разворачивает ошибки API. */
export async function http<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    ...options,
  })

  if (!res.ok) {
    let message = `Ошибка запроса (${res.status})`
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) message = body.message
    } catch {
      /* тело без JSON — оставляем сообщение по умолчанию */
    }
    throw new ApiError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
