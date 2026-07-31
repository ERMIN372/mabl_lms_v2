import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight } from './ui/Icon'
import { cn, displayTitle } from '@/lib/utils'
import { createScormRuntime } from '@/lib/scormRuntime'
import type { CmiData, ScormStatus } from '@/lib/scormRuntime'

/**
 * Плеер SCORM-пакетов. Контент запускается в iframe, а на родительском окне
 * поднимается SCORM-runtime обеих версий стандарта (`window.API` для SCORM 1.2 и
 * `window.API_1484_11` для SCORM 2004) — пакет находит нужный, поднимаясь по
 * родительским фреймам. Модель данных и расчёт прогресса — в src/lib/scormRuntime.ts.
 *
 * Плеер ничего не хранит: состояние прошлого сеанса приходит в `state`, а новое
 * отдаётся наверх через `onStatus`/`onCommit`. Сохранением занимается
 * ProgressContext — локально и на сервере, персонально для слушателя.
 */

export type { CmiData, ScormStatus } from '@/lib/scormRuntime'

interface ScormPlayerProps {
  /** URL точки входа SCORM (res/index.html). */
  src: string
  title: string
  /** Идентификатор слушателя для cmi.core.student_id. */
  studentId?: string
  /** Имя слушателя для cmi.core.student_name. */
  studentName?: string
  /**
   * Сохранённое состояние `cmi.*` прошлого сеанса. Читается один раз при
   * запуске пакета, поэтому передавать его нужно уже загруженным.
   */
  state?: CmiData | null
  /** Прогресс или статус изменились по ходу прохождения. */
  onStatus?: (status: ScormStatus) => void
  /** Пакет попросил сохранить состояние — вместе со снимком модели данных. */
  onCommit?: (status: ScormStatus, data: CmiData) => void
}

export function ScormPlayer({
  src,
  title,
  studentId = 'guest',
  studentName = 'Слушатель',
  state,
  onStatus,
  onCommit,
}: ScormPlayerProps) {
  // Пакет, для точки входа которого уже поднят runtime. Iframe рендерим только
  // после этого: иначе пакет не найдёт window.API и стартует без связи с LMS.
  const [readySrc, setReadySrc] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const stateRef = useRef(state)
  stateRef.current = state
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    const runtime = createScormRuntime({
      studentId,
      studentName,
      initial: stateRef.current,
      onChange: (status) => onStatusRef.current?.(status),
      onCommit: (status, data) => onCommitRef.current?.(status, data),
    })
    window.API = runtime.api12
    window.API_1484_11 = runtime.api2004
    setReadySrc(src)

    return () => {
      if (window.API === runtime.api12) delete window.API
      if (window.API_1484_11 === runtime.api2004) delete window.API_1484_11
      // Пакет мог не успеть вызвать Commit перед закрытием вкладки или уходом
      // со страницы — сохраняем то, что он успел записать.
      onCommitRef.current?.(runtime.getStatus(), runtime.getData())
    }
  }, [src, studentId, studentName])

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
        {readySrc === src && (
          <iframe
            key={src}
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
