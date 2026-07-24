// Доменные типы LMS МАБЛ

/** Ключевой факт о программе (в шапке лендинга): «Продолжительность» → «12 месяцев». */
export interface ProgramFact {
  label: string
  value: string
}

/** Учебный блок/модуль программы (раскрывается в структуре). */
export interface ProgramModule {
  /** Группировка верхнего уровня, например «Месяц 1 · Digital HR Mindset». */
  phase?: string
  title: string
  topics: string[]
  /** Подпись к итогу блока: «Результат», «Практика», «Проект». */
  resultLabel?: string
  result?: string
}

/** Сквозной трек, проходящий через все модули. */
export interface ProgramTrack {
  title: string
  items: string[]
}

/** Итоговый проект / Capstone. */
export interface ProgramCapstone {
  title: string
  intro?: string
  items: string[]
}

/** Образовательная программа (длинный маркетинговый лендинг в стиле Executive MBA). */
export interface Program {
  id: string
  /** Надзаголовок-категория: «Executive MBA», «Программа цифровой трансформации». */
  category: string
  title: string
  subtitle?: string
  /** Краткое описание в шапке. */
  tagline: string
  durationLabel: string
  facts: ProgramFact[]
  /** Документ об окончании. */
  document?: string
  outcomesTitle?: string
  outcomesIntro?: string
  outcomes: string[]
  /** Краткое резюме профиля выпускника. */
  profileSummary?: string
  competencies?: string[]
  careers?: string[]
  businessEffect?: string[]
  businessEffectConclusion?: string
  structureTitle?: string
  structureSubtitle?: string
  modules: ProgramModule[]
  tracks?: ProgramTrack[]
  capstone?: ProgramCapstone
  /** Международный модуль (город/тема). */
  international?: string
}

export type CourseFormat = 'scorm' | 'video' | 'longread'

export type CourseLevel = 'Базовый' | 'Продвинутый' | 'Экспертный'

export interface Lesson {
  id: string
  title: string
  format: CourseFormat
  duration: string
  completed?: boolean
  /** URL точки входа SCORM-пакета (res/index.html) для интерактивных уроков. */
  launchUrl?: string
}

export interface CourseModule {
  id: string
  title: string
  lessons: Lesson[]
}

export interface Course {
  id: string
  title: string
  subtitle: string
  description: string
  format: CourseFormat
  level: CourseLevel
  instructor: string
  /** Куратор кафедры, отвечающий за программу. */
  curator?: string
  durationHours: number
  lessonsCount: number
  price: number
  /** Прогресс в процентах (0–100) */
  progress: number
  modules: CourseModule[]
  /** id связанного опросника, если есть */
  surveyId?: string
  tags: string[]
}

export type NewsCategory = 'Академия' | 'Вебинары' | 'Курсы' | 'События'

export interface NewsItem {
  id: string
  title: string
  excerpt: string
  body: string[]
  category: NewsCategory
  date: string // ISO
  readingTime: string
  cover?: string
  /** Все изображения публикации (для альбомов из Telegram). cover — первое из них. */
  images?: string[]
}

export interface NewsComment {
  id: string
  newsId: string
  userId?: string | null
  author: string
  body: string
  createdAt: string
}

export interface NewsReactions {
  /** Сводка: эмодзи → число реакций. */
  counts: Record<string, number>
  /** Реакции текущего пользователя (для подсветки). */
  mine: string[]
}

export type MaterialType = 'PDF' | 'Шаблон' | 'Презентация' | 'Чек-лист' | 'Видео'

export interface Material {
  id: string
  title: string
  description: string
  type: MaterialType
  size: string
  date: string
  courseId?: string
  body?: string[]
}

export type CalendarEventType = 'Вебинар' | 'Дедлайн' | 'Мероприятие'

export interface CalendarEvent {
  id: string
  title: string
  type: CalendarEventType
  date: string // ISO datetime
  durationMin?: number
  speaker?: string
  location: string
  description: string
  price?: number
  /** требуется ли запись */
  registrable?: boolean
}

export type NotificationKind = 'course' | 'event' | 'forum' | 'system' | 'survey'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  text: string
  date: string
  read: boolean
  href?: string
}

export interface ForumSection {
  id: string
  title: string
  description: string
  topicsCount: number
}

export interface ForumComment {
  id: string
  author: string
  date: string
  text: string
}

export interface ForumTopic {
  id: string
  sectionId: string
  title: string
  author: string
  date: string
  body: string
  comments: ForumComment[]
}

// Опросники
export type SurveyQuestionType = 'single' | 'multiple' | 'scale' | 'text'

export interface SurveyQuestion {
  id: string
  type: SurveyQuestionType
  title: string
  options?: string[]
  required?: boolean
}

export interface Survey {
  id: string
  title: string
  description: string
  questions: SurveyQuestion[]
  relatedCourseId?: string
}

/** Уровень доступа пользователя в системе. */
export type UserRole = 'admin' | 'student'

export interface User {
  id: string
  name: string
  email: string
  /** Отображаемая должность/статус (например, «Слушатель академии»). */
  role: string
  /** Уровень доступа: администратор или слушатель. */
  kind: UserRole
}

// Администрирование: участники и заказы
export type AdminUserStatus = 'active' | 'invited' | 'blocked'

/** Запись об участнике платформы для админ-панели. */
export interface AdminUser {
  id: string
  name: string
  email: string
  role: UserRole
  status: AdminUserStatus
  /** Дата регистрации (ISO). */
  registeredAt: string
  /** Последняя активность (ISO). */
  lastActiveAt: string
  /** id программ, на которые записан участник. */
  enrolledCourseIds: string[]
  /** Средний прогресс по программам, %. */
  avgProgress: number
}

export type OrderStatus = 'paid' | 'pending' | 'refunded'
export type PaymentMethod = 'Карта' | 'Счёт' | 'СБП'

/** Заказ (покупка программы участником). */
export interface Order {
  id: string
  userId: string
  courseId: string
  amount: number
  /** Дата заказа (ISO). */
  date: string
  status: OrderStatus
  method: PaymentMethod
  /** E-mail покупателя (для онлайн-оплаты и чека). */
  email?: string
  /** Идентификатор платежа во внешнем шлюзе (ЮKassa). */
  paymentId?: string
  /** Платёжный провайдер, через который оформлен заказ. */
  provider?: string
}
