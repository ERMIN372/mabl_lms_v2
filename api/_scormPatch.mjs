/**
 * Переключение пакетов iSpring Page на модель данных SCORM 2004.
 *
 * Зачем. Такие пакеты экспортируются в режиме SCORM 1.2, и в нём их коннектор
 * сообщает LMS только статус (`cmi.core.lesson_status`) и балл: метод передачи
 * доли пройденного в SCORM-1.2-ветке пустой (`setProgress(r){}`), потому что
 * поля `cmi.progress_measure` в SCORM 1.2 просто нет. Из-за этого прогресс,
 * который пакет рисует в собственной боковой панели (21%, 47%, …), в LMS не
 * попадал никогда — программа висела на 0% до полного прохождения.
 *
 * Тот же коннектор в режиме SCORM 2004 отдаёт ровно ту же величину
 * (`setProgress(r){this.setValue("cmi.progress_measure",r)}`), поэтому в точке
 * входа пакета мы меняем режим на scorm2004. Редакция — четвёртая: в ней лимит
 * `cmi.suspend_data` 64 000 символов против 4 000 во второй, а данные сверх
 * лимита коннектор молча выбрасывает, и пакет терял бы место остановки.
 *
 * Обе версии API поднимает наш плеер (см. src/lib/scormRuntime.ts), так что
 * непереключённые пакеты продолжают работать по SCORM 1.2 как раньше.
 *
 * Файл — обычный ESM без зависимостей: его подключают и serverless-функция
 * раздачи пакетов (api/router.ts), и сборочный скрипт (scripts/normalize-scorm.mjs).
 * Префикс `_` не даёт Vercel считать файл HTTP-маршрутом.
 */

/** Сигнатура плеера iSpring Page — только его точки входа мы трогаем. */
const ISPRING_PAGE = /iSpring\.roll\.LMS\.create/

/** Поле режима работы в конфиге плеера: {"apiVersion":"scorm12", …}. */
const API_VERSION = /(["']apiVersion["']\s*:\s*)["']scorm12["']/

/** Поле редакции SCORM 2004 в том же конфиге (в экспорте 1.2 его обычно нет). */
const EDITION = /(["']edition["']\s*:\s*)["'][^"']*["']/

/** Редакция SCORM 2004, в терминах коннектора iSpring: "2" | "3" | "4". */
const EDITION_4 = '4'

/**
 * Вернуть HTML точки входа, переключённый на SCORM 2004.
 *
 * Функция чистая и идемпотентная: HTML без сигнатуры iSpring Page или уже
 * переключённый возвращается как есть.
 *
 * @param {string} html содержимое точки входа пакета (res/index.html)
 * @returns {string}
 */
export function patchScormLaunchHtml(html) {
  if (!ISPRING_PAGE.test(html) || !API_VERSION.test(html)) return html

  // Если поле edition в конфиге уже есть, второе такое же поле создавать нельзя:
  // при разборе объекта победит последнее, и значение окажется непредсказуемым.
  const hasEdition = EDITION.test(html)
  const withVersion = html.replace(API_VERSION, (_match, key) =>
    hasEdition ? `${key}"scorm2004"` : `${key}"scorm2004","edition":"${EDITION_4}"`,
  )
  return hasEdition
    ? withVersion.replace(EDITION, (_match, key) => `${key}"${EDITION_4}"`)
    : withVersion
}
