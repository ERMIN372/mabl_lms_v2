import type { Order } from '@/types'
import { http } from './config'

/** Ресурс «Заказы» для админ-панели. Данные хранятся в БД. */
export const ordersApi = {
  async list(): Promise<Order[]> {
    return http<Order[]>('/admin/orders')
  },

  async get(id: string): Promise<Order | undefined> {
    return http<Order>(`/admin/orders/${id}`)
  },

  async create(order: Order): Promise<Order> {
    return http<Order>('/admin/orders', { method: 'POST', body: JSON.stringify(order) })
  },

  async update(id: string, patch: Partial<Order>): Promise<Order> {
    return http<Order>(`/admin/orders/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },

  async remove(id: string): Promise<void> {
    return http<void>(`/admin/orders/${id}`, { method: 'DELETE' })
  },

  /** Сброс к исходным данным (сидам). */
  async reset(): Promise<Order[]> {
    return http<Order[]>('/admin/orders/reset', { method: 'POST' })
  },
}
