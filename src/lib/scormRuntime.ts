/**
 * Runtime SCORM для плеера: модель данных обеих версий стандарта — SCORM 1.2
 * (`window.API`) и SCORM 2004 (`window.API_1484_11`) — и приведение их значений
 * к единому прогрессу 0–100.
 *
 * Зачем обе версии. У пакета есть собственная шкала прохождения (в iSpring Page
 * это доля пройденных секций — та самая цифра в его боковой панели). Передать её
 * в LMS пакет может только через `cmi.progress_measure`, а это поле существует
 * лишь в SCORM 2004: в режиме 1.2 коннектор молча выбрасывает значение. Поэтому
 * LMS поднимает обе версии API, а пакеты iSpring Page переключаются на 2004
 * (api/_scormPatch.mjs). Пакеты, оставшиеся на 1.2, продолжают работать как
 * раньше — их прогресс берётся из балла и статуса.
 *
 * Сохранение состояния — забота вызывающей стороны: runtime только сообщает об
 * изменениях (onChange) и о просьбе пакета сохраниться (onCommit).
 */

/** Снимок модели данных SCORM: `cmi.*` → значение. */
export type CmiData = Record<string, string>

export interface ScormStatus {
  /** Статус прохождения: completed / passed / failed / incomplete / not attempted. */
  status: string
  /** Балл, приведённый к шкале 0–100 (если пакет его сообщил). */
  score?: number
  /** Прогресс прохождения, 0–100. */
  progress: number
  completed: boolean
}

export interface Scorm12Api {
  LMSInitialize: (arg: string) => string
  LMSFinish: (arg: string) => string
  LMSGetValue: (key: string) => string
  LMSSetValue: (key: string, value: string) => string
  LMSCommit: (arg: string) => string
  LMSGetLastError: () => string
  LMSGetErrorString: (code: string) => string
  LMSGetDiagnostic: (code: string) => string
}

export interface Scorm2004Api {
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

const TRUE = 'true'
const NO_ERROR = '0'

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Процент прохождения из доли 0–1. Дробную часть отбрасываем, а не округляем:
 * пакет в своей боковой панели показывает именно так (0.0368… → «3%»), и число
 * на странице программы должно совпадать с числом внутри тренинга.
 */
function measureToPercent(measure: number): number {
  return Math.min(100, Math.max(0, Math.floor(measure * 100)))
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Статус прохождения из обеих моделей: SCORM 1.2 хранит его одним полем
 * `cmi.core.lesson_status`, SCORM 2004 — двумя (`cmi.completion_status` —
 * пройден ли материал, `cmi.success_status` — сдан ли зачёт).
 */
export function readStatus(data: CmiData): string {
  const success = data['cmi.success_status']
  if (success === 'passed' || success === 'failed') return success

  const completion = data['cmi.completion_status']
  if (completion === 'completed') return completion

  const lesson = data['cmi.core.lesson_status']
  if (lesson && lesson !== 'not attempted') return lesson

  if (completion === 'incomplete') return completion
  return lesson || 'not attempted'
}

/** Балл, приведённый к 0–100 (в SCORM 2004 он может быть уже нормализован). */
export function readScore(data: CmiData): number | undefined {
  const scaled = num(data['cmi.score.scaled'])
  if (scaled !== undefined) return clampPercent(scaled * 100)

  const raw = num(data['cmi.core.score.raw']) ?? num(data['cmi.score.raw'])
  if (raw === undefined) return undefined

  const min = num(data['cmi.core.score.min']) ?? num(data['cmi.score.min']) ?? 0
  const max = num(data['cmi.core.score.max']) ?? num(data['cmi.score.max']) ?? 100
  return max > min ? clampPercent(((raw - min) / (max - min)) * 100) : clampPercent(raw)
}

/**
 * Прогресс из того, что сообщил пакет. Порядок источников — от точного к
 * приблизительному:
 * 1. пройденный урок — всегда 100%;
 * 2. `cmi.progress_measure` (SCORM 2004) — собственная шкала пакета, ровно та,
 *    что видна в его боковой панели;
 * 3. балл — у презентаций iSpring Suite (SCORM 1.2) он растёт по мере просмотра
 *    слайдов и служит единственной оценкой прохождения.
 */
export function computeStatus(data: CmiData): ScormStatus {
  const status = readStatus(data)
  const completed = status === 'completed' || status === 'passed'
  const score = readScore(data)
  const measure = num(data['cmi.progress_measure'])

  let progress = 0
  if (completed) progress = 100
  else if (measure !== undefined) progress = measureToPercent(measure)
  else if (score !== undefined) progress = score

  return { status, score, progress, completed }
}

/**
 * Значения модели данных по умолчанию — обе версии сразу: ключи SCORM 1.2
 * (`cmi.core.*`) и SCORM 2004 (`cmi.*`) не пересекаются, поэтому живут в одном
 * снимке, и пакету неважно, какую версию API он выбрал.
 */
function defaults(studentId: string, studentName: string, resume: boolean): CmiData {
  const entry = resume ? 'resume' : 'ab-initio'
  return {
    // SCORM 1.2
    'cmi.core.student_id': studentId,
    'cmi.core.student_name': studentName,
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.lesson_mode': 'normal',
    'cmi.core.credit': 'credit',
    'cmi.core.entry': entry,
    'cmi.core.score.raw': '',
    'cmi.core.total_time': '0000:00:00',
    'cmi.launch_data': '',
    // SCORM 2004
    'cmi._version': '1.0',
    'cmi.learner_id': studentId,
    'cmi.learner_name': studentName,
    'cmi.completion_status': 'unknown',
    'cmi.success_status': 'unknown',
    'cmi.mode': 'normal',
    'cmi.credit': 'credit',
    'cmi.entry': entry,
    'cmi.total_time': 'PT0H0M0S',
    // Общее для обеих версий
    'cmi.suspend_data': '',
    'cmi.interactions._count': '0',
  }
}

/** Ключи, изменение которых меняет прогресс — только они дёргают onChange. */
const STATUS_KEYS = new Set([
  'cmi.core.lesson_status',
  'cmi.completion_status',
  'cmi.success_status',
  'cmi.core.score.raw',
  'cmi.score.raw',
  'cmi.score.scaled',
  'cmi.progress_measure',
])

export interface ScormRuntimeOptions {
  /** Идентификатор слушателя (cmi.core.student_id / cmi.learner_id). */
  studentId: string
  /** Имя слушателя (cmi.core.student_name / cmi.learner_name). */
  studentName: string
  /** Состояние прошлого сеанса — с ним пакет продолжит с места остановки. */
  initial?: CmiData | null
  /** Прогресс или статус изменились. */
  onChange?: (status: ScormStatus, data: CmiData) => void
  /** Пакет попросил сохранить состояние (LMSCommit / LMSFinish / Terminate). */
  onCommit?: (status: ScormStatus, data: CmiData) => void
}

export interface ScormRuntime {
  /** Реализация SCORM 1.2 — её пакет ищет как `window.API`. */
  api12: Scorm12Api
  /** Реализация SCORM 2004 — её пакет ищет как `window.API_1484_11`. */
  api2004: Scorm2004Api
  /** Текущий снимок модели данных. */
  getData: () => CmiData
  /** Текущий прогресс и статус. */
  getStatus: () => ScormStatus
}

export function createScormRuntime({
  studentId,
  studentName,
  initial,
  onChange,
  onCommit,
}: ScormRuntimeOptions): ScormRuntime {
  const saved = initial && typeof initial === 'object' ? initial : null
  const resume = Boolean(saved?.['cmi.suspend_data'])

  // Сохранённое состояние важнее значений по умолчанию, но данные слушателя
  // всегда берём от текущей сессии: пакет могли проходить под другим входом.
  const data: CmiData = {
    ...defaults(studentId, studentName, resume),
    ...saved,
    'cmi.core.student_id': studentId,
    'cmi.core.student_name': studentName,
    'cmi.learner_id': studentId,
    'cmi.learner_name': studentName,
    'cmi.core.entry': resume ? 'resume' : 'ab-initio',
    'cmi.entry': resume ? 'resume' : 'ab-initio',
  }

  const snapshot = (): CmiData => ({ ...data })
  const status = (): ScormStatus => computeStatus(data)

  /**
   * Число попыток взаимодействия — read-only поле, которое ведёт LMS. Пакеты
   * пишут `cmi.interactions.N.*` и ждут, что `_count` посчитаем мы.
   */
  const bumpInteractions = (key: string) => {
    const match = /^cmi\.interactions\.(\d+)\./.exec(key)
    if (!match) return
    const next = Number(match[1]) + 1
    const current = Number(data['cmi.interactions._count'] ?? '0')
    if (!Number.isFinite(current) || next > current) {
      data['cmi.interactions._count'] = String(next)
    }
  }

  const setValue = (key: string, value: string): string => {
    data[key] = value
    bumpInteractions(key)
    if (STATUS_KEYS.has(key)) onChange?.(status(), snapshot())
    return TRUE
  }

  const getValue = (key: string): string => data[key] ?? ''

  const commit = (): string => {
    onCommit?.(status(), snapshot())
    return TRUE
  }

  const api12: Scorm12Api = {
    LMSInitialize: () => TRUE,
    LMSFinish: commit,
    LMSGetValue: getValue,
    LMSSetValue: setValue,
    LMSCommit: commit,
    LMSGetLastError: () => NO_ERROR,
    LMSGetErrorString: () => 'No error',
    LMSGetDiagnostic: () => '',
  }

  const api2004: Scorm2004Api = {
    Initialize: () => TRUE,
    Terminate: commit,
    GetValue: getValue,
    SetValue: setValue,
    Commit: commit,
    GetLastError: () => NO_ERROR,
    GetErrorString: () => 'No error',
    GetDiagnostic: () => '',
  }

  return { api12, api2004, getData: snapshot, getStatus: status }
}
