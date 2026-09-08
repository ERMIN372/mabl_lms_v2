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
  register: (input: { name: string; email: string; password: string }) => Promise<User>
  logout: () => void
  recover: (email: string) => Promise<string>
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

  // Сверка восстановленной сессии с сервером — один раз при запуске приложения.
  useEffect(() => {
    if (!restoring) return
    let active = true
    api.auth
      .session()
      .then((account) => {
        if (active) setUser(account)
      })
      .catch((err) => {
        if (!active) return
        // 401 — токена нет или он протух: сбрасываем вход осознанно.
        // Любая другая ошибка (сеть, холодный старт БД) сессию не трогает.
        if (err instanceof ApiError && err.status === 401) {
          api.auth.logout()
          setUser(null)
          setSessionExpired(true)
        }
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => {
      active = false
    }
    // Проверка выполняется один раз: дальше состояние ведут login/logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email: string, password: string) => {
    const account = await api.auth.login(email, password)
    setSessionExpired(false)
    setUser(account)
    return account
  }

  const register = async (input: { name: string; email: string; password: string }) => {
    const account = await api.auth.register(input)
    setSessionExpired(false)
    setUser(account)
    return account
  }

  const logout = () => {
    api.auth.logout()
    setSessionExpired(false)
    setUser(null)
  }

  const recover = (email: string) => api.auth.recover(email)

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
