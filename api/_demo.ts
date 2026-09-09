import type { Sql } from './_db.js'

/**
 * Разовая уборка демо-данных из БД.
 *
 * Раньше сервер при первом обращении к пустой коллекции заливал в базу
 * демонстрационные сиды (курсы, заказы, участники, уведомления, материалы,
 * опросники, демо-аккаунт). Сами сиды из кода удалены, но уже записанные строки
 * остаются в БД — их и убирает эта операция.
 *
 * Удаляются ТОЛЬКО записи с известными id из бывших сидов: всё, что создано
 * администратором, не затрагивается. Сначала всегда можно посмотреть список
 * (`findDemoRows`) и лишь затем удалять (`purgeDemoRows`).
 */



/** id бывших демо-записей по таблицам. */
const DEMO_IDS = {
  courses: [
    'strategic-leadership',
    'corporate-finance',
    'negotiations',
    'digital-transformation',
    'public-speaking',
    'org-psychology',
    'manager-intro',
  ],
  participants: [
    'u-001', 'u-101', 'u-102', 'u-103', 'u-104',
    'u-105', 'u-106', 'u-107', 'u-108', 'u-adm',
  ],
  orders: [
    'ORD-1030', 'ORD-1031', 'ORD-1032', 'ORD-1033', 'ORD-1034', 'ORD-1035', 'ORD-1036',
    'ORD-1037', 'ORD-1038', 'ORD-1039', 'ORD-1040', 'ORD-1041', 'ORD-1042',
  ],
  notifications: ['n1', 'n2', 'n3', 'n4', 'n5'],
  materials: [
    'leadership-canvas',
    'finance-cheatsheet',
    'negotiation-map',
    'webinar-deck-strategy',
    'digital-maturity-pdf',
    'public-speaking-video',
  ],
  surveys: ['course-feedback', 'webinar-nps'],
}

/** Демо-аккаунт слушателя из старых сидов (в таблице users). */
const DEMO_USER_EMAIL = 'demo@mabl.ru'

export interface DemoRow {
  /** Раздел админки, где лежит запись. */
  section: string
  id: string
  title: string
}

/** Найти оставшиеся демо-записи — без удаления. */
export async function findDemoRows(sql: Sql): Promise<DemoRow[]> {
  const found: DemoRow[] = []

  const courses = await sql`
    SELECT id, data->>'title' AS title FROM courses WHERE id = ANY(${DEMO_IDS.courses})
  `
  for (const r of courses) {
    found.push({ section: 'Программы', id: r.id as string, title: (r.title as string) ?? '' })
  }

  const participants = await sql`
    SELECT id, data->>'name' AS title FROM participants WHERE id = ANY(${DEMO_IDS.participants})
  `
  for (const r of participants) {
    found.push({ section: 'Участники', id: r.id as string, title: (r.title as string) ?? '' })
  }

  const orders = await sql`
    SELECT id, data->>'courseId' AS title FROM orders WHERE id = ANY(${DEMO_IDS.orders})
  `
  for (const r of orders) {
    found.push({ section: 'Заказы', id: r.id as string, title: (r.title as string) ?? '' })
  }

  for (const [collection, ids, section] of [
    ['notifications', DEMO_IDS.notifications, 'Уведомления'],
    ['materials', DEMO_IDS.materials, 'Материалы'],
    ['surveys', DEMO_IDS.surveys, 'Опросники'],
  ] as const) {
    const rows = await sql`
      SELECT id, data->>'title' AS title FROM content
      WHERE collection = ${collection} AND id = ANY(${ids})
    `
    for (const r of rows) {
      found.push({ section, id: r.id as string, title: (r.title as string) ?? '' })
    }
  }

  const users = await sql`SELECT id, name FROM users WHERE email = ${DEMO_USER_EMAIL}`
  for (const r of users) {
    found.push({ section: 'Аккаунты', id: r.id as string, title: `${r.name} · ${DEMO_USER_EMAIL}` })
  }

  return found
}

/** Удалить найденные демо-записи. Возвращает число удалённых строк. */
export async function purgeDemoRows(sql: Sql): Promise<{ deleted: number }> {
  const before = await findDemoRows(sql)

  await sql`DELETE FROM courses WHERE id = ANY(${DEMO_IDS.courses})`
  await sql`DELETE FROM participants WHERE id = ANY(${DEMO_IDS.participants})`
  await sql`DELETE FROM orders WHERE id = ANY(${DEMO_IDS.orders})`
  await sql`
    DELETE FROM content WHERE collection = 'notifications' AND id = ANY(${DEMO_IDS.notifications})
  `
  await sql`DELETE FROM content WHERE collection = 'materials' AND id = ANY(${DEMO_IDS.materials})`
  await sql`DELETE FROM content WHERE collection = 'surveys' AND id = ANY(${DEMO_IDS.surveys})`
  await sql`DELETE FROM users WHERE email = ${DEMO_USER_EMAIL}`

  return { deleted: before.length }
}
