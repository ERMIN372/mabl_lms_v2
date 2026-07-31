import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCourses } from '@/context/CoursesContext'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { adminUserStatusLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { AdminUser, AdminUserStatus, UserRole } from '@/types'

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'student', label: 'Слушатель' },
  { value: 'admin', label: 'Администратор' },
]

const STATUSES: AdminUserStatus[] = ['active', 'invited', 'blocked']

const fieldBase =
  'w-full rounded-token border border-ink-20 bg-wisdom px-4 py-3 text-neft transition-colors focus:border-ocean focus:outline-none'

/** Пустой черновик нового участника. */
function blankUser(): AdminUser {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: '',
    name: '',
    email: '',
    role: 'student',
    status: 'invited',
    registeredAt: today,
    lastActiveAt: today,
    enrolledCourseIds: [],
    avgProgress: 0,
  }
}

/** Создание и редактирование участника платформы. */
export default function AdminUserEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id
  const { courses } = useCourses()

  const { data: existing, loading } = useAsync(
    () => (id ? api.users.get(id) : Promise.resolve(undefined)),
    [id],
  )

  const [form, setForm] = useState<AdminUser | null>(null)
  const [error, setError] = useState('')

  const ready = isNew || !loading
  if (form === null && ready) {
    setForm(existing ?? blankUser())
  }

  if (!ready || form === null) {
    return <div className="py-16 text-center text-ink-60">Загрузка…</div>
  }

  if (!isNew && !existing) {
    return (
      <div className="py-10 text-center">
        <h1 className="font-serif text-2xl text-neft">Участник не найден</h1>
        <Button to="/admin/users" className="mt-6" size="sm">
          ← К списку участников
        </Button>
      </div>
    )
  }

  const set = <K extends keyof AdminUser>(key: K, value: AdminUser[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  const toggleCourse = (courseId: string) =>
    setForm((prev) => {
      if (!prev) return prev
      const has = prev.enrolledCourseIds.includes(courseId)
      return {
        ...prev,
        enrolledCourseIds: has
          ? prev.enrolledCourseIds.filter((c) => c !== courseId)
          : [...prev.enrolledCourseIds, courseId],
      }
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) {
      setError('Укажите имя участника.')
      return
    }
    if (!form.email.trim()) {
      setError('Укажите e-mail участника.')
      return
    }

    const isAdmin = form.role === 'admin'
    const payload: AdminUser = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      // Прогресс вычисляется на сервере по факту прохождения — в профиле не
      // хранится. У администратора нет ни прогресса, ни записей на программы.
      avgProgress: 0,
      enrolledCourseIds: isAdmin ? [] : form.enrolledCourseIds,
    }

    if (isNew) {
      await api.users.create(payload)
    } else {
      await api.users.update(form.id, payload)
    }
    navigate('/admin/users')
  }

  return (
    <div>
      <Link to="/admin/users" className="text-sm text-ink-60 hover:text-neft">
        ← К списку участников
      </Link>

      <div className="mt-4">
        <p className="eyebrow mb-3">{isNew ? 'Новый участник' : 'Редактирование'}</p>
        <h1 className="font-serif text-3xl text-neft">
          {isNew ? 'Добавление участника' : form.name || 'Без имени'}
        </h1>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <Input
            label="Имя"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Имя и фамилия"
            required
          />
          <Input
            label="E-mail"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="user@company.ru"
            required
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Роль</span>
            <select
              className={cn(fieldBase)}
              value={form.role}
              onChange={(e) => set('role', e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Статус</span>
            <select
              className={cn(fieldBase)}
              value={form.status}
              onChange={(e) => set('status', e.target.value as AdminUserStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {adminUserStatusLabel[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form.role === 'student' && (
          <>
            <div>
              <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">
                Записан на программы
              </span>
              <p className="mb-2 text-[0.78rem] text-ink-60">
                Отметка вручную — в дополнение к оплаченным заказам и программам, которые
                слушатель уже начал. Прогресс считается по факту прохождения и здесь не
                редактируется.
              </p>
              {courses.length > 0 ? (
                <div className="grid gap-2 rounded-card border border-ink-10 p-4 sm:grid-cols-2">
                  {courses.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 text-sm text-ink-80">
                      <input
                        type="checkbox"
                        checked={form.enrolledCourseIds.includes(c.id)}
                        onChange={() => toggleCourse(c.id)}
                        className="h-4 w-4 accent-ocean"
                      />
                      <span className="truncate">{c.title}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-60">В каталоге пока нет программ.</p>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-ink-10 pt-6">
          <Button type="submit">{isNew ? 'Добавить участника' : 'Сохранить изменения'}</Button>
          <Button to="/admin/users" variant="secondary">
            Отмена
          </Button>
        </div>
      </form>
    </div>
  )
}
