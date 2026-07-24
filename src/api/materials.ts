import type { Material } from '@/types'
import { http } from './config'

/** Ресурс «Учебные материалы». Данные хранятся в БД. */
export const materialsApi = {
  async list(): Promise<Material[]> {
    return http<Material[]>('/materials')
  },
  async get(id: string): Promise<Material | undefined> {
    return http<Material>(`/materials/${id}`)
  },
  async create(material: Material): Promise<Material> {
    return http<Material>('/materials', { method: 'POST', body: JSON.stringify(material) })
  },
  async update(id: string, patch: Partial<Material>): Promise<Material> {
    return http<Material>(`/materials/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
  },
  async remove(id: string): Promise<void> {
    return http<void>(`/materials/${id}`, { method: 'DELETE' })
  },
}
