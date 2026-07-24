/** Утилиты форматирования и склейки классов */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const months = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${d.getDate()} ${months[d.getMonth()]}, ${time}`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function formatPrice(value: number): string {
  if (value === 0) return 'Бесплатно'
  return new Intl.NumberFormat('ru-RU').format(value) + ' ₽'
}

/** true, если курс бесплатный. */
export function isFree(value: number): boolean {
  return value === 0
}

/**
 * Название для показа: подчёркивания (часто приходят из имён SCORM-пакетов)
 * заменяем на пробелы и схлопываем повторяющиеся пробелы.
 */
export function displayTitle(title: string): string {
  return title.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Длительность курса в часах → человекочитаемая строка.
 * Дробные часы показываются с минутами: 0.5 → «30 мин», 1.5 → «1 ч 30 мин».
 */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round((hours || 0) * 60)
  if (totalMinutes <= 0) return '0 ч'
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m} мин`
  if (m === 0) return `${h} ч`
  return `${h} ч ${m} мин`
}

/** Имитация задержки сети для mock-сценариев */
export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
