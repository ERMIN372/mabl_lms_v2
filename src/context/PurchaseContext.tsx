import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { isFree } from '@/lib/utils'
import type { Course } from '@/types'

/**
 * Доступ к программам.
 *
 * Источник истины — сервер: доступ есть только у авторизованного пользователя и
 * только к тем программам, по которым в БД есть оплаченный заказ
 * (GET /api/me/courses). Локально доступ не выдаётся и не хранится — гость
 * видит только описание программы.
 *
 * Сбой запроса доступ НЕ закрывает. Раньше любая ошибка (холодный старт базы,
 * обрыв сети, 500 на деплое) молча превращалась в пустой список, и оплаченная
 * программа выглядела недоступной. Теперь список отзывается только по явному
 * 401 — когда сервер сказал, что сессии нет.
 */

const EVENTS_KEY = 'mabl.registered.events'

interface PurchaseContextValue {
  ownedCourseIds: string[]
  registeredEventIds: string[]
  /** Загружается ли список доступных программ. */
  loading: boolean
  /**
   * Список доступов не удалось обновить (сеть или сервер), показан прошлый.
   * UI может предупредить, что данные могут быть неактуальны.
   */
  accessStale: boolean
  isOwned: (courseId: string) => boolean
  /**
   * Открыты ли материалы программы: нужен вход, плюс оплаченный заказ
   * (бесплатные программы открыты любому авторизованному слушателю).
   */
  canAccessCourse: (course: Pick<Course, 'id' | 'price'>) => boolean
  isRegistered: (eventId: string) => boolean
  /** Перечитать доступы с сервера (например, после возврата с оплаты). */
  refreshAccess: () => Promise<string[]>
  /** Записаться на событие календаря. */
  registerEvent: (eventId: string) => void
}

const PurchaseContext = createContext<PurchaseContextValue | null>(null)

/** Ключ записей на события — свой у каждого пользователя. */
function eventsKey(userId: string | undefined): string {
  return userId ? `${EVENTS_KEY}.${userId}` : EVENTS_KEY
}

function loadEvents(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function PurchaseProvider({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth()
  const userId = user?.id
  const [ownedCourseIds, setOwned] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [accessStale, setAccessStale] = useState(false)
  const [registeredEventIds, setRegistered] = useState<string[]>(() => loadEvents(eventsKey(undefined)))
  // Последний известный список — чтобы вернуть его, если обновление сорвалось.
  const ownedRef = useRef<string[]>([])
  ownedRef.current = ownedCourseIds

  const refreshAccess = useCallback(async (): Promise<string[]> => {
    if (!userId) {
      setOwned([])
      setAccessStale(false)
      return []
    }
    setLoading(true)
    try {
      const ids = await api.courses.myAccess()
      setOwned(ids)
      setAccessStale(false)
      return ids
    } catch (err) {
      // 401 — сессии нет: доступ закрыт до повторного входа, это не сбой.
      if (err instanceof ApiError && err.status === 401) {
        setOwned([])
        setAccessStale(false)
        return []
      }
      // Всё остальное — временная неполадка. Прошлый список сохраняем.
      setAccessStale(true)
      return ownedRef.current
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Список доступных программ перезагружается при входе и выходе. Пока сессия
  // сверяется с сервером, запрос не шлём — иначе он уйдёт со старым токеном.
  useEffect(() => {
    if (restoring) return
    void refreshAccess()
  }, [refreshAccess, restoring])

  // Записи на события — локальные и привязаны к пользователю.
  useEffect(() => {
    setRegistered(loadEvents(eventsKey(userId)))
  }, [userId])

  useEffect(() => {
    localStorage.setItem(eventsKey(userId), JSON.stringify(registeredEventIds))
  }, [registeredEventIds, userId])

  const registerEvent = (eventId: string) => {
    setRegistered((prev) => (prev.includes(eventId) ? prev : [...prev, eventId]))
  }

  const value = useMemo<PurchaseContextValue>(
    () => ({
      ownedCourseIds,
      registeredEventIds,
      loading,
      accessStale,
      isOwned: (id) => ownedCourseIds.includes(id),
      canAccessCourse: (course) =>
        Boolean(userId) && (isFree(course.price) || ownedCourseIds.includes(course.id)),
      isRegistered: (id) => registeredEventIds.includes(id),
      refreshAccess,
      registerEvent,
    }),
    [ownedCourseIds, registeredEventIds, loading, accessStale, refreshAccess, userId],
  )

  return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePurchases(): PurchaseContextValue {
  const ctx = useContext(PurchaseContext)
  if (!ctx) throw new Error('usePurchases должен использоваться внутри PurchaseProvider')
  return ctx
}
