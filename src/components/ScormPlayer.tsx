import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight } from './ui/Icon'
import { cn, displayTitle } from '@/lib/utils'

/**
 * Плеер SCORM-пакетов (SCORM 1.2). Контент запускается в iframe, а на родительском
 * окне поднимается минимальный SCORM-runtime (`window.API`), который пакет находит
 * через `lms.js`. Прогресс/статус сохраняются в localStorage браузера и
 * пробрасываются наверх через onStatus — чтобы обновлять прогресс курса.
 *
 * Серверный трекинг прохождения (отправка cmi.* в API) ещё не подключён.
 */

type CmiData = Record<string, string>

export interface ScormStatus {
  /** cmi.core.lesson_status (completed/passed/incomplete/…). */
  status: string
  /** cmi.core.score.raw, если задан. */
  score?: number
  /** Прогресс прохождения, 0–100. */
  progress: number
  completed: boolean
}

interface Scorm12Api {
  LMSInitialize: () => string
  LMSFinish: () => string
  LMSGetValue: (key: string) => string
  LMSSetValue: (key: string, value: string) => string
  LMSCommit: () => string
  LMSGetLastError: () => string
  LMSGetErrorString: () => string
  LMSGetDiagnostic: () => string
}

declare global {
  interface Window {
    API?: Scorm12Api
  }
}

function computeStatus(data: CmiData): ScormStatus {
  const status = data['cmi.core.lesson_status'] || 'not attempted'
  const raw = parseFloat(data['cmi.core.score.raw'] ?? '')
  const hasScore = Number.isFinite(raw)
  const completed = status === 'completed' || status === 'passed'
  const progress = completed ? 100 : hasScore ? Math.min(100, Math.max(0, Math.round(raw))) : 0
  return { status, score: hasScore ? raw : undefined, progress, completed }
}

function createApi(
  storageKey: string,
  studentId: string,
  studentName: string,
  emit: (s: ScormStatus) => void,
): Scorm12Api {
  const defaults: CmiData = {
    'cmi.core.student_id': studentId,
    'cmi.core.student_name': studentName,
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.lesson_mode': 'normal',
    'cmi.core.credit': 'credit',
    'cmi.core.entry': 'ab-initio',
    'cmi.core.score.raw': '',
    'cmi.suspend_data': '',
    'cmi.launch_data': '',
  }

  let data: CmiData = { ...defaults }
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) data = { ...defaults, ...(JSON.parse(raw) as CmiData) }
  } catch {
    /* игнорируем повреждённое состояние */
  }

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch {
      /* приватный режим / переполнение — не критично */
    }
    emit(computeStatus(data))
    return 'true'
  }

  return {
    LMSInitialize: () => 'true',
    LMSFinish: persist,
    LMSGetValue: (key) => data[key] ?? '',
    LMSSetValue: (key, value) => {
      data[key] = value
      if (key === 'cmi.core.lesson_status' || key === 'cmi.core.score.raw') {
        emit(computeStatus(data))
      }
      return 'true'
    },
    LMSCommit: persist,
    LMSGetLastError: () => '0',
    LMSGetErrorString: () => 'No error',
    LMSGetDiagnostic: () => '',
  }
}

interface ScormPlayerProps {
  /** URL точки входа SCORM (res/index.html). */
  src: string
  title: string
  /** Идентификатор слушателя для cmi.core.student_id. */
  studentId?: string
  /** Имя слушателя для cmi.core.student_name. */
  studentName?: string
  /**
   * Ключ для сохранения прогресса. Должен включать идентификатор слушателя:
   * на общем компьютере иначе следующий вошедший увидит чужой прогресс.
   */
  storageKey: string
  /** Колбэк при изменении статуса/прогресса SCORM. */
  onStatus?: (status: ScormStatus) => void
}

export function ScormPlayer({
  src,
  title,
  studentId = 'guest',
  studentName = 'Слушатель',
  storageKey,
  onStatus,
}: ScormPlayerProps) {
  const [ready, setReady] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    const api = createApi(storageKey, studentId, studentName, (s) => onStatusRef.current?.(s))
    window.API = api
    setReady(true)
    return () => {
      if (window.API === api) delete window.API
    }
  }, [storageKey, studentId, studentName])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wrapRef.current?.requestFullscreen()
  }

  return (
    <div
      ref={wrapRef}
      className={cn(
        'overflow-hidden border border-ink-10 bg-neft',
        isFullscreen ? 'flex h-full w-full flex-col' : 'rounded-card',
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-wisdom/10 px-4 py-2.5">
        <span className="truncate text-[0.72rem] uppercase tracking-wide text-wisdom/60">
          {displayTitle(title)}
        </span>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 text-[0.72rem] uppercase tracking-wide text-wisdom/70 hover:text-wisdom"
          >
            {isFullscreen ? 'Свернуть' : 'На весь экран'}
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[0.72rem] uppercase tracking-wide text-wisdom/70 hover:text-wisdom"
          >
            Открыть в новой вкладке <ArrowUpRight width={14} height={14} />
          </a>
        </div>
      </div>
      <div className={cn('relative w-full bg-[#444c54]', isFullscreen ? 'flex-1' : 'aspect-video')}>
        {ready && (
          <iframe
            src={src}
            title={title}
            className="absolute inset-0 h-full w-full"
            allow="fullscreen; autoplay"
            allowFullScreen
          />
        )}
      </div>
    </div>
  )
}
