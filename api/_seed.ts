import bcrypt from 'bcryptjs'
import type { NeonQueryFunction } from '@neondatabase/serverless'

/**
 * Совместно используемая логика инициализации БД (схема + стартовый админ).
 * Вызывается из api/setup.ts (по секрету) и из админ-панели (POST /api/admin/db/init).
 */

type Sql = NeonQueryFunction<false, false>

/**
 * Стартовый аккаунт администратора. Создаётся только если такого e-mail в базе
 * ещё нет; логин и пароль задаются переменными окружения ADMIN_EMAIL и
 * ADMIN_PASSWORD. Контент платформы (программы, события, материалы, участники,
 * заказы) создаётся из админ-панели — никакими данными база не наполняется.
 *
 * Пароля по умолчанию нет намеренно: константа в открытом коде означала бы, что
 * доступ к админке знает каждый, кто видел репозиторий. Если ADMIN_PASSWORD не
 * задан, инициализация генерирует случайный пароль и возвращает его в ответе —
 * один раз, посмотреть и сохранить.
 */
export const defaultAdmin = {
  id: 'u-adm',
  name: 'Администратор',
  email: (process.env.ADMIN_EMAIL || 'admin@mabl.ru').trim().toLowerCase(),
  role: 'Администратор платформы',
  kind: 'admin',
}

/** Случайный пароль на случай, когда ADMIN_PASSWORD не задан. */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** Колонки таблицы password_resets, которыми пользуется восстановление пароля. */
const PASSWORD_RESET_COLUMNS = ['token_hash', 'user_id', 'expires_at', 'used_at', 'created_at']

/** Имя объекта БД в кавычках: имена колонок подставляются в DDL как есть. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Одноразовые ссылки восстановления пароля. В базе лежит только SHA-256-хэш
 * токена: из дампа таблицы рабочую ссылку не собрать.
 *
 * `CREATE TABLE IF NOT EXISTS` не меняет уже существующую таблицу, поэтому
 * таблица с тем же именем, но другой структурой ломает вставку. В базе МАБЛ
 * нашлась ровно такая: с обязательной колонкой email от прежней версии —
 * восстановление падало с «null value in column "email" violates not-null
 * constraint». Приводим таблицу к нужному виду, ничего не удаляя: недостающие
 * колонки добавляем, с чужими обязательными снимаем NOT NULL. Пересоздание —
 * только если иначе никак (например, обязательная колонка входит в первичный
 * ключ); данных в таблице не жалко: это невостребованные ссылки, пользователь
 * просто запросит восстановление заново.
 */
async function ensurePasswordResetsTable(sql: Sql): Promise<void> {
  const columnTypes: Record<string, string> = {
    token_hash: 'TEXT',
    user_id: 'TEXT',
    expires_at: 'TIMESTAMPTZ',
    used_at: 'TIMESTAMPTZ',
    created_at: 'TIMESTAMPTZ DEFAULT NOW()',
  }

  const columns = await sql`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'password_resets'
  `

  if (columns.length > 0) {
    const names = columns.map((c) => c.column_name as string)

    // Недостающие колонки добавляем: существующие строки не трогаются.
    for (const name of PASSWORD_RESET_COLUMNS) {
      if (names.includes(name)) continue
      console.log(`[schema] password_resets: добавляю колонку ${name}`)
      await sql.query(
        `ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS ${quoteIdent(name)} ${columnTypes[name]}`,
      )
    }

    // Чужие обязательные колонки без значения по умолчанию: вставка из нашего
    // кода их не заполняет, поэтому снимаем NOT NULL.
    const unresolved: string[] = []
    for (const column of columns) {
      const name = column.column_name as string
      if (PASSWORD_RESET_COLUMNS.includes(name)) continue
      if (column.is_nullable !== 'NO' || column.column_default !== null) continue
      try {
        console.log(`[schema] password_resets: снимаю NOT NULL с колонки ${name}`)
        await sql.query(`ALTER TABLE password_resets ALTER COLUMN ${quoteIdent(name)} DROP NOT NULL`)
      } catch {
        // Колонка в первичном ключе — NOT NULL с неё не снять.
        unresolved.push(name)
      }
    }

    // Уникальность token_hash нужна, чтобы UPDATE по токену бил ровно в одну
    // строку; в пересозданной таблице это первичный ключ, в доращённой — индекс.
    if (unresolved.length > 0) {
      console.log(`[schema] password_resets пересоздаётся: не удалось исправить [${unresolved.join(', ')}]`)
      await sql`DROP TABLE password_resets`
    } else if (!names.includes('token_hash')) {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token_hash)`
    }
  }

  await sql`
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, created_at)`
}

/** Создаёт таблицы, если их ещё нет. */
export async function ensureSchema(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      sort_order INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'student',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await ensurePasswordResetsTable(sql)
  await sql`
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      published_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'telegram',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS news_comments (
      id TEXT PRIMARY KEY,
      news_id TEXT NOT NULL,
      user_id TEXT,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_news_comments_news ON news_comments (news_id, created_at)`
  await sql`
    CREATE TABLE IF NOT EXISTS news_reactions (
      news_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (news_id, user_id, emoji)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_news_reactions_news ON news_reactions (news_id)`
  await sql`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      sort_order INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      sort_order INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  // Универсальное хранилище коллекций контента (события, материалы, опросники,
  // разделы и темы форума, уведомления). Ключ — пара (collection, id).
  await sql`
    CREATE TABLE IF NOT EXISTS content (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      sort_order INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (collection, id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_content_collection ON content (collection, sort_order)`
}

/** Инициализация: схема + стартовый администратор (без перезаписи существующих данных). */
export interface InitResult {
  courses: number
  users: number
  /** Создан ли аккаунт администратора этим вызовом. */
  adminCreated: boolean
  /** E-mail администратора (существующего или созданного). */
  adminEmail: string
  /**
   * Сгенерированный пароль — только если аккаунт создан прямо сейчас и
   * ADMIN_PASSWORD не задан. Показывается один раз: в базе лежит только хэш.
   */
  adminPassword?: string
}

export async function initDatabase(sql: Sql): Promise<InitResult> {
  await ensureSchema(sql)

  const envPassword = process.env.ADMIN_PASSWORD?.trim()
  const password = envPassword || generatePassword()
  const hash = await bcrypt.hash(password, 10)
  const created = await sql`
    INSERT INTO users (id, name, email, role, kind, password_hash)
    VALUES (${defaultAdmin.id}, ${defaultAdmin.name}, ${defaultAdmin.email},
      ${defaultAdmin.role}, ${defaultAdmin.kind}, ${hash})
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `
  const adminCreated = created.length > 0

  const [{ count: usersCount }] = await sql`SELECT COUNT(*)::int AS count FROM users`
  const [{ count: coursesCount }] = await sql`SELECT COUNT(*)::int AS count FROM courses`
  return {
    courses: Number(coursesCount),
    users: Number(usersCount),
    adminCreated,
    adminEmail: defaultAdmin.email,
    // Пароль отдаём только когда аккаунт создан и задать его было негде.
    ...(adminCreated && !envPassword ? { adminPassword: password } : {}),
  }
}
