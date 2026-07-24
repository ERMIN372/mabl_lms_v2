import type { ForumSection, ForumTopic } from '@/types'
import { http } from './config'

/**
 * Ресурс «Форум»: разделы и темы. Источник истины для публичного раздела и
 * админ-панели. Данные хранятся в БД.
 */
export const forumApi = {
  async listSections(): Promise<ForumSection[]> {
    return http<ForumSection[]>('/forum/sections')
  },

  async listTopics(): Promise<ForumTopic[]> {
    return http<ForumTopic[]>('/forum/topics')
  },

  async getTopic(id: string): Promise<ForumTopic | undefined> {
    return http<ForumTopic>(`/forum/topics/${id}`)
  },

  async getSection(id: string): Promise<ForumSection | undefined> {
    return http<ForumSection>(`/forum/sections/${id}`)
  },

  // ---------- Разделы (CRUD) ----------
  async createSection(section: ForumSection): Promise<ForumSection> {
    return http<ForumSection>('/forum/sections', { method: 'POST', body: JSON.stringify(section) })
  },

  async updateSection(id: string, patch: Partial<ForumSection>): Promise<ForumSection> {
    return http<ForumSection>(`/forum/sections/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async removeSection(id: string): Promise<void> {
    return http<void>(`/forum/sections/${id}`, { method: 'DELETE' })
  },

  // ---------- Темы (CRUD) ----------
  async createTopic(topic: ForumTopic): Promise<ForumTopic> {
    return http<ForumTopic>('/forum/topics', { method: 'POST', body: JSON.stringify(topic) })
  },

  async updateTopic(id: string, patch: Partial<ForumTopic>): Promise<ForumTopic> {
    return http<ForumTopic>(`/forum/topics/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async removeTopic(id: string): Promise<void> {
    return http<void>(`/forum/topics/${id}`, { method: 'DELETE' })
  },

  /** Сброс форума к исходным данным (сидам). */
  async reset(): Promise<void> {
    await http('/forum/reset', { method: 'POST' })
  },
}
