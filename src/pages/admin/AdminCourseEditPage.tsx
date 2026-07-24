import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { useCourses } from '@/context/CoursesContext'
import { courseFormatLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { Course, CourseFormat, CourseLevel } from '@/types'

const FORMATS: CourseFormat[] = ['video', 'longread', 'scorm']
const LEVELS: CourseLevel[] = ['Базовый', 'Продвинутый', 'Экспертный']

// Базовая форма поля без ширины и горизонтальных отступов — их задаём по месту,
// чтобы compact-поля (длительность + единица) не конфликтовали с w-full/flex.
const fieldShape =
  'rounded-token border border-ink-20 bg-wisdom py-3 text-neft transition-colors focus:border-ocean focus:outline-none'
const fieldBase = cn('w-full px-4', fieldShape)

/** Пустой черновик новой программы. */
function blankCourse(): Course {
  return {
    id: '',
    title: '',
    subtitle: '',
    description: '',
    format: 'video',
    level: 'Базовый',
    instructor: '',
    durationHours: 0,
    lessonsCount: 0,
    price: 0,
    progress: 0,
    modules: [],
    tags: [],
  }
}

/** Создание и редактирование программы. */
export default function AdminCourseEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getCourseById, addCourse, updateCourse } = useCourses()

  const isNew = !id
  const existing = id ? getCourseById(id) : undefined

  // Локальная форма; источник — существующий курс или пустой черновик.
  const [form, setForm] = useState<Course>(() => existing ?? blankCourse())
  const [tagsText, setTagsText] = useState(() => (existing?.tags ?? []).join(', '))
  // Единица измерения длительности. Дробные часы (например, 0.5) показываем
  // в минутах, чтобы значение читалось без потери точности.
  const [durationUnit, setDurationUnit] = useState<'hours' | 'minutes'>(() =>
    existing && existing.durationHours > 0 && existing.durationHours % 1 !== 0 ? 'minutes' : 'hours',
  )
  const [error, setError] = useState('')

  const lessonsTotal = useMemo(
    () => form.modules.reduce((sum, m) => sum + m.lessons.length, 0),
    [form.modules],
  )

  // Если редактируем несуществующий id.
  if (!isNew && !existing) {
    return (
      <div className="py-10 text-center">
        <h1 className="font-serif text-2xl text-neft">Программа не найдена</h1>
        <Button to="/admin/courses" className="mt-6" size="sm">
          ← К списку программ
        </Button>
      </div>
    )
  }

  const set = <K extends keyof Course>(key: K, value: Course[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const num = (value: string) => {
    const n = Number(value.replace(/\s/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) {
      setError('Укажите название программы.')
      return
    }
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const payload: Course = {
      ...form,
      title: form.title.trim(),
      progress: Math.min(100, Math.max(0, form.progress)),
      tags,
    }

    if (isNew) {
      const newId = await addCourse(payload)
      navigate(`/admin/courses/${newId}`)
    } else {
      await updateCourse(form.id, payload)
      navigate('/admin/courses')
    }
  }

  return (
    <div>
      <Link to="/admin/courses" className="text-sm text-ink-60 hover:text-neft">
        ← К списку программ
      </Link>

      <div className="mt-4">
        <p className="eyebrow mb-3">{isNew ? 'Новая программа' : 'Редактирование'}</p>
        <h1 className="font-serif text-3xl text-neft">
          {isNew ? 'Создание программы' : form.title || 'Без названия'}
        </h1>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <Input
          label="Название"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Например, Стратегическое лидерство"
          required
        />

        <Input
          label="Подзаголовок / описание на обложке"
          value={form.subtitle}
          onChange={(e) => set('subtitle', e.target.value)}
          placeholder="Управление через смысл и видение"
        />

        <Textarea
          label="Полное описание"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Подробное описание программы для страницы курса."
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Формат</span>
            <select
              className={cn(fieldBase)}
              value={form.format}
              onChange={(e) => set('format', e.target.value as CourseFormat)}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {courseFormatLabel[f]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Уровень</span>
            <select
              className={cn(fieldBase)}
              value={form.level}
              onChange={(e) => set('level', e.target.value as CourseLevel)}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Input
          label="Преподаватель"
          value={form.instructor}
          onChange={(e) => set('instructor', e.target.value)}
          placeholder="проф. Анна Корецкая"
        />

        <div className="grid gap-6 sm:grid-cols-3">
          <label className="block">
            <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">
              Длительность
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                step={durationUnit === 'minutes' ? 5 : 1}
                className={cn(fieldShape, 'min-w-0 flex-1 px-3')}
                value={String(
                  durationUnit === 'minutes'
                    ? Math.round(form.durationHours * 60)
                    : form.durationHours,
                )}
                onChange={(e) => {
                  const value = num(e.target.value)
                  set('durationHours', durationUnit === 'minutes' ? value / 60 : value)
                }}
              />
              <select
                className={cn(fieldShape, 'w-24 px-2')}
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as 'hours' | 'minutes')}
              >
                <option value="hours">часы</option>
                <option value="minutes">минуты</option>
              </select>
            </div>
          </label>
          <Input
            label="Число уроков"
            type="number"
            min={0}
            value={String(form.lessonsCount)}
            onChange={(e) => set('lessonsCount', num(e.target.value))}
          />
          <Input
            label="Цена, ₽ (0 — бесплатно)"
            type="number"
            min={0}
            value={String(form.price)}
            onChange={(e) => set('price', num(e.target.value))}
          />
        </div>

        <Input
          label="Теги (через запятую)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Лидерство, Стратегия, Управление"
          hint="Первый тег показывается на обложке программы."
        />

        {!isNew && (
          <p className="text-sm text-ink-60">
            Учебная структура: {form.modules.length} модул(я/ей), {lessonsTotal} урок(а/ов). Модули и
            уроки сохраняются без изменений.
          </p>
        )}

        {error && (
          <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-ink-10 pt-6">
          <Button type="submit">{isNew ? 'Создать программу' : 'Сохранить изменения'}</Button>
          <Button to="/admin/courses" variant="secondary">
            Отмена
          </Button>
        </div>
      </form>
    </div>
  )
}
