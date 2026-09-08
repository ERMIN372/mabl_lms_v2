import { Link, Navigate } from 'react-router-dom'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { NotificationItem } from '@/components/NotificationItem'
import { ArrowRight, ArrowUpRight, Calendar, Clipboard, Document, Grid } from '@/components/ui/Icon'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useCourses } from '@/context/CoursesContext'
import { usePurchases } from '@/context/PurchaseContext'
import { useProgress } from '@/context/ProgressContext'
import { useNotifications } from '@/context/NotificationsContext'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/lib/utils'
import { courseFormatLabel } from '@/lib/labels'

const quickLinks = [
  { to: '/courses', label: 'Каталог курсов', icon: Grid },
  { to: '/materials', label: 'Материалы', icon: Document },
  { to: '/calendar', label: 'Календарь', icon: Calendar },
  { to: '/surveys', label: 'Опросники', icon: Clipboard },
]

export default function DashboardPage() {
  const { user, isAdmin } = useAuth()
  const { courses } = useCourses()
  const { canAccessCourse } = usePurchases()
  const { getCourseProgress } = useProgress()
  const { items } = useNotifications()
  const { data: eventsData } = useAsync(() => api.events.list(), [])

  // У администратора нет персонального обучения — его «кабинет» это админ-панель.
  if (isAdmin) return <Navigate to="/admin" replace />

  const myCourses = courses.filter((c) => canAccessCourse(c))
  const overall = myCourses.length
    ? Math.round(myCourses.reduce((sum, c) => sum + getCourseProgress(c), 0) / myCourses.length)
    : 0

  const upcoming = [...(eventsData ?? [])]
    .filter((e) => new Date(e.date) >= new Date())
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .slice(0, 3)

  const recentNotifications = items.slice(0, 3)

  return (
    <div className="space-y-10">
      {/* Почта не подтверждена: не мешаем учиться, но напоминаем — без
          подтверждённого адреса не восстановить пароль. */}
      {user && !user.emailVerified && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ocean/40 bg-oceanc-10 px-5 py-4">
          <p className="text-sm text-ink-80">
            Адрес <span className="font-semibold text-neft">{user.email}</span> не подтверждён —
            без этого не получится восстановить пароль.
          </p>
          <Link
            to="/verify-email"
            className="shrink-0 text-sm font-semibold text-ocean hover:underline"
          >
            Подтвердить →
          </Link>
        </div>
      )}

      {/* Приветствие */}
      <div>
        <p className="eyebrow mb-2">Личный кабинет</p>
        <h1 className="font-serif text-3xl text-neft md:text-4xl">
          Здравствуйте, {user?.name.split(' ')[0]}
        </h1>
        <p className="mt-2 text-ink-60">Ваш прогресс обучения и ближайшие события академии.</p>
      </div>

      {/* Сводка */}
      <div className="grid gap-5 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-[0.72rem] uppercase tracking-wide text-ink-60">Общий прогресс</p>
            <p className="mt-2 font-serif text-4xl font-light text-neft">{overall}%</p>
            <ProgressBar value={overall} className="mt-4" />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[0.72rem] uppercase tracking-wide text-ink-60">Мои курсы</p>
            <p className="mt-2 font-serif text-4xl font-light text-neft">{myCourses.length}</p>
            <Link to="/courses" className="mt-4 inline-flex items-center gap-1.5 text-[0.74rem] uppercase tracking-wide text-ocean">
              К каталогу <ArrowRight width={15} height={15} />
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[0.72rem] uppercase tracking-wide text-ink-60">Ближайшее событие</p>
            {upcoming[0] ? (
              <>
                <p className="mt-2 font-serif text-lg leading-snug text-neft">{upcoming[0].title}</p>
                <p className="mt-2 text-sm text-ink-60">{formatDateTime(upcoming[0].date)}</p>
              </>
            ) : (
              <p className="mt-2 text-ink-60">Нет запланированных</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Быстрые переходы */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {quickLinks.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex flex-col items-start gap-3 rounded-card border border-ink-10 bg-wisdom p-5 transition-colors hover:border-ink-40"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-card bg-neft text-wisdom">
              <Icon width={18} height={18} />
            </span>
            <span className="text-sm font-medium text-neft">{label}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        {/* Мои курсы */}
        <section>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-serif text-2xl text-neft">Продолжить обучение</h2>
            <Link to="/courses" className="text-sm uppercase tracking-wide text-ocean hover:text-oceanc-80">Все</Link>
          </div>
          <div className="space-y-4">
            {myCourses.length > 0 ? (
              myCourses.map((course) => (
                <Card key={course.id} interactive>
                  <CardBody className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2">
                          <Badge tone="ocean">{courseFormatLabel[course.format]}</Badge>
                          <span className="text-[0.72rem] uppercase tracking-wide text-ink-40">{course.level}</span>
                        </div>
                        <h3 className="truncate font-serif text-lg text-neft">{course.title}</h3>
                      </div>
                      <Button to={`/courses/${course.id}`} size="sm" variant="secondary" className="shrink-0">
                        Открыть
                      </Button>
                    </div>
                    <ProgressBar value={getCourseProgress(course)} showLabel className="mt-4" />
                  </CardBody>
                </Card>
              ))
            ) : (
              <Card>
                <CardBody className="text-center">
                  <p className="text-ink-60">У вас пока нет курсов.</p>
                  <Button to="/courses" className="mt-4" size="sm">Выбрать программу</Button>
                </CardBody>
              </Card>
            )}
          </div>
        </section>

        {/* Боковая: события + уведомления */}
        <aside className="space-y-10">
          <section>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-serif text-2xl text-neft">События</h2>
              <Link to="/calendar" className="text-sm uppercase tracking-wide text-ocean hover:text-oceanc-80">Календарь</Link>
            </div>
            <div className="space-y-3">
              {upcoming.map((event) => (
                <Link key={event.id} to="/calendar" className="group flex gap-4 rounded-card border border-ink-10 p-4 transition-colors hover:border-ink-40">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-card bg-ink-5">
                    <span className="font-serif text-lg leading-none text-neft">{new Date(event.date).getDate()}</span>
                    <span className="text-[0.6rem] uppercase text-ink-60">{new Date(event.date).toLocaleString('ru-RU', { month: 'short' })}</span>
                  </div>
                  <div className="min-w-0">
                    <Badge tone="outline">{event.type}</Badge>
                    <p className="mt-1.5 truncate text-sm font-medium text-neft">{event.title}</p>
                    <p className="text-[0.72rem] text-ink-40">{formatDateTime(event.date)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-2xl text-neft">Уведомления</h2>
              <Link to="/notifications" className="inline-flex items-center gap-1 text-sm uppercase tracking-wide text-ocean hover:text-oceanc-80">
                Все <ArrowUpRight width={15} height={15} />
              </Link>
            </div>
            <div className="rounded-card border border-ink-10 bg-wisdom px-5">
              {recentNotifications.map((n) => (
                <NotificationItem key={n.id} notification={n} />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
