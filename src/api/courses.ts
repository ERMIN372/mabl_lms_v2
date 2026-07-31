import type { Course } from '@/types'
import { http } from './config'

// Технические заготовки, которыми раньше заполнялись курсы, созданные из
// SCORM-пакета. В сохранённых курсах они могли остаться — при чтении заменяем
// на человекочитаемые значения, чтобы слушатели не видели служебный текст.
const LEGACY_SCORM_DESCRIPTION =
  'Загруженный SCORM-пакет. Отредактируйте описание программы при необходимости.'
const LEGACY_SCORM_SUBTITLE = 'Интерактивный SCORM-тренинг'

function normalizeCourse(course: Course): Course {
  return {
    ...course,
    subtitle: course.subtitle === LEGACY_SCORM_SUBTITLE ? 'Интерактивный тренинг' : course.subtitle,
    description: course.description === LEGACY_SCORM_DESCRIPTION ? '' : course.description,
    tags: (course.tags ?? []).filter((t) => t.toUpperCase() !== 'SCORM'),
  }
}

/**
 * Ресурс «Программы». Единственная точка доступа к курсам для всего приложения.
 * Данные хранятся в БД и приходят через API.
 */
export const coursesApi = {
  /** Синхронный снимок отсутствует — данные приходят асинхронно через list(). */
  peek(): Course[] {
    return []
  },

  async list(): Promise<Course[]> {
    return (await http<Course[]>('/courses')).map(normalizeCourse)
  },

  async get(id: string): Promise<Course | undefined> {
    const course = await http<Course>(`/courses/${id}`)
    return course ? normalizeCourse(course) : course
  },

  async create(course: Course): Promise<Course> {
    return normalizeCourse(await http<Course>('/courses', { method: 'POST', body: JSON.stringify(course) }))
  },

  async update(id: string, patch: Partial<Course>): Promise<Course> {
    return normalizeCourse(
      await http<Course>(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    )
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/courses/${id}`, { method: 'DELETE' })
  },

  /**
   * Программы, доступные текущему пользователю (по оплаченным заказам).
   * Требует токен сессии; гостю сервер отвечает пустым списком.
   */
  async myAccess(): Promise<string[]> {
    const res = await http<{ courseIds: string[] }>('/me/courses')
    return res.courseIds ?? []
  },
}
