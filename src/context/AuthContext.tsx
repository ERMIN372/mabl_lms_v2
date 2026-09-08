import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@/types'
import { api, ApiError } from '@/api'

/**
 * Сессия пользователя. Учётные данные проверяет слой данных (`api.auth`),
 * а здесь хранится только состояние сессии (в localStorage, чтобы вход
 * сохранялся между перезагрузками).
 *
 * Профиль в localStorage и токен сессии живут порознь, и раньше профиль
 * переживал токен: человек видел себя залогиненным, а сервер его уже не
 * узнавал — оплаченные программы «закрывались» сами собой. Поэтому при загрузке
 * восстановленный профиль сверяется с сервером (`/api/me/session`): сессия
 * продлевается, а если она мертва — вход честно сбрасывается с понятным
 * сообщением вместо тихой потери доступа.
 */

const STORAGE_KEY = 'mabl.auth.user'

/** Совместимость со старыми профилями в localStorage (без поля kind). */
function normalizeUser(raw: unknown): User | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Partial<User>
  if (!u.id || !u.email) return null
  return {
    id: u.id,
    name: u.name ?? '',
    email: u.email,
    role: u.role ?? 'Слушатель академии',
    kind: u.kind === 'admin' ? 'admin' : 'student',
    emailVerified: Boolean(u.emailVerified),
  }
}

interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  isAdmin: boolean
  /** Проверяется ли сохранённая сессия на сервере (первые мгновения загрузки). */
  restoring: boolean
  /** Сессия была сброшена сервером — нужен повторный вход. */
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<User>
  register: (input: {
    name: string
    email: string
    password: string
  }) => Promise<{ user: User; codeError?: string }>
  logout: () => void
  recover: (email: string) => Promise<string>
  /** Задать новый пароль по ссылке из письма: сервер сразу открывает сессию. */
  resetPassword: (token: string, password: string) => Promise<User>
  /** Подтвердить e-mail кодом из письма. */
  verifyEmail: (code: string) => Promise<void>
  /** Выслать код подтверждения повторно. */
  resendCode: () => Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? normalizeUser(JSON.parse(raw)) : null
    } catch {
      return null
    }
  })

  const [sessionExpired, setSessionExpired] = useState(false)
  // Проверяем сохранённый профиль только если он вообще есть.
  const [restoring, setRestoring] = useState(() => {
    try {
      return Boolean(localStorage.getItem(STORAGE_KEY))
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  }, [user])

  // Сессия, начатая до появления cookie, живёт только в localStorage. Раздача
  // материалов SCORM читает именно cookie, поэтому подтверждаем сессию серверу
  // при загрузке приложения — иначе у давно вошедших курсы «не открываются».
  useEffect(() => {
    if (user) void api.auth.syncSession()
  }, [user])

  const login = async (email: string, password: string) => {
    const account = await api.auth.login(email, password)
    setSessionExpired(false)
    setUser(account)
    return account
  }

  const register = async (input: { name: string; email: string; password: string }) => {
    const result = await api.auth.register(input)
    setUser(result.user)
    return result
  }

  const logout = () => {
    void api.auth.logout()
    setUser(null)
  }

  const recover = (email: string) => api.auth.recover(email)

  const resetPassword = async (token: string, password: string) => {
    const account = await api.auth.reset(token, password)
    setUser(account)
    return account
  }

  const verifyEmail = async (code: string) => {
    await api.auth.verifyEmail(code)
    setUser((prev) => (prev ? { ...prev, emailVerified: true } : prev))
  }

  const resendCode = () => api.auth.resendCode()

  // Признак подтверждённой почты меняется на сервере (подтверждение с другого
  // устройства, переход по ссылке сброса), а копия профиля лежит в браузере —
  // поэтому при загрузке приложения перечитываем профиль.
  useEffect(() => {
    if (!user || user.emailVerified) return
    let active = true
    void api.auth
      .me()
      .then((fresh) => active && setUser((prev) => (prev ? { ...prev, ...fresh } : prev)))
      .catch(() => {
        /* сессия истекла — вход попросят при следующем действии */
      })
    return () => {
      active = false
    }
    // Достаточно одной сверки на вход в приложение.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAdmin: user?.kind === 'admin',
      restoring,
      sessionExpired,
      login,
      register,
      logout,
      recover,
      resetPassword,
      verifyEmail,
      resendCode,
    }),
    [user, restoring, sessionExpired],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return ctx
}
