import type { NewsItem, NewsComment, NewsReactions } from '@/types'
import { http } from './config'

/**
 * Ресурс «Новости». Источник истины для публичного раздела и админ-панели.
 * Данные хранятся в БД; раздел также пополняется импортом из Telegram-канала.
 */
export const newsApi = {
  async list(): Promise<NewsItem[]> {
    return http<NewsItem[]>('/news')
  },

  async get(id: string): Promise<NewsItem | undefined> {
    return http<NewsItem>(`/news/${id}`)
  },

  async create(item: NewsItem): Promise<NewsItem> {
    return http<NewsItem>('/news', { method: 'POST', body: JSON.stringify(item) })
  },

  async update(id: string, patch: Partial<NewsItem>): Promise<NewsItem> {
    return http<NewsItem>(`/news/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/news/${id}`, { method: 'DELETE' })
  },

  /** Сброс к исходным данным (сидам). */
  async reset(): Promise<NewsItem[]> {
    return http<NewsItem[]>('/news/reset', { method: 'POST' })
  },

  /** Импорт новостей из Telegram-канала. */
  async sync(): Promise<{ ok: boolean; channel: string; synced: number }> {
    return http('/news/sync', { method: 'POST' })
  },

  // ---------- Комментарии ----------
  async listComments(newsId: string): Promise<NewsComment[]> {
    return http<NewsComment[]>(`/news/${newsId}/comments`)
  },

  async addComment(
    newsId: string,
    input: { author: string; body: string; userId?: string },
  ): Promise<NewsComment> {
    return http<NewsComment>(`/news/${newsId}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async removeComment(newsId: string, commentId: string, userId?: string): Promise<void> {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : ''
    await http<void>(`/news/${newsId}/comments/${commentId}${q}`, { method: 'DELETE' })
  },

  // ---------- Реакции ----------
  async getReactions(newsId: string, userId?: string): Promise<NewsReactions> {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : ''
    return http<NewsReactions>(`/news/${newsId}/reactions${q}`)
  },

  async toggleReaction(newsId: string, emoji: string, userId: string): Promise<NewsReactions> {
    return http<NewsReactions>(`/news/${newsId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji, userId }),
    })
  },
}
