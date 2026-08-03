/**
 * Нормализация SCORM-пакетов в public/scorm перед сборкой.
 *
 * 1) Экспорт iSpring иногда кладёт скрипты с «обрезанным» расширением (`.j_`
 *    вместо `.js`) — так некоторые системы обходят фильтры загрузки. При этом
 *    index.html пакета запрашивает обычные `.js`, поэтому ни один скрипт плеера
 *    не загружается и курс показывает пустой экран. Возвращаем расширения на
 *    место.
 * 2) Точку входа переключаем со SCORM 1.2 на SCORM 2004 — иначе пакет не
 *    сообщает LMS долю пройденного и прогресс на сайте стоит на нуле до самого
 *    конца курса (подробности — в patchScormLaunchHtml).
 *
 * Скрипт идемпотентный: если менять нечего, ничего не делает.
 *
 * Пакеты, загруженные через админку (они лежат в Vercel Blob, а не в
 * репозитории), получают тот же патч на лету при раздаче — см. serveScormFile
 * и patchScormLaunchHtml в api/router.ts.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'public', 'scorm')

/** Искажённое расширение → настоящее. */
const FIX = {
  '.j_': '.js',
  '.c_': '.css',
  '.htm_': '.html',
  '.h_': '.html',
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

if (!fs.existsSync(ROOT)) {
  process.exit(0)
}

/**
 * Переключить точку входа пакета iSpring со SCORM 1.2 на SCORM 2004.
 *
 * В режиме 1.2 коннектор iSpring не сообщает LMS долю пройденного вовсе (метод
 * setProgress там пустой) — модель данных SCORM 1.2 такого поля не имеет. LMS
 * видит только «не начат / завершён», поэтому пакет показывал у себя внутри,
 * например, 41%, а на сайте прогресс оставался 0% до самого конца курса.
 *
 * Тот же коннектор в режиме SCORM 2004 шлёт cmi.progress_measure — ровно ту
 * долю, которую пакет рисует у себя в панели. Заодно поднимаем редакцию до
 * четвёртой: лимит cmi.suspend_data 64 000 символов вместо 4 000 во второй
 * (во второй редакции коннектор молча выбрасывает состояние сверх лимита).
 *
 * Возвращает null, если менять нечего: страница не от iSpring или уже 2004.
 *
 * ВАЖНО: копия этой функции живёт в api/router.ts — там она патчит пакеты,
 * загруженные в Blob через админку. Правки нужно вносить в оба места.
 */
export function patchScormLaunchHtml(html) {
  if (!html.includes('iSpring.roll.LMS.create')) return null
  let changed = false
  const next = html.replace(/(iSpring\.roll\.LMS\.create\(\s*)(\{[^{}]*\})/g, (match, head, config) => {
    if (!/"apiVersion"\s*:\s*"scorm12"/.test(config)) return match
    changed = true
    const rest = config
      .slice(1, -1)
      .replace(/"apiVersion"\s*:\s*"scorm12"\s*,?/, '')
      .replace(/"edition"\s*:\s*"[^"]*"\s*,?/, '')
      .replace(/^\s*,|,\s*$/g, '')
      .trim()
    return `${head}{"apiVersion":"scorm2004","edition":"4"${rest ? `,${rest}` : ''}}`
  })
  return changed ? next : null
}

let renamed = 0
let relaunched = 0
for (const file of walk(ROOT)) {
  let current = file
  for (const [broken, real] of Object.entries(FIX)) {
    if (!current.endsWith(broken)) continue
    const target = current.slice(0, -broken.length) + real
    // Не затираем уже существующий корректный файл.
    if (!fs.existsSync(target)) {
      fs.renameSync(current, target)
      current = target
      renamed += 1
    }
    break
  }

  if (/\.html?$/i.test(current)) {
    const patched = patchScormLaunchHtml(fs.readFileSync(current, 'utf8'))
    if (patched) {
      fs.writeFileSync(current, patched)
      relaunched += 1
    }
  }
}

if (renamed > 0) {
  console.log(`[scorm] восстановлено расширений у файлов пакетов: ${renamed}`)
}
if (relaunched > 0) {
  console.log(`[scorm] точек входа переведено на SCORM 2004: ${relaunched}`)
}
