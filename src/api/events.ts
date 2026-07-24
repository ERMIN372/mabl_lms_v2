import type { CalendarEvent } from '@/types'
import { http } from './config'

/**
 * Ресурс «События» (вебинары, мероприятия, дедлайны). Источник истины для
 * календаря, главной и админ-панели. Данные хранятся в БД.
 */
export const eventsApi = {
  async list(): Promise<CalendarEvent[]> {
    return http<CalendarEvent[]>('/events')
  },

  async get(id: string): Promise<CalendarEvent | undefined> {
    return http<CalendarEvent>(`/events/${id}`)
  },

  /** Ближайший вебинар для главной страницы (может отсутствовать). */
  async next(): Promise<CalendarEvent | undefined> {
    return http<CalendarEvent | undefined>('/events/next')
  },

  async create(event: CalendarEvent): Promise<CalendarEvent> {
    return http<CalendarEvent>('/events', { method: 'POST', body: JSON.stringify(event) })
  },

  async update(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
    return http<CalendarEvent>(`/events/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/events/${id}`, { method: 'DELETE' })
  },

  async reset(): Promise<CalendarEvent[]> {
    return http<CalendarEvent[]>('/events/reset', { method: 'POST' })
  },
}
