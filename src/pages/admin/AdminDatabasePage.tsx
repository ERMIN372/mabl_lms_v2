import { useEffect, useState } from 'react'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import { api } from '@/api'
import type { DbStatus, DbUser } from '@/api/database'
import { cn } from '@/lib/utils'

type Notice = { tone: 'ok' | 'err'; text: string } | null

const inputClass =
  'w-full rounded-token border border-ink-20 bg-wisdom px-3.5 py-2.5 text-sm text-neft placeholder:text-ink-40 focus:border-ocean focus:outline-none'

/** Управление базой данных: статус таблиц, аккаунты, обслуживание. */
export default function AdminDatabasePage() {
  const [status, setStatus] = useState<DbStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      setStatus(await api.database.status())
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Ошибка загрузки' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const run = async (key: string, fn: () => Promise<void>, okText: string) => {
    setBusy(key)
    setNotice(null)
    try {
      await fn()
      setNotice({ tone: 'ok', text: okText })
      await refresh()
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Не удалось выполнить операцию' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="База данных"
        description="Состояние базы данных, аккаунты и обслуживание — в одном месте, без консоли."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Обновить
          </Button>
        }
      />

      {notice && (
        <div
          className={cn(
            'mt-6 rounded-card px-4 py-3 text-sm',
            notice.tone === 'ok' ? 'bg-oceanc-10 text-ocean' : 'bg-red-50 text-red-700',
          )}
        >
          {notice.text}
        </div>
      )}

      {/* Статус таблиц */}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {(status?.tables ?? []).map((t) => (
          <StatCard key={t.name} label={t.label} value={t.rows} hint={`таблица «${t.name}»`} />
        ))}
        {loading && !status && <StatCard label="Загрузка…" value="—" />}
      </div>

      {/* Аккаунты */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl text-neft">Аккаунты</h2>
        </div>

        <div className="overflow-hidden rounded-card border border-ink-10">
          <div className="hidden grid-cols-12 gap-4 border-b border-ink-10 bg-ink-5 px-5 py-3 text-[0.68rem] uppercase tracking-wide text-ink-60 md:grid">
            <span className="col-span-4">Имя</span>
            <span className="col-span-4">E-mail</span>
            <span className="col-span-2">Роль</span>
            <span className="col-span-2 text-right">Действия</span>
          </div>
          {loading && !status ? (
            <div className="px-5 py-12 text-center text-ink-60">Загрузка…</div>
          ) : (status?.users.length ?? 0) > 0 ? (
            <ul className="divide-y divide-ink-10">
              {status!.users.map((u) => (
                <UserRow key={u.id} user={u} onChanged={refresh} setNotice={setNotice} />
              ))}
            </ul>
          ) : (
            <div className="px-5 py-12 text-center text-ink-60">Аккаунтов нет. Инициализируйте базу.</div>
          )}
        </div>

        <NewUserForm onCreated={refresh} setNotice={setNotice} />
      </section>

      {/* Обслуживание */}
      <section className="mt-10">
        <h2 className="mb-4 font-serif text-xl text-neft">Обслуживание</h2>
        <Card>
          <CardBody className="space-y-5 p-5">
            <MaintenanceRow
              title="Инициализировать базу"
              desc="Создаёт таблицы и заливает программы и демо-аккаунты, если их ещё нет. Существующие данные не затрагиваются."
              action={
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    run('init', () => api.database.init().then(() => {}), 'База инициализирована.')
                  }
                >
                  {busy === 'init' ? 'Выполняется…' : 'Инициализировать'}
                </Button>
              }
            />
            <div className="border-t border-ink-10" />
            <MaintenanceRow
              title="Пересоздать программы"
              desc="Удаляет все программы из базы и заливает их заново из исходного каталога. Изменения программ будут потеряны."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!window.confirm('Пересоздать каталог программ? Текущие изменения программ будут потеряны.')) return
                    void run('reset', () => api.database.resetCourses().then(() => {}), 'Каталог программ пересоздан.')
                  }}
                >
                  {busy === 'reset' ? 'Выполняется…' : 'Пересоздать'}
                </Button>
              }
            />
          </CardBody>
        </Card>
      </section>
    </div>
  )
}

function MaintenanceRow({
  title,
  desc,
  action,
}: {
  title: string
  desc: string
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-xl">
        <p className="text-sm font-medium text-neft">{title}</p>
        <p className="mt-1 text-[0.82rem] text-ink-60">{desc}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function UserRow({
  user,
  onChanged,
  setNotice,
}: {
  user: DbUser
  onChanged: () => Promise<void>
  setNotice: (n: Notice) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [kind, setKind] = useState<DbUser['kind']>(user.kind)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.database.updateUser(user.id, {
        name: name.trim(),
        kind,
        role: kind === 'admin' ? 'Администратор платформы' : 'Слушатель академии',
        ...(password ? { password } : {}),
      })
      setNotice({ tone: 'ok', text: `Аккаунт «${name}» обновлён.` })
      setEditing(false)
      setPassword('')
      await onChanged()
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Не удалось сохранить' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Удалить аккаунт «${user.name}» (${user.email})?`)) return
    try {
      await api.database.deleteUser(user.id)
      setNotice({ tone: 'ok', text: `Аккаунт «${user.name}» удалён.` })
      await onChanged()
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Не удалось удалить' })
    }
  }

  if (editing) {
    return (
      <li className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4">
        <div className="md:col-span-4">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
        </div>
        <div className="md:col-span-4">
          <input
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Новый пароль (оставьте пустым)"
          />
        </div>
        <div className="md:col-span-2">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as DbUser['kind'])}>
            <option value="student">Слушатель</option>
            <option value="admin">Админ</option>
          </select>
        </div>
        <div className="flex gap-2 md:col-span-2 md:justify-end">
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? '…' : 'Сохранить'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4">
      <div className="flex items-center gap-2 md:col-span-4">
        <p className="truncate text-sm font-medium text-neft">{user.name}</p>
        {user.kind === 'admin' && <Badge tone="dark">Админ</Badge>}
      </div>
      <p className="truncate text-[0.82rem] text-ink-60 md:col-span-4">{user.email}</p>
      <p className="truncate text-[0.82rem] text-ink-60 md:col-span-2">{user.role}</p>
      <div className="flex gap-3 md:col-span-2 md:justify-end">
        <button
          onClick={() => setEditing(true)}
          className="text-[0.72rem] font-semibold uppercase tracking-wide text-ocean hover:text-oceanc-80"
        >
          Изменить
        </button>
        <button
          onClick={() => void remove()}
          className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-50 hover:text-red-600"
        >
          Удалить
        </button>
      </div>
    </li>
  )
}

function NewUserForm({
  onCreated,
  setNotice,
}: {
  onCreated: () => Promise<void>
  setNotice: (n: Notice) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [kind, setKind] = useState<DbUser['kind']>('student')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setName('')
    setEmail('')
    setPassword('')
    setKind('student')
  }

  const submit = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setNotice({ tone: 'err', text: 'Заполните имя, e-mail и пароль.' })
      return
    }
    setSaving(true)
    try {
      await api.database.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        kind,
        role: kind === 'admin' ? 'Администратор платформы' : 'Слушатель академии',
      })
      setNotice({ tone: 'ok', text: `Аккаунт «${name}» создан.` })
      reset()
      setOpen(false)
      await onCreated()
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Не удалось создать аккаунт' })
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          + Добавить аккаунт
        </Button>
      </div>
    )
  }

  return (
    <Card className="mt-4">
      <CardBody className="p-5">
        <p className="mb-4 text-sm font-medium text-neft">Новый аккаунт</p>
        <div className="grid gap-3 md:grid-cols-2">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
          <input
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
          />
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as DbUser['kind'])}>
            <option value="student">Слушатель</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Создание…' : 'Создать'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); reset() }}>
            Отмена
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
