import type { LessonProgress } from '@/types'
import { http } from './config'

/** Что клиент отправляет на сервер при сохранении прогресса урока. */
export interface LessonProgressInput {
  courseId: string
  lessonId: string
  /** Прогресс прохождения урока, 0–100. */
  progress: number
  completed: boolean
  status?: string
  score?: number
  /** Снимок модели данных SCORM. Не передан — сохранённый на сервере остаётся. */
  cmi?: Record<string, string>
}

/**
 * Ресурс «Прогресс прохождения».
 *
 * Прогресс персональный: сервер берёт слушателя из токена сессии, поэтому
 * методы работают только для авторизованного пользователя.
 */
export const progressApi = {
  /** Весь прогресс текущего слушателя. */
  async mine(): Promise<LessonProgress[]> {
    const res = await http<{ items: LessonProgress[] }>('/me/progress')
    return res.items ?? []
  },

  /**
   * Сохранить прогресс урока. `keepalive` нужен при уходе со страницы: без него
   * браузер обрывает запрос вместе с выгрузкой документа.
   */
  async save(entry: LessonProgressInput, keepalive = false): Promise<LessonProgress> {
    return http<LessonProgress>('/me/progress', {
      method: 'PUT',
      body: JSON.stringify(entry),
      keepalive,
    })
  },
}
