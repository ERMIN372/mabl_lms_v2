import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'

/** Управление опросниками (список + действия). */
export default function AdminSurveysPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const { data, loading } = useAsync(() => api.surveys.list(), [reloadKey])
  const surveys = useMemo(() => data ?? [], [data])

  const reload = () => setReloadKey((k) => k + 1)

  const onDelete = async (id: string, title: string) => {
    if (window.confirm(`Удалить опросник «${title}»? Действие необратимо.`)) {
      await api.surveys.remove(id)
      reload()
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Опросники"
        description="Анкеты и опросы для слушателей: создание и редактирование вопросов."
        actions={
          <Button to="/admin/surveys/new" size="sm">
            + Добавить опросник
          </Button>
        }
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <StatCard label="Всего опросников" value={surveys.length} />
        <StatCard
          label="Всего вопросов"
          value={surveys.reduce((sum, s) => sum + s.questions.length, 0)}
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-card border border-ink-10">
        {loading && <div className="px-5 py-16 text-center text-ink-60">Загрузка опросников…</div>}
        {!loading && surveys.length === 0 && (
          <div className="px-5 py-16 text-center text-ink-60">
            Опросников пока нет. Создайте первую анкету.
          </div>
        )}
        <ul className="divide-y divide-ink-10">
          {surveys.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/admin/surveys/${s.id}`}
                  className="block truncate font-medium text-neft hover:text-ocean"
                >
                  {s.title}
                </Link>
                <p className="truncate text-[0.78rem] text-ink-60">{s.description}</p>
                <p className="mt-0.5 text-[0.7rem] uppercase tracking-wide text-ink-40">
                  {s.questions.length} вопрос(ов)
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <Button to={`/admin/surveys/${s.id}`} variant="ghost" size="sm">
                  Изменить
                </Button>
                <button
                  onClick={() => onDelete(s.id, s.title)}
                  className="whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
