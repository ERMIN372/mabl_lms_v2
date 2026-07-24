import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'

/** Управление библиотекой учебных материалов (список + действия). */
export default function AdminMaterialsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const { data, loading } = useAsync(() => api.materials.list(), [reloadKey])
  const materials = useMemo(() => data ?? [], [data])

  const reload = () => setReloadKey((k) => k + 1)

  const onDelete = async (id: string, title: string) => {
    if (window.confirm(`Удалить материал «${title}»? Действие необратимо.`)) {
      await api.materials.remove(id)
      reload()
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Материалы"
        description="Библиотека документов, шаблонов и презентаций для слушателей."
        actions={
          <Button to="/admin/materials/new" size="sm">
            + Добавить материал
          </Button>
        }
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <StatCard label="Всего материалов" value={materials.length} />
        <StatCard label="С привязкой к курсу" value={materials.filter((m) => m.courseId).length} />
      </div>

      <div className="mt-8 overflow-hidden rounded-card border border-ink-10">
        {loading && <div className="px-5 py-16 text-center text-ink-60">Загрузка материалов…</div>}
        {!loading && materials.length === 0 && (
          <div className="px-5 py-16 text-center text-ink-60">
            Материалов пока нет. Добавьте первый документ или шаблон.
          </div>
        )}
        <ul className="divide-y divide-ink-10">
          {materials.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="outline">{m.type}</Badge>
                  {m.size && <span className="text-[0.7rem] uppercase tracking-wide text-ink-40">{m.size}</span>}
                </div>
                <Link
                  to={`/admin/materials/${m.id}`}
                  className="mt-1.5 block truncate font-medium text-neft hover:text-ocean"
                >
                  {m.title}
                </Link>
                <p className="truncate text-[0.78rem] text-ink-60">{m.description}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <Button to={`/admin/materials/${m.id}`} variant="ghost" size="sm">
                  Изменить
                </Button>
                <button
                  onClick={() => onDelete(m.id, m.title)}
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
