import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { Button } from '../ui/Button'
import {
  ArrowUpRight,
  Bell,
  Book,
  Calendar,
  Chat,
  Clipboard,
  Close,
  Document,
  Grid,
  Home,
  Lock,
  Logout,
  Menu,
  Newspaper,
  User,
} from '../ui/Icon'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'

const adminNav = [
  { to: '/admin', label: 'Обзор', icon: Home, end: true },
  { to: '/admin/courses', label: 'Программы', icon: Grid, end: false },
  { to: '/admin/scorm', label: 'SCORM-пакеты', icon: Clipboard, end: false },
  { to: '/admin/users', label: 'Участники', icon: User, end: false },
  { to: '/admin/orders', label: 'Заказы', icon: Document, end: false },
  { to: '/admin/events', label: 'События', icon: Calendar, end: false },
  { to: '/admin/news', label: 'Новости', icon: Newspaper, end: false },
  { to: '/admin/forum', label: 'Форум', icon: Chat, end: false },
  { to: '/admin/materials', label: 'Материалы', icon: Book, end: false },
  { to: '/admin/surveys', label: 'Опросники', icon: Clipboard, end: false },
  { to: '/admin/notifications', label: 'Уведомления', icon: Bell, end: false },
  { to: '/admin/database', label: 'База данных', icon: Lock, end: false },
]

/** Боковая навигация админ-панели (визуально отличается от кабинета слушателя). */
function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  return (
    <div className="flex h-full flex-col bg-neft text-wisdom">
      {/* Шапка с пометкой админ-панели */}
      <div className="border-b border-wisdom/10 px-6 py-5">
        <Logo onDark />
        <div className="mt-3 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ocean" />
          <span className="text-[0.62rem] uppercase tracking-[0.18em] text-wisdom/50">
            Панель администратора
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-4 py-6">
        {adminNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-token px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-ocean text-wisdom'
                  : 'text-wisdom/55 hover:bg-wisdom/5 hover:text-wisdom',
              )
            }
          >
            <Icon width={18} height={18} />
            <span className="uppercase tracking-wide text-[0.78rem]">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Возврат на публичный сайт */}
      <div className="space-y-3 border-t border-wisdom/10 px-4 py-5">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-token px-3 py-2.5 text-sm text-wisdom/55 transition-colors hover:bg-wisdom/5 hover:text-wisdom"
        >
          <ArrowUpRight width={18} height={18} />
          <span className="uppercase tracking-wide text-[0.78rem]">На сайт</span>
        </Link>
        <div className="flex items-center gap-3 px-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wisdom/10">
            <User width={16} height={16} />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm text-wisdom">{user?.name}</p>
            <p className="truncate text-[0.66rem] uppercase tracking-wide text-wisdom/40">
              {user?.role}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Каркас админ-панели: собственная навигация + верхняя панель с кнопкой
 * возврата на сайт. Доступ только для авторизованного администратора.
 */
export function AdminLayout() {
  const { isAuthenticated, isAdmin, logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="min-h-screen bg-ink-5">
      {/* Десктоп-сайдбар */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <AdminSidebar />
      </aside>

      {/* Мобильный сайдбар */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-neft/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">
            <AdminSidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Верхняя панель */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink-10 bg-wisdom px-5 md:px-8">
          <div className="flex items-center gap-3">
            <button
              className="inline-flex h-10 w-10 items-center justify-center text-neft lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Меню"
            >
              {mobileOpen ? <Close /> : <Menu />}
            </button>
            <span className="hidden text-[0.7rem] uppercase tracking-[0.18em] text-ink-40 sm:inline">
              МАБЛ · Администрирование
            </span>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <Button to="/" variant="secondary" size="sm">
              ← На сайт
            </Button>
            <button
              onClick={logout}
              className="inline-flex h-10 w-10 items-center justify-center rounded-token text-ink-60 hover:bg-ink-5 hover:text-neft"
              aria-label="Выйти"
              title="Выйти"
            >
              <Logout />
            </button>
          </div>
        </header>

        <main className="px-5 py-8 md:px-8 md:py-10">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
