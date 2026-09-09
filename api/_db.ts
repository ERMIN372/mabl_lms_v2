import fs from 'node:fs'
import pg from 'pg'

/**
 * Подключение к PostgreSQL.
 *
 * Раньше проект жил на Vercel и ходил в Neon через HTTP-драйвер
 * `@neondatabase/serverless`. После переезда на VM Yandex Cloud база — обычный
 * PostgreSQL (Managed Service for PostgreSQL), поэтому используется штатный
 * протокол через `pg`.
 *
 * Чтобы не переписывать ~50 мест с шаблонными запросами `` sql`SELECT ...` ``,
 * здесь тот же интерфейс: тег-функция, которая подставляет значения
 * параметрами ($1, $2, ...) и возвращает массив строк.
 */

/** Строка результата запроса. */
export type SqlRow = Record<string, any>

/** Тег-функция запроса: `` sql`SELECT * FROM t WHERE id = ${id}` ``. */
export interface Sql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRow[]>
}

let pool: pg.Pool | undefined

function connectionString(): string {
  const value =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING

  if (!value) {
    throw new Error('Не найдена строка подключения к базе данных (DATABASE_URL / POSTGRES_URL)')
  }
  return value
}

/**
 * Настройки TLS. Managed PostgreSQL Яндекса требует шифрования и своего
 * корневого сертификата: он кладётся на VM и указывается в DATABASE_CA_FILE
 * (по умолчанию ~/.postgresql/root.crt — стандартный путь из документации YC).
 */
function sslConfig(url: string): pg.ClientConfig['ssl'] {
  const disabled = /sslmode=disable/.test(url)
  if (disabled) return undefined

  const caFile =
    process.env.DATABASE_CA_FILE ||
    `${process.env.HOME ?? '/root'}/.postgresql/root.crt`

  if (fs.existsSync(caFile)) {
    return { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true }
  }
  // Сертификата нет: шифруем соединение, но без проверки цепочки. Для прода
  // это нежелательно — положите root.crt и укажите DATABASE_CA_FILE.
  console.warn(`[db] корневой сертификат не найден (${caFile}) — TLS без проверки цепочки`)
  return { rejectUnauthorized: false }
}

/** Пул соединений (один на процесс). */
export function getPool(): pg.Pool {
  if (!pool) {
    const url = connectionString()
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslConfig(url),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
    // Ошибка простаивающего клиента не должна ронять процесс целиком.
    pool.on('error', (err) => console.error('[db] ошибка соединения в пуле:', err))
  }
  return pool
}

/**
 * Тег-функция запросов. Интерфейс совместим с прежним драйвером Neon: значения
 * подставляются параметрами (защита от SQL-инъекций), результат — массив строк.
 */
export function getSql(): Sql {
  const db = getPool()
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = ''
    strings.forEach((part, i) => {
      text += part
      if (i < values.length) text += `$${i + 1}`
    })
    return db.query(text, values).then((result) => result.rows as SqlRow[])
  }
}

/** Закрыть пул (используется в скриптах и при остановке сервера). */
export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool
    pool = undefined
    await current.end()
  }
}
