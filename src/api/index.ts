import { authApi } from './auth'
import { coursesApi } from './courses'
import { usersApi } from './users'
import { ordersApi } from './orders'
import { eventsApi } from './events'
import { newsApi } from './news'
import { materialsApi } from './materials'
import { surveysApi } from './surveys'
import { forumApi } from './forum'
import { notificationsApi } from './notifications'
import { scormApi } from './scorm'
import { databaseApi } from './database'
import { paymentsApi } from './payments'

/**
 * Единая точка доступа к данным приложения.
 *
 * Все компоненты и контексты работают только через `api.*`, не зная, откуда
 * приходят данные (mock или реальный бэкенд). Это позволяет «выходить из демо»
 * постепенно, ресурс за ресурсом.
 */
export const api = {
  auth: authApi,
  courses: coursesApi,
  users: usersApi,
  orders: ordersApi,
  events: eventsApi,
  news: newsApi,
  materials: materialsApi,
  surveys: surveysApi,
  forum: forumApi,
  notifications: notificationsApi,
  scorm: scormApi,
  database: databaseApi,
  payments: paymentsApi,
}

export { API_URL, ApiError } from './config'
export type { ScormPackage } from './scorm'
