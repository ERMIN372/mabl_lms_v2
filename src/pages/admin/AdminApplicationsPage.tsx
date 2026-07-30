import { useMemo, useState } from 'react'
import { AdminPageHeader, StatCard, StatusPill } from '@/components/admin/AdminUI'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { applicationStatusLabel } from '@/lib/labels'
import { formatDateTime, cn } from '@/lib/utils'
import type { ApplicationStatus } from '@/types'

const statusTone: Record<ApplicationStatus, 'positive' | 'neutral' | 'muted'> = {
  new: 'positive',
  processing: 'neutral',
  enrolled: 'positive',
  declined: 'muted',
}

const filters: { key: ApplicationStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'new', label: 'Новые' },
  { key: 'processing', label: 'В работе' },
  { key: 'enrolled', label: 'Зачислены' },
  { key: 'declined', label: 'Отклонены' },
]

const statusOrder: ApplicationStatus[] = ['new', 'processing', 'enrolled', 'declined']

/** Заявки на поступление, оставленные со страниц программ. */
export default function AdminApplicationsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const { data, loading, error } = useAsync(() => api.applications.list(), [reloadKey])
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('all')

  const reload = () => setReloadKey((k) => k + 1)

  const applications = useMemo(() => data ?? [], [data])
  const sorted = useMemo(
    () => [...applications].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [applications],
  )
  const filtered = useMemo(
    () => (status === 'all' ? sorted : sorted.filter((a) => a.status === status)),
    [sorted, status],
  )

  const newCount = applications.filter((a) => a.status === 'new').length
  const weekCount = applications.filter(
    (a) => +new Date(a.createdAt) > Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).length

  const changeStatus = async (id: string, next: ApplicationStatus) => {
    await api.applications.update(id, { status: next })
    reload()
  }

  const onDelete = async (id: string) => {
    if (window.confirm(`Удалить заявку ${id}? Действие необратимо.`)) {
      await api.applications.remove(id)
      reload()
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Заявки на поступление"
        description="Обращения со страниц программ: контакты абитуриента, выбранная программа и статус обработки."
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-3">
        <StatCard label="Всего заявок" value={applications.length} />
        <StatCard label="Новые" value={newCount} hint="ждут ответа приёмной комиссии" />
        <StatCard label="За неделю" value={weekCount} />
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
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

      <div className="mt-6 overflow-hidden rounded-card border border-ink-10">
        <div className="hidden grid-cols-12 gap-4 border-b border-ink-10 bg-ink-5 px-5 py-3 text-[0.68rem] uppercase tracking-wide text-ink-60 md:grid">
          <span className="col-span-3">Абитуриент</span>
          <span className="col-span-3">Программа</span>
          <span className="col-span-2">Подана</span>
          <span className="col-span-2">Статус</span>
          <span className="col-span-2 text-right">Действия</span>
        </div>

        {loading ? (
          <div className="px-5 py-16 text-center text-ink-60">Загрузка заявок…</div>
        ) : error ? (
          <div className="px-5 py-16 text-center text-ocean">{error}</div>
        ) : filtered.length > 0 ? (
          <ul className="divide-y divide-ink-10">
            {filtered.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="min-w-0 md:col-span-3">
                  <p className="truncate text-sm text-neft">{a.name}</p>
                  <p className="truncate text-[0.74rem] text-ink-60">
                    <a href={`mailto:${a.email}`} className="hover:text-ocean">
                      {a.email}
                    </a>
                    {' · '}
                    <a href={`tel:${a.phone.replace(/[^\d+]/g, '')}`} className="hover:text-ocean">
                      {a.phone}
                    </a>
                  </p>
                </div>
                <div className="min-w-0 md:col-span-3">
                  <p className="truncate text-sm text-ink-80">{a.programTitle}</p>
                  {a.comment && (
                    <p className="mt-0.5 line-clamp-2 text-[0.74rem] text-ink-60">{a.comment}</p>
                  )}
                </div>
                <div className="text-[0.74rem] text-ink-60 md:col-span-2">
                  {formatDateTime(a.createdAt)}
                  <span className="block font-mono text-[0.68rem] text-ink-40">{a.id}</span>
                </div>
                <div className="md:col-span-2">
                  <StatusPill tone={statusTone[a.status]}>
                    {applicationStatusLabel[a.status]}
                  </StatusPill>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:col-span-2 md:justify-end">
                  <select
                    value={a.status}
                    onChange={(e) => changeStatus(a.id, e.target.value as ApplicationStatus)}
                    className="rounded-token border border-ink-20 bg-wisdom px-2 py-1.5 text-[0.72rem] text-neft focus:border-ocean focus:outline-none"
                    aria-label={`Статус заявки ${a.id}`}
                  >
                    {statusOrder.map((s) => (
                      <option key={s} value={s}>
                        {applicationStatusLabel[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onDelete(a.id)}
                    className="whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-16 text-center text-ink-60">
            Заявок с таким статусом пока нет.
          </div>
        )}
      </div>
    </div>
  )
}
