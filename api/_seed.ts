import bcrypt from 'bcryptjs'
import type { NeonQueryFunction } from '@neondatabase/serverless'

/**
 * Совместно используемая логика инициализации БД (схема + стартовый админ).
 * Вызывается из api/setup.ts (по секрету) и из админ-панели (POST /api/admin/db/init).
 */

type Sql = NeonQueryFunction<false, false>

/**
 * Стартовый аккаунт администратора. Создаётся только если такого e-mail в базе
 * ещё нет; логин и пароль можно задать переменными окружения ADMIN_EMAIL и
 * ADMIN_PASSWORD. Контент платформы (программы, события, материалы, участники,
 * заказы) создаётся из админ-панели — демо-данными база не наполняется.
 */
export const defaultAdmin = {
  id: 'u-adm',
  name: 'Администратор',
  email: (process.env.ADMIN_EMAIL || 'admin@mabl.ru').trim().toLowerCase(),
  role: 'Администратор платформы',
  kind: 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin2026',
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
export async function initDatabase(sql: Sql): Promise<{ courses: number; users: number }> {
  await ensureSchema(sql)

  const hash = await bcrypt.hash(defaultAdmin.password, 10)
  await sql`
    INSERT INTO users (id, name, email, role, kind, password_hash)
    VALUES (${defaultAdmin.id}, ${defaultAdmin.name}, ${defaultAdmin.email},
      ${defaultAdmin.role}, ${defaultAdmin.kind}, ${hash})
    ON CONFLICT (email) DO NOTHING
  `

  const [{ count: usersCount }] = await sql`SELECT COUNT(*)::int AS count FROM users`
  const [{ count: coursesCount }] = await sql`SELECT COUNT(*)::int AS count FROM courses`
  return { courses: Number(coursesCount), users: Number(usersCount) }
}
