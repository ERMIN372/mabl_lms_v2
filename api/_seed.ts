import bcrypt from 'bcryptjs'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { courses as seedCourses } from '../src/data/courses.js'
import { adminUsers as seedParticipants } from '../src/data/users.js'
import { orders as seedOrders } from '../src/data/orders.js'

/**
 * Совместно используемая логика инициализации БД (схема + сиды).
 * Вызывается из api/setup.ts (по секрету) и из админ-панели (POST /api/admin/db/init).
 */

type Sql = NeonQueryFunction<false, false>

/** Демо-аккаунты по умолчанию (логин + пароль на экране входа). */
export const defaultUsers = [
  {
    id: 'u-001',
    name: 'Александр Орлов',
    email: 'demo@mabl.ru',
    role: 'Слушатель академии',
    kind: 'student',
    password: 'mabl2026',
  },
  {
    id: 'u-adm',
    name: 'Администратор',
    email: 'admin@mabl.ru',
    role: 'Администратор платформы',
    kind: 'admin',
    password: 'admin2026',
  },
]

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

/** Полная инициализация: схема + сиды курсов и аккаунтов (без перезаписи существующих). */
export async function initDatabase(sql: Sql): Promise<{ courses: number; users: number }> {
  await ensureSchema(sql)

  for (let i = 0; i < seedCourses.length; i += 1) {
    const course = seedCourses[i]
    await sql`
      INSERT INTO courses (id, data, sort_order)
      VALUES (${course.id}, ${JSON.stringify(course)}::jsonb, ${i})
      ON CONFLICT (id) DO NOTHING
    `
  }

  for (let i = 0; i < seedParticipants.length; i += 1) {
    const p = seedParticipants[i]
    await sql`
      INSERT INTO participants (id, data, sort_order)
      VALUES (${p.id}, ${JSON.stringify(p)}::jsonb, ${i})
      ON CONFLICT (id) DO NOTHING
    `
  }
  for (let i = 0; i < seedOrders.length; i += 1) {
    const o = seedOrders[i]
    await sql`
      INSERT INTO orders (id, data, sort_order)
      VALUES (${o.id}, ${JSON.stringify(o)}::jsonb, ${i})
      ON CONFLICT (id) DO NOTHING
    `
  }

  for (const u of defaultUsers) {
    const hash = await bcrypt.hash(u.password, 10)
    await sql`
      INSERT INTO users (id, name, email, role, kind, password_hash)
      VALUES (${u.id}, ${u.name}, ${u.email}, ${u.role}, ${u.kind}, ${hash})
      ON CONFLICT (email) DO NOTHING
    `
  }

  const [{ count: usersCount }] = await sql`SELECT COUNT(*)::int AS count FROM users`
  const [{ count: coursesCount }] = await sql`SELECT COUNT(*)::int AS count FROM courses`
  return { courses: Number(coursesCount), users: Number(usersCount) }
}
