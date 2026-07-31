import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@/types'
import { api } from '@/api'
import type { RegisterInput, RegisterResult } from '@/api/auth'

/**
 * Сессия пользователя. Учётные данные проверяет слой данных (`api.auth`),
 * здесь хранится только состояние сессии. Профиль дублируется в localStorage,
 * чтобы вход переживал перезагрузку, но при старте сверяется с сервером
 * (`GET /api/me`) — так подхватывается актуальный статус подтверждения почты.
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
  /** Подтверждён ли e-mail текущего пользователя. */
  isEmailVerified: boolean
  login: (email: string, password: string) => Promise<User>
  register: (input: RegisterInput) => Promise<RegisterResult>
  logout: () => void
  /** Перечитать профиль с сервера (например, после подтверждения почты). */
  refreshProfile: () => Promise<User | null>
  /** Запросить письмо со ссылкой для смены пароля. */
  forgotPassword: (email: string) => Promise<string>
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

  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  }, [user])

  // Сверяем сохранённый профиль с сервером: истёкшая сессия закрывается,
  // подтверждение почты и смена имени подхватываются.
  useEffect(() => {
    let active = true
    if (!user) return
    api.auth.me().then((fresh) => {
      if (!active) return
      if (fresh) setUser(fresh)
      else setUser(null)
    })
    return () => {
      active = false
    }
    // Проверка нужна один раз при старте приложения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email: string, password: string) => {
    const account = await api.auth.login(email, password)
    setUser(account)
    return account
  }

  const register = async (input: RegisterInput) => {
    const result = await api.auth.register(input)
    setUser(result.user)
    return result
  }

  const logout = () => {
    api.auth.logout()
    setUser(null)
  }

  const refreshProfile = async () => {
    const fresh = await api.auth.me()
    if (fresh) setUser(fresh)
    return fresh
  }

  const forgotPassword = (email: string) => api.auth.forgotPassword(email)

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAdmin: user?.kind === 'admin',
      isEmailVerified: Boolean(user?.emailVerified),
      login,
      register,
      logout,
      refreshProfile,
      forgotPassword,
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return ctx
}
