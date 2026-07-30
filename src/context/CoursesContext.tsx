import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Course } from '@/types'
import { api } from '@/api'

/**
 * Каталог программ — источник истины для всего приложения (каталог, главная,
 * кабинет, админка). Все операции идут через слой данных `api.courses`.
 *
 * Для мгновенной отрисовки состояние инициализируется синхронным снимком
 * (`peek`), а затем синхронизируется асинхронным `list()`.
 */

interface CoursesContextValue {
  courses: Course[]
  loading: boolean
  getCourseById: (id: string) => Course | undefined
  addCourse: (course: Course) => Promise<string>
  updateCourse: (id: string, patch: Partial<Course>) => Promise<void>
  deleteCourse: (id: string) => Promise<void>
}

const CoursesContext = createContext<CoursesContextValue | null>(null)

export function CoursesProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<Course[]>(() => api.courses.peek())
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const list = await api.courses.list()
    setCourses(list)
    return list
  }

  useEffect(() => {
    let active = true
    api.courses
      .list()
      .then((list) => active && setCourses(list))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const addCourse = async (course: Course): Promise<string> => {
    const created = await api.courses.create(course)
    await refresh()
    return created.id
  }

  const updateCourse = async (id: string, patch: Partial<Course>) => {
    await api.courses.update(id, patch)
    await refresh()
  }

  const deleteCourse = async (id: string) => {
    await api.courses.remove(id)
    await refresh()
  }

  const value = useMemo<CoursesContextValue>(
    () => ({
      courses,
      loading,
      getCourseById: (id) => courses.find((c) => c.id === id),
      addCourse,
      updateCourse,
      deleteCourse,
    }),
    [courses, loading],
  )

  return <CoursesContext.Provider value={value}>{children}</CoursesContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCourses(): CoursesContextValue {
  const ctx = useContext(CoursesContext)
  if (!ctx) throw new Error('useCourses должен использоваться внутри CoursesProvider')
  return ctx
}
