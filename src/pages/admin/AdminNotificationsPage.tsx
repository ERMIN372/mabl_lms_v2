import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea } from '@/components/ui/Input'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { formatDateTime, cn } from '@/lib/utils'
import type { AppNotification, NotificationKind } from '@/types'

const KINDS: { value: NotificationKind; label: string }[] = [
  { value: 'system', label: 'Система' },
  { value: 'course', label: 'Курсы' },
  { value: 'event', label: 'События' },
  { value: 'forum', label: 'Форум' },
  { value: 'survey', label: 'Опросы' },
]

const fieldBase =
  'w-full rounded-token border border-ink-20 bg-wisdom px-4 py-3 text-neft transition-colors focus:border-ocean focus:outline-none'

/** Управление уведомлениями: рассылка и удаление. */
export default function AdminNotificationsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const { data, loading } = useAsync(() => api.notifications.list(), [reloadKey])
  const notifications = useMemo(() => data ?? [], [data])

  const reload = () => setReloadKey((k) => k + 1)

  const [kind, setKind] = useState<NotificationKind>('system')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [href, setHref] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onCreate = async () => {
    setError('')
    if (!title.trim() || !text.trim()) {
      setError('Заполните заголовок и текст уведомления.')
      return
    }
    setBusy(true)
    try {
      const note: AppNotification = {
        id: '',
        kind,
        title: title.trim(),
        text: text.trim(),
        date: new Date().toISOString(),
        read: false,
        href: href.trim() || undefined,
      }
      await api.notifications.create(note)
      setTitle('')
      setText('')
      setHref('')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать уведомление')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string, t: string) => {
    if (window.confirm(`Удалить уведомление «${t}»?`)) {
      await api.notifications.remove(id)
      reload()
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Уведомления"
        description="Сообщения, которые видят слушатели в центре уведомлений."
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <StatCard label="Всего уведомлений" value={notifications.length} />
        <StatCard label="Непрочитанные" value={notifications.filter((n) => !n.read).length} />
      </div>

      {/* Форма создания */}
      <div className="mt-8 rounded-card border border-ink-10 p-5">
        <h2 className="font-serif text-xl text-neft">Новое уведомление</h2>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Категория</span>
              <select
                className={cn(fieldBase)}
                value={kind}
                onChange={(e) => setKind(e.target.value as NotificationKind)}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Ссылка (необязательно)"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="/courses/strategic-leadership"
            />
          </div>
          <Input
            label="Заголовок"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Открыта запись на вебинар"
          />
          <Textarea
            label="Текст"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Короткое сообщение для слушателей."
          />
          {error && (
            <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
              {error}
            </div>
          )}
          <Button type="button" onClick={onCreate} disabled={busy}>
            {busy ? 'Отправляем…' : 'Опубликовать уведомление'}
          </Button>
        </div>
      </div>

      {/* Список */}
      <div className="mt-8 overflow-hidden rounded-card border border-ink-10">
        {loading && <div className="px-5 py-16 text-center text-ink-60">Загрузка…</div>}
        {!loading && notifications.length === 0 && (
          <div className="px-5 py-16 text-center text-ink-60">Уведомлений пока нет.</div>
        )}
        <ul className="divide-y divide-ink-10">
          {notifications.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="outline">{KINDS.find((k) => k.value === n.kind)?.label ?? n.kind}</Badge>
                  <span className="text-[0.7rem] uppercase tracking-wide text-ink-40">
                    {formatDateTime(n.date)}
                  </span>
                </div>
                <p className="mt-1.5 truncate font-medium text-neft">{n.title}</p>
                <p className="truncate text-[0.78rem] text-ink-60">{n.text}</p>
              </div>
              <button
                onClick={() => onDelete(n.id, n.title)}
                className="shrink-0 whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
