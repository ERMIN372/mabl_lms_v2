import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/utils'
import type { Material, MaterialType } from '@/types'

const TYPES: MaterialType[] = ['PDF', 'Шаблон', 'Презентация', 'Чек-лист', 'Видео']

const fieldBase =
  'w-full rounded-token border border-ink-20 bg-wisdom px-4 py-3 text-neft transition-colors focus:border-ocean focus:outline-none'

/** Пустой черновик материала. */
function blankMaterial(): Material {
  return {
    id: '',
    title: '',
    description: '',
    type: 'PDF',
    size: '',
    date: new Date().toISOString().slice(0, 10),
    courseId: '',
    body: [],
  }
}

/** Создание и редактирование учебного материала. */
export default function AdminMaterialEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id

  const { data: existing, loading } = useAsync(
    () => (id ? api.materials.get(id) : Promise.resolve(undefined)),
    [id],
  )

  const [form, setForm] = useState<Material | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [error, setError] = useState('')

  const ready = isNew || !loading
  if (form === null && ready) {
    const initial = existing ?? blankMaterial()
    setForm(initial)
    setBodyText((initial.body ?? []).join('\n\n'))
  }

  if (!ready || form === null) {
    return <div className="py-16 text-center text-ink-60">Загрузка…</div>
  }

  if (!isNew && !existing) {
    return (
      <div className="py-10 text-center">
        <h1 className="font-serif text-2xl text-neft">Материал не найден</h1>
        <Button to="/admin/materials" className="mt-6" size="sm">
          ← К списку материалов
        </Button>
      </div>
    )
  }

  const set = <K extends keyof Material>(key: K, value: Material[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) {
      setError('Укажите название материала.')
      return
    }
    const body = bodyText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
    const payload: Material = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      size: form.size.trim(),
      courseId: form.courseId?.trim() || undefined,
      body: body.length > 0 ? body : undefined,
    }

    if (isNew) await api.materials.create(payload)
    else await api.materials.update(form.id, payload)
    navigate('/admin/materials')
  }

  return (
    <div>
      <Link to="/admin/materials" className="text-sm text-ink-60 hover:text-neft">
        ← К списку материалов
      </Link>

      <div className="mt-4">
        <p className="eyebrow mb-3">{isNew ? 'Новый материал' : 'Редактирование'}</p>
        <h1 className="font-serif text-3xl text-neft">
          {isNew ? 'Создание материала' : form.title || 'Без названия'}
        </h1>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <Input
          label="Название"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Чек-лист цифровой трансформации"
          required
        />

        <Textarea
          label="Краткое описание"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Для кого материал и чем полезен."
        />

        <div className="grid gap-6 sm:grid-cols-3">
          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Тип</span>
            <select
              className={cn(fieldBase)}
              value={form.type}
              onChange={(e) => set('type', e.target.value as MaterialType)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Объём (напр. 2,4 МБ)"
            value={form.size}
            onChange={(e) => set('size', e.target.value)}
            placeholder="1,2 МБ"
          />
          <Input
            label="Дата"
            type="date"
            value={form.date}
            onChange={(e) => set('date', e.target.value)}
          />
        </div>

        <Input
          label="ID связанной программы (необязательно)"
          value={form.courseId ?? ''}
          onChange={(e) => set('courseId', e.target.value)}
          placeholder="strategic-leadership"
          hint="Если материал относится к конкретной программе — укажите её идентификатор."
        />

        <Textarea
          label="Текст материала (абзацы — через пустую строку)"
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          placeholder="Полный текст материала, если он читается прямо на сайте."
        />

        {error && (
          <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-ink-10 pt-6">
          <Button type="submit">{isNew ? 'Создать материал' : 'Сохранить изменения'}</Button>
          <Button to="/admin/materials" variant="secondary">
            Отмена
          </Button>
        </div>
      </form>
    </div>
  )
}
