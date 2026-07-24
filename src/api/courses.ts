import type { Course } from '@/types'
import { http } from './config'

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
    return http<Course[]>('/courses')
  },

  async get(id: string): Promise<Course | undefined> {
    return http<Course>(`/courses/${id}`)
  },

  async create(course: Course): Promise<Course> {
    return http<Course>('/courses', { method: 'POST', body: JSON.stringify(course) })
  },

  async update(id: string, patch: Partial<Course>): Promise<Course> {
    return http<Course>(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/courses/${id}`, { method: 'DELETE' })
  },

  /** Сброс каталога к исходным данным (сидам). */
  async reset(): Promise<Course[]> {
    return http<Course[]>('/courses/reset', { method: 'POST' })
  },
}
