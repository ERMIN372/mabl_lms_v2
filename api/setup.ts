import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql } from './_db.js'
import { initDatabase } from './_seed.js'

/**
 * Одноразовая инициализация базы данных Neon.
 *
 *   POST /api/setup?secret=<SETUP_SECRET>
 *
 * Создаёт таблицы и стартовый аккаунт администратора. Никакого контента в базу
 * не записывается — всё наполняется из админ-панели. Та же логика доступна из
 * админки (POST /api/admin/db/init); этот файл нужен для первого запуска по
 * секрету, когда админского аккаунта ещё нет.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = req.query.secret as string | undefined
  if (!process.env.SETUP_SECRET || secret !== process.env.SETUP_SECRET) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const sql = getSql()
    const { courses, users, ...admin } = await initDatabase(sql)
    // adminPassword есть только если аккаунт создан этим вызовом, а
    // ADMIN_PASSWORD не задан: показывается один раз, в базе только хэш.
    return res.status(200).json({
      ok: true,
      message: 'База данных инициализирована',
      counts: { courses, users },
      ...admin,
    })
  } catch (err: unknown) {
    console.error('Setup error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
}
