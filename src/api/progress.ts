import type { LessonProgress, ScormCmi } from '@/types'
import { http } from './config'

/** Ограничение браузера на тело keepalive-запроса — 64 КБ на все сразу. */
const KEEPALIVE_LIMIT = 60 * 1024

/** Что клиент сообщает серверу после изменения состояния SCORM. */
export interface LessonProgressPatch {
  /** Полное состояние SCORM для возобновления (включая cmi.suspend_data). */
  cmi: ScormCmi
  status: string
  score?: number
  /** Доля пройденного, 0–100. */
  progress: number
  completed: boolean
}

/**
 * Ресурс «Прогресс прохождения».
 *
 * Прогресс персональный: сервер всегда берёт слушателя из токена сессии, так
 * что чужую запись ни прочитать, ни перезаписать нельзя. Хранится он отдельно
 * от каталога программ — в самом курсе лежит только его структура, общая для
 * всех.
 */
export const progressApi = {
  /** Весь прогресс текущего слушателя (для каталога и кабинета). */
  async list(): Promise<LessonProgress[]> {
    return http<LessonProgress[]>('/me/progress')
  },

  /** Прогресс одного урока — из него SCORM-плеер восстанавливает состояние. */
  async get(courseId: string, lessonId: string): Promise<LessonProgress | null> {
    return http<LessonProgress | null>(
      `/me/progress/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}`,
    )
  },

  /**
   * Сохранить состояние урока. Сервер не даёт прогрессу уменьшиться.
   *
   * `keepalive` нужен для последнего сохранения при уходе со страницы: обычный
   * запрос браузер обрывает вместе с вкладкой, и прохождение, набранное после
   * предыдущего автосохранения, потерялось бы.
   */
  async save(
    courseId: string,
    lessonId: string,
    patch: LessonProgressPatch,
    options: { keepalive?: boolean } = {},
  ): Promise<LessonProgress> {
    const body = JSON.stringify(patch)
    // У keepalive-запросов браузер ограничивает тело 64 КБ. Большое состояние
    // отправляем обычным запросом: он может не успеть при закрытии вкладки, но
    // это лучше, чем гарантированная ошибка.
    const keepalive = Boolean(options.keepalive) && body.length <= KEEPALIVE_LIMIT
    return http<LessonProgress>(
      `/me/progress/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}`,
      { method: 'PUT', body, keepalive },
    )
  },
}
