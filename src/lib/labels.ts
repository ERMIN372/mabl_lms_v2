import type { AdminUserStatus, CourseFormat, NotificationKind, OrderStatus } from '@/types'

export const courseFormatLabel: Record<CourseFormat, string> = {
  scorm: 'Тренинг',
  video: 'Видео',
  longread: 'Лонгрид',
}

export const notificationKindLabel: Record<NotificationKind, string> = {
  course: 'Курс',
  event: 'Событие',
  forum: 'Форум',
  system: 'Система',
  survey: 'Опрос',
}

export const orderStatusLabel: Record<OrderStatus, string> = {
  paid: 'Оплачен',
  pending: 'Ожидает',
  refunded: 'Возврат',
}

export const adminUserStatusLabel: Record<AdminUserStatus, string> = {
  active: 'Активен',
  invited: 'Приглашён',
  blocked: 'Заблокирован',
}
