import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@/types'
import { api } from '@/api'

/**
 * Сессия пользователя. Учётные данные проверяет слой данных (`api.auth`),
 * а здесь хранится только состояние сессии (в localStorage, чтобы вход
 * сохранялся между перезагрузками). При переходе на реальный бэкенд логика
 * входа меняется в `src/api/auth.ts`, контекст и UI остаются прежними.
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
  login: (email: string, password: string) => Promise<User>
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

  useEffect(() => {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  }, [user])

  const login = async (email: string, password: string) => {
    const account = await api.auth.login(email, password)
    setUser(account)
    return account
  }

  const logout = () => {
    api.auth.logout()
    setUser(null)
  }

  const recover = (email: string) => api.auth.recover(email)

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAdmin: user?.kind === 'admin',
      login,
      logout,
      recover,
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
