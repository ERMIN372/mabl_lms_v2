import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Course, LessonProgress } from '@/types'
import type { LessonProgressInput } from '@/api/progress'
import { api } from '@/api'
import { useAuth } from '@/context/AuthContext'

/**
 * Прогресс прохождения слушателя.
 *
 * Прогресс персональный (Course.progress — общее свойство программы, а не
 * результат конкретного человека) и живёт на сервере: тренинг, начатый на
 * работе, продолжается дома. Локальная копия в localStorage нужна для мгновенной
 * отрисовки и как запасной вариант, когда сервер недоступен или слушатель не
 * вошёл в кабинет.
 *
 * Запись на сервер объединяется по уроку и уходит с задержкой: SCORM-пакет
 * сообщает об изменениях часто, а держать по запросу на каждое движение
 * прогресса незачем. Важные моменты (пакет попросил сохраниться, уход со
 * страницы) отправляются сразу.
 */

const STORAGE_PREFIX = 'mabl.progress'

/** Задержка перед отправкой накопленных изменений на сервер. */
const SYNC_DELAY_MS = 4000

type ProgressMap = Record<string, LessonProgress>

function storageKey(userId: string | undefined): string {
  return `${STORAGE_PREFIX}.${userId ?? 'guest'}`
}

function entryKey(courseId: string, lessonId: string): string {
  return `${courseId}::${lessonId}`
}

function loadLocal(key: string): ProgressMap {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as ProgressMap) : {}
  } catch {
    return {}
  }
}

function saveLocal(key: string, map: ProgressMap): void {
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    /* приватный режим или переполнение — прогресс останется только на сервере */
  }
}

/**
 * Слить две записи об одном уроке. Прогресс и признак прохождения только
 * растут, снимок SCORM берётся у более полной записи: так параллельная вкладка
 * или устаревший локальный кэш не откатывают результат.
 */
function mergeEntries(a: LessonProgress | undefined, b: LessonProgress): LessonProgress {
  if (!a) return b
  const leading = b.progress >= a.progress ? b : a
  return {
    ...leading,
    progress: Math.max(a.progress, b.progress),
    completed: a.completed || b.completed,
    cmi: leading.cmi ?? a.cmi ?? b.cmi,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  }
}

interface ProgressContextValue {
  /** Идёт первичная загрузка прогресса с сервера. */
  loading: boolean
  /** Прогресс программы для текущего слушателя, 0–100. */
  courseProgress: (course: Course) => number
  /** Прогресс урока; undefined — урок ещё не начинали. */
  lessonProgress: (courseId: string, lessonId: string) => LessonProgress | undefined
  isLessonCompleted: (courseId: string, lessonId: string) => boolean
  /**
   * Сохранить прогресс урока: локально сразу, на сервере — пачкой с задержкой.
   * `immediate` отправляет накопленное немедленно.
   */
  saveLessonProgress: (entry: LessonProgressInput, immediate?: boolean) => void
}

const ProgressContext = createContext<ProgressContextValue | null>(null)

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id

  // Локальная копия привязана к пользователю: на общем компьютере следующий
  // вошедший не должен видеть чужой прогресс. Пишется в тех же местах, где
  // меняется состояние, — при сохранении урока и после ответа сервера.
  const [map, setMap] = useState<ProgressMap>(() => loadLocal(storageKey(undefined)))
  const [loading, setLoading] = useState(false)

  // Изменения, ещё не отправленные на сервер: по одной записи на урок.
  const pending = useRef<Map<string, LessonProgressInput>>(new Map())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const flush = useCallback((keepalive = false) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!userIdRef.current || pending.current.size === 0) return
    const batch = Array.from(pending.current.values())
    pending.current.clear()
    for (const entry of batch) {
      // Ошибку сети глотаем осознанно: локальная копия уже сохранена, а
      // следующее сохранение отправит прогресс заново.
      void api.progress.save(entry, keepalive).catch(() => undefined)
    }
  }, [])

  // Смена пользователя: показываем его локальную копию и подтягиваем сервер.
  useEffect(() => {
    const local = loadLocal(storageKey(userId))
    setMap(local)
    if (!userId) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    api.progress
      .mine()
      .then((items) => {
        if (!active) return
        setMap((current) => {
          const merged: ProgressMap = { ...current }
          for (const item of items) {
            const id = entryKey(item.courseId, item.lessonId)
            merged[id] = mergeEntries(merged[id], item)
          }
          saveLocal(storageKey(userId), merged)
          return merged
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId])

  // Уход со страницы — последний шанс отправить накопленное. На мобильных
  // вкладку часто не «выгружают», а скрывают, поэтому слушаем и visibilitychange.
  useEffect(() => {
    const onHide = () => flush(true)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      flush(true)
    }
  }, [flush])

  const saveLessonProgress = useCallback(
    (entry: LessonProgressInput, immediate = false) => {
      const id = entryKey(entry.courseId, entry.lessonId)
      const next: LessonProgress = {
        courseId: entry.courseId,
        lessonId: entry.lessonId,
        progress: Math.min(100, Math.max(0, Math.round(entry.progress))),
        completed: entry.completed,
        status: entry.status,
        score: entry.score,
        cmi: entry.cmi,
        updatedAt: new Date().toISOString(),
      }

      setMap((current) => {
        const merged = { ...current, [id]: mergeEntries(current[id], next) }
        saveLocal(storageKey(userIdRef.current), merged)
        return merged
      })

      if (!userIdRef.current) return
      // Копим по уроку: снимок cmi приходит редко (на сохранении пакета) и не
      // должен потеряться под частыми обновлениями одного лишь прогресса.
      const queued = pending.current.get(id)
      pending.current.set(id, {
        ...queued,
        ...entry,
        progress: Math.max(queued?.progress ?? 0, next.progress),
        completed: Boolean(queued?.completed) || next.completed,
        cmi: entry.cmi ?? queued?.cmi,
      })

      if (immediate) {
        flush()
      } else if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null
          flush()
        }, SYNC_DELAY_MS)
      }
    },
    [flush],
  )

  const value = useMemo<ProgressContextValue>(() => {
    const lessonProgress = (courseId: string, lessonId: string) => map[entryKey(courseId, lessonId)]
    return {
      loading,
      lessonProgress,
      isLessonCompleted: (courseId, lessonId) =>
        Boolean(lessonProgress(courseId, lessonId)?.completed),
      courseProgress: (course) => {
        const lessons = course.modules.flatMap((m) => m.lessons)
        if (lessons.length === 0) return 0
        const total = lessons.reduce(
          (sum, lesson) => sum + (lessonProgress(course.id, lesson.id)?.progress ?? 0),
          0,
        )
        return Math.round(total / lessons.length)
      },
      saveLessonProgress,
    }
  }, [map, loading, saveLessonProgress])

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext)
  if (!ctx) throw new Error('useProgress должен использоваться внутри ProgressProvider')
  return ctx
}
