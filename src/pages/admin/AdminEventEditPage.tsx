import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/utils'
import type { CalendarEvent, CalendarEventType } from '@/types'

const TYPES: CalendarEventType[] = ['Вебинар', 'Мероприятие', 'Дедлайн']

const fieldBase =
  'w-full rounded-token border border-ink-20 bg-wisdom px-4 py-3 text-neft transition-colors focus:border-ocean focus:outline-none'

/** Пустой черновик события. */
function blankEvent(): CalendarEvent {
  const date = new Date()
  date.setMinutes(0, 0, 0)
  return {
    id: '',
    title: '',
    type: 'Вебинар',
    date: date.toISOString().slice(0, 16),
    durationMin: 90,
    speaker: '',
    location: 'Онлайн · Zoom',
    description: '',
    price: 0,
    registrable: true,
  }
}

/** Значение для <input type="datetime-local"> из ISO-строки. */
function toLocalInput(iso: string): string {
  return iso.slice(0, 16)
}

/** Создание и редактирование события (вебинар / мероприятие / дедлайн). */
export default function AdminEventEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id

  const { data: existing, loading } = useAsync(
    () => (id ? api.events.get(id) : Promise.resolve(undefined)),
    [id],
  )

  const [form, setForm] = useState<CalendarEvent | null>(null)
  const [error, setError] = useState('')

  const ready = isNew || !loading
  if (form === null && ready) {
    setForm(existing ? { ...existing, date: toLocalInput(existing.date) } : blankEvent())
  }

  if (!ready || form === null) {
    return <div className="py-16 text-center text-ink-60">Загрузка…</div>
  }

  if (!isNew && !existing) {
    return (
      <div className="py-10 text-center">
        <h1 className="font-serif text-2xl text-neft">Событие не найдено</h1>
        <Button to="/admin/events" className="mt-6" size="sm">
          ← К списку событий
        </Button>
      </div>
    )
  }

  const set = <K extends keyof CalendarEvent>(key: K, value: CalendarEvent[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  const num = (value: string) => {
    const n = Number(value.replace(/\s/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  const isDeadline = form.type === 'Дедлайн'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) {
      setError('Укажите название события.')
      return
    }
    if (!form.date) {
      setError('Укажите дату и время.')
      return
    }

    const payload: CalendarEvent = {
      ...form,
      title: form.title.trim(),
      location: form.location.trim(),
      description: form.description.trim(),
      speaker: form.speaker?.trim() || undefined,
      // Дедлайны не предполагают записи и платы.
      registrable: isDeadline ? false : form.registrable,
      price: isDeadline ? undefined : form.price,
    }

    if (isNew) {
      await api.events.create(payload)
    } else {
      await api.events.update(form.id, payload)
    }
    navigate('/admin/events')
  }

  return (
    <div>
      <Link to="/admin/events" className="text-sm text-ink-60 hover:text-neft">
        ← К списку событий
      </Link>

      <div className="mt-4">
        <p className="eyebrow mb-3">{isNew ? 'Новое событие' : 'Редактирование'}</p>
        <h1 className="font-serif text-3xl text-neft">
          {isNew ? 'Создание события' : form.title || 'Без названия'}
        </h1>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <Input
          label="Название"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Вебинар «Стратегическое мышление руководителя»"
          required
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Тип</span>
            <select
              className={cn(fieldBase)}
              value={form.type}
              onChange={(e) => set('type', e.target.value as CalendarEventType)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <Input
            label="Дата и время"
            type="datetime-local"
            value={form.date}
            onChange={(e) => set('date', e.target.value)}
            required
          />
        </div>

        <Textarea
          label="Описание"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="О чём событие, для кого и что получит участник."
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <Input
            label="Место / формат"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Онлайн · Zoom или Москва · Конференц-центр"
          />
          <Input
            label="Длительность, мин"
            type="number"
            min={0}
            value={String(form.durationMin ?? 0)}
            onChange={(e) => set('durationMin', num(e.target.value) || undefined)}
          />
        </div>

        {!isDeadline && (
          <>
            <Input
              label="Спикер"
              value={form.speaker ?? ''}
              onChange={(e) => set('speaker', e.target.value)}
              placeholder="Имя спикера"
            />

            <div className="grid gap-6 sm:grid-cols-2">
              <Input
                label="Цена, ₽ (0 — бесплатно)"
                type="number"
                min={0}
                value={String(form.price ?? 0)}
                onChange={(e) => set('price', num(e.target.value))}
              />
              <label className="flex items-center gap-3 self-end pb-3">
                <input
                  type="checkbox"
                  checked={Boolean(form.registrable)}
                  onChange={(e) => set('registrable', e.target.checked)}
                  className="h-4 w-4 accent-ocean"
                />
                <span className="text-sm text-ink-80">Открыть запись на событие</span>
              </label>
            </div>
          </>
        )}

        {error && (
          <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-ink-10 pt-6">
          <Button type="submit">{isNew ? 'Создать событие' : 'Сохранить изменения'}</Button>
          <Button to="/admin/events" variant="secondary">
            Отмена
          </Button>
        </div>
      </form>
    </div>
  )
}
