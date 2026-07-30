import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { AdminPageHeader, StatCard, StatusPill } from '@/components/admin/AdminUI'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { adminUserStatusLabel } from '@/lib/labels'
import { formatDate, cn } from '@/lib/utils'
import type { AdminUser, AdminUserStatus } from '@/types'

const statusTone: Record<AdminUserStatus, 'positive' | 'neutral' | 'muted'> = {
  active: 'positive',
  invited: 'neutral',
  blocked: 'muted',
}

const filters: { key: AdminUserStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'invited', label: 'Приглашённые' },
  { key: 'blocked', label: 'Заблокированные' },
]

/** Управление участниками платформы. */
export default function AdminUsersPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const { data, loading } = useAsync(() => api.users.list(), [reloadKey])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AdminUserStatus | 'all'>('all')

  useEffect(() => {
    if (data) setUsers(data)
  }, [data])

  const reload = () => setReloadKey((k) => k + 1)

  const toggleBlock = (id: string) =>
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u
        const next: AdminUserStatus = u.status === 'blocked' ? 'active' : 'blocked'
        // Оптимистичное обновление + сохранение в слой данных.
        void api.users.setStatus(id, next)
        return { ...u, status: next }
      }),
    )

  const onDelete = async (id: string, name: string) => {
    if (window.confirm(`Удалить участника «${name}»? Действие необратимо.`)) {
      await api.users.remove(id)
      reload()
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      const matchesQuery = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      const matchesStatus = status === 'all' || u.status === status
      return matchesQuery && matchesStatus
    })
  }, [users, query, status])

  const students = users.filter((u) => u.role === 'student')
  const activeCount = users.filter((u) => u.status === 'active').length

  return (
    <div>
      <AdminPageHeader
        title="Участники"
        description="Список зарегистрированных пользователей: статус, записи на программы и прогресс."
        actions={
          <Button to="/admin/users/new" size="sm">
            + Добавить участника
          </Button>
        }
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-3">
        <StatCard label="Всего участников" value={users.length} />
        <StatCard label="Слушатели" value={students.length} />
        <StatCard label="Активные" value={activeCount} />
      </div>

      {/* Поиск + фильтры */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени или e-mail"
          className="w-full max-w-xs rounded-token border border-ink-20 bg-wisdom px-4 py-2.5 text-sm text-neft placeholder:text-ink-40 focus:border-ocean focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                'rounded-token px-3.5 py-2 text-[0.72rem] uppercase tracking-wide transition-colors',
                status === f.key
                  ? 'bg-neft text-wisdom'
                  : 'border border-ink-20 text-ink-60 hover:border-neft hover:text-neft',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Таблица */}
      <div className="mt-6 overflow-hidden rounded-card border border-ink-10">
        <div className="hidden grid-cols-12 gap-4 border-b border-ink-10 bg-ink-5 px-5 py-3 text-[0.68rem] uppercase tracking-wide text-ink-60 md:grid">
          <span className="col-span-3">Участник</span>
          <span className="col-span-2">Статус</span>
          <span className="col-span-1 text-center">Программ</span>
          <span className="col-span-2">Прогресс</span>
          <span className="col-span-4 text-right">Действия</span>
        </div>

        {loading ? (
          <div className="px-5 py-16 text-center text-ink-60">Загрузка участников…</div>
        ) : filtered.length > 0 ? (
          <ul className="divide-y divide-ink-10">
            {filtered.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="min-w-0 md:col-span-3">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/admin/users/${u.id}`}
                      className="truncate text-sm font-medium text-neft hover:text-ocean"
                    >
                      {u.name}
                    </Link>
                    {u.role === 'admin' && <Badge tone="dark">Админ</Badge>}
                  </div>
                  <p className="truncate text-[0.78rem] text-ink-60">{u.email}</p>
                  <p className="text-[0.7rem] text-ink-40">Регистрация: {formatDate(u.registeredAt)}</p>
                </div>
                <div className="md:col-span-2">
                  <StatusPill tone={statusTone[u.status]}>{adminUserStatusLabel[u.status]}</StatusPill>
                </div>
                <div className="text-sm text-ink-80 md:col-span-1 md:text-center">
                  {u.enrolledCourseIds.length}
                </div>
                <div className="md:col-span-2">
                  {u.role === 'student' ? (
                    <ProgressBar value={u.avgProgress} showLabel />
                  ) : (
                    <span className="text-sm text-ink-40">—</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 md:col-span-4 md:flex-nowrap md:justify-end">
                  {u.role === 'student' && (
                    <button
                      onClick={() => toggleBlock(u.id)}
                      className={cn(
                        'whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide transition-colors',
                        u.status === 'blocked'
                          ? 'text-ocean hover:bg-oceanc-10'
                          : 'text-ink-60 hover:bg-ink-5 hover:text-neft',
                      )}
                    >
                      {u.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}
                    </button>
                  )}
                  <Button to={`/admin/users/${u.id}`} variant="ghost" size="sm">
                    Изменить
                  </Button>
                  <button
                    onClick={() => onDelete(u.id, u.name)}
                    className="whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-16 text-center text-ink-60">Никого не найдено по заданным условиям.</div>
        )}
      </div>
    </div>
  )
}
