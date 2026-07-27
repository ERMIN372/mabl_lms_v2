/**
 * Нормализация SCORM-пакетов в public/scorm перед сборкой.
 *
 * Экспорт iSpring иногда кладёт скрипты с «обрезанным» расширением (`.j_`
 * вместо `.js`) — так некоторые системы обходят фильтры загрузки. При этом
 * index.html пакета запрашивает обычные `.js`, поэтому ни один скрипт плеера
 * не загружается и курс показывает пустой экран. Здесь возвращаем расширения
 * на место. Скрипт идемпотентный: если переименовывать нечего, ничего не делает.
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

let renamed = 0
for (const file of walk(ROOT)) {
  for (const [broken, real] of Object.entries(FIX)) {
    if (!file.endsWith(broken)) continue
    const target = file.slice(0, -broken.length) + real
    // Не затираем уже существующий корректный файл.
    if (!fs.existsSync(target)) {
      fs.renameSync(file, target)
      renamed += 1
    }
    break
  }
}

if (renamed > 0) {
  console.log(`[scorm] восстановлено расширений у файлов пакетов: ${renamed}`)
}
