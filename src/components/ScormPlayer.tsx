import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight } from './ui/Icon'
import { cn, displayTitle } from '@/lib/utils'
import type { ScormCmi } from '@/types'

/**
 * Плеер SCORM-пакетов. Контент запускается в iframe, а на родительском окне
 * поднимается SCORM-runtime, который пакет находит, поднимаясь по родительским
 * фреймам: `window.API` (SCORM 1.2) и `window.API_1484_11` (SCORM 2004). Пакет
 * сам выбирает нужный по своей конфигурации, поэтому поддерживаем оба.
 *
 * Зачем 2004: в модели данных SCORM 1.2 нет поля с долей пройденного, и пакет
 * сообщает LMS только «не начат / завершён». Из-за этого прогресс на сайте
 * стоял на нуле, пока пакет показывал у себя внутри, например, 41%. В SCORM
 * 2004 приходит cmi.progress_measure — ровно та доля, что видна в панели
 * пакета. Пакеты iSpring переводятся в режим 2004 при раздаче (см.
 * patchScormLaunchHtml в api/router.ts и scripts/normalize-scorm.mjs).
 *
 * Состояние прохождения (cmi.*, включая cmi.suspend_data) хранится на сервере —
 * его передаёт `initialCmi` и забирает `onPersist`. localStorage остаётся
 * запасным хранилищем на случай, если сервер недоступен.
 */

type CmiData = ScormCmi

export interface ScormStatus {
  /** cmi.core.lesson_status (1.2) или cmi.completion_status/success_status (2004). */
  status: string
  /** Баллы, если пакет их выставляет. */
  score?: number
  /** Прогресс прохождения, 0–100. */
  progress: number
  completed: boolean
}

interface Scorm12Api {
  LMSInitialize: (arg: string) => string
  LMSFinish: (arg: string) => string
  LMSGetValue: (key: string) => string
  LMSSetValue: (key: string, value: string) => string
  LMSCommit: (arg: string) => string
  LMSGetLastError: () => string
  LMSGetErrorString: (code: string) => string
  LMSGetDiagnostic: (code: string) => string
}

interface Scorm2004Api {
  Initialize: (arg: string) => string
  Terminate: (arg: string) => string
  GetValue: (key: string) => string
  SetValue: (key: string, value: string) => string
  Commit: (arg: string) => string
  GetLastError: () => string
  GetErrorString: (code: string) => string
  GetDiagnostic: (code: string) => string
}

declare global {
  interface Window {
    API?: Scorm12Api
    API_1484_11?: Scorm2004Api
  }
}

/** Ключи, изменение которых означает, что состояние пора сохранить. */
const TRACKED_KEYS = [
  'cmi.core.lesson_status',
  'cmi.core.score.raw',
  'cmi.completion_status',
  'cmi.success_status',
  'cmi.progress_measure',
  'cmi.score.raw',
  'cmi.score.scaled',
  'cmi.suspend_data',
]

/** Задержка автосохранения: пакет пишет состояние пачками при каждом переходе. */
const AUTOSAVE_MS = 1500

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Свести модель данных SCORM (1.2 и 2004 одновременно) к статусу и проценту.
 *
 * Порядок источников прогресса: сначала cmi.progress_measure (доля, которую
 * считает сам пакет), затем факт завершения, затем баллы — они бывают только у
 * пакетов с тестом и в процентах лишь тогда, когда максимум равен 100.
 */
export function computeStatus(data: CmiData): ScormStatus {
  const lessonStatus = data['cmi.core.lesson_status'] ?? ''
  const completion = data['cmi.completion_status'] ?? ''
  const success = data['cmi.success_status'] ?? ''

  const completed =
    lessonStatus === 'completed' ||
    lessonStatus === 'passed' ||
    completion === 'completed' ||
    success === 'passed'

  const status =
    lessonStatus ||
    (success && success !== 'unknown' ? success : '') ||
    (completion && completion !== 'unknown' ? completion : '') ||
    'not attempted'

  const score = num(data['cmi.core.score.raw']) ?? num(data['cmi.score.raw'])
  const measure = num(data['cmi.progress_measure'])
  const scoreMax = num(data['cmi.core.score.max']) ?? num(data['cmi.score.max'])

  let progress = 0
  if (measure !== undefined) progress = clampPercent(measure * 100)
  else if (score !== undefined && (scoreMax === undefined || scoreMax === 100)) progress = clampPercent(score)
  if (completed) progress = 100

  return { status, score, progress, completed }
}

function readLocal(storageKey: string): CmiData {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as CmiData) : {}
  } catch {
    return {}
  }
}

/**
 * SCORM-runtime поверх одного снимка модели данных.
 *
 * Значения читаются и пишутся плоским словарём `cmi.* → строка`, поэтому один и
 * тот же снимок обслуживает и SCORM 1.2, и SCORM 2004: имена ключей у них
 * разные, конфликтовать нечему.
 */
function createRuntime(
  initial: CmiData,
  studentId: string,
  studentName: string,
  onChange: (data: CmiData, status: ScormStatus, immediate: boolean) => void,
) {
  const resumed = Boolean(initial['cmi.suspend_data'])
  const data: CmiData = {
    // Профиль слушателя — в именах обеих версий стандарта.
    'cmi.core.student_id': studentId,
    'cmi.core.student_name': studentName,
    'cmi.learner_id': studentId,
    'cmi.learner_name': studentName,
    'cmi.core.credit': 'credit',
    'cmi.credit': 'credit',
    'cmi.core.lesson_status': 'not attempted',
    'cmi.completion_status': 'unknown',
    'cmi.success_status': 'unknown',
    'cmi.launch_data': '',
    'cmi.suspend_data': '',
    ...initial,
    // Режим всегда обычный: в browse/review пакет не засчитывает прохождение.
    'cmi.core.lesson_mode': 'normal',
    'cmi.mode': 'normal',
    // Ключевое для продолжения: пакету нужно сказать, что попытка не первая.
    // Без этого многие пакеты игнорируют сохранённый cmi.suspend_data и
    // начинают курс с нуля.
    'cmi.core.entry': resumed ? 'resume' : 'ab-initio',
    'cmi.entry': resumed ? 'resume' : 'ab-initio',
    // exit и время относятся к конкретной сессии, а не к прохождению целиком.
    'cmi.core.exit': '',
    'cmi.exit': '',
    'cmi.core.session_time': '',
    'cmi.session_time': '',
  }

  const snapshot = (): CmiData => ({ ...data })

  const setValue = (key: string, value: string): string => {
    data[key] = String(value ?? '')
    if (TRACKED_KEYS.includes(key)) onChange(snapshot(), computeStatus(data), false)
    return 'true'
  }

  const commit = (): string => {
    onChange(snapshot(), computeStatus(data), true)
    return 'true'
  }

  const api12: Scorm12Api = {
    LMSInitialize: () => 'true',
    LMSFinish: commit,
    LMSGetValue: (key) => data[key] ?? '',
    LMSSetValue: setValue,
    LMSCommit: commit,
    LMSGetLastError: () => '0',
    LMSGetErrorString: () => 'No error',
    LMSGetDiagnostic: () => '',
  }

  const api2004: Scorm2004Api = {
    Initialize: () => 'true',
    Terminate: commit,
    GetValue: (key) => data[key] ?? '',
    SetValue: setValue,
    Commit: commit,
    GetLastError: () => '0',
    GetErrorString: () => 'No error',
    GetDiagnostic: () => '',
  }

  return { api12, api2004, flush: commit }
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
   * Сохранённое состояние SCORM с сервера. `undefined` — ещё загружается: до
   * этого момента пакет не запускаем, иначе он стартует с чистого листа и
   * затрёт сохранённое прохождение своим пустым состоянием.
   */
  initialCmi?: CmiData
  /**
   * Запасной ключ localStorage. Включает идентификатор слушателя: на общем
   * компьютере иначе следующий вошедший увидит чужой прогресс.
   */
  storageKey: string
  /**
   * Сохранить состояние: вызывается при commit/finish и с задержкой при записи.
   * `final` — последнее сохранение перед уходом со страницы.
   */
  onPersist?: (cmi: CmiData, status: ScormStatus, options: { final: boolean }) => void
  /** Колбэк при изменении статуса/прогресса SCORM. */
  onStatus?: (status: ScormStatus) => void
}

export function ScormPlayer({
  src,
  title,
  studentId = 'guest',
  studentName = 'Слушатель',
  initialCmi,
  storageKey,
  onPersist,
  onStatus,
}: ScormPlayerProps) {
  const [ready, setReady] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const onStatusRef = useRef(onStatus)
  const onPersistRef = useRef(onPersist)
  onStatusRef.current = onStatus
  onPersistRef.current = onPersist

  // Состояние загружено? До этого iframe не монтируем.
  const loaded = initialCmi !== undefined
  // Снимок берём один раз на запуск пакета: последующие обновления с сервера
  // не должны перезапускать уже открытый курс.
  const initialRef = useRef<CmiData>()
  if (loaded && !initialRef.current) {
    initialRef.current =
      Object.keys(initialCmi).length > 0 ? initialCmi : readLocal(storageKey)
  }
  const initial = initialRef.current

  useEffect(() => {
    if (!initial) return

    let pending: { cmi: CmiData; status: ScormStatus } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const persist = (cmi: CmiData, status: ScormStatus, final: boolean) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(cmi))
      } catch {
        /* приватный режим / переполнение — не критично */
      }
      onPersistRef.current?.(cmi, status, { final })
    }

    const flushPending = (final = false) => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (!pending) return
      const { cmi, status } = pending
      pending = null
      persist(cmi, status, final)
    }

    // Уход со страницы: сохраняем немедленно и запросом, переживающим закрытие
    // вкладки, — иначе теряется всё, что набрано после автосохранения.
    const flushFinal = () => flushPending(true)

    const runtime = createRuntime(initial, studentId, studentName, (cmi, status, immediate) => {
      onStatusRef.current?.(status)
      if (immediate) {
        pending = { cmi, status }
        flushPending()
        return
      }
      // Пакет пишет состояние пачками (несколько cmi.* подряд на один переход),
      // поэтому отправку откладываем и склеиваем в один запрос.
      pending = { cmi, status }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flushPending, AUTOSAVE_MS)
    })

    window.API = runtime.api12
    window.API_1484_11 = runtime.api2004
    setReady(true)

    // Уход со страницы (в том числе закрытие вкладки на мобильных) — последний
    // момент, когда состояние ещё можно сохранить.
    window.addEventListener('pagehide', flushFinal)
    return () => {
      window.removeEventListener('pagehide', flushFinal)
      flushFinal()
      if (window.API === runtime.api12) delete window.API
      if (window.API_1484_11 === runtime.api2004) delete window.API_1484_11
      setReady(false)
    }
  }, [initial, storageKey, studentId, studentName])

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
          {/*
            Отдельная вкладка тоже должна засчитывать прохождение: пакет ищет
            SCORM-runtime и в window.opener, поэтому связь с этой страницей не
            рвём. Только для своего домена — на внешнюю ссылку (её может задать
            администратор в настройках урока) оставляем noopener.
          */}
          <a
            href={src}
            target="_blank"
            rel={src.startsWith('/') ? 'opener' : 'noopener noreferrer'}
            className="inline-flex items-center gap-1.5 text-[0.72rem] uppercase tracking-wide text-wisdom/70 hover:text-wisdom"
          >
            Открыть в новой вкладке <ArrowUpRight width={14} height={14} />
          </a>
        </div>
      </div>
      <div className={cn('relative w-full bg-[#444c54]', isFullscreen ? 'flex-1' : 'aspect-video')}>
        {ready ? (
          <iframe
            src={src}
            title={title}
            className="absolute inset-0 h-full w-full"
            allow="fullscreen; autoplay"
            allowFullScreen
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[0.78rem] uppercase tracking-wide text-wisdom/50">
            Загружаем прогресс…
          </div>
        )}
      </div>
    </div>
  )
}
