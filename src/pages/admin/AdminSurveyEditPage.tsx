import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/utils'
import type { Survey, SurveyQuestion, SurveyQuestionType } from '@/types'

const QUESTION_TYPES: { value: SurveyQuestionType; label: string }[] = [
  { value: 'single', label: 'Один вариант' },
  { value: 'multiple', label: 'Несколько вариантов' },
  { value: 'scale', label: 'Шкала 1–5' },
  { value: 'text', label: 'Свободный ответ' },
]

const fieldBase =
  'w-full rounded-token border border-ink-20 bg-wisdom px-4 py-3 text-neft transition-colors focus:border-ocean focus:outline-none'

function blankSurvey(): Survey {
  return { id: '', title: '', description: '', questions: [], relatedCourseId: '' }
}

function blankQuestion(): SurveyQuestion {
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'single',
    title: '',
    options: ['', ''],
    required: true,
  }
}

/** Создание и редактирование опросника с конструктором вопросов. */
export default function AdminSurveyEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id

  const { data: existing, loading } = useAsync(
    () => (id ? api.surveys.get(id) : Promise.resolve(undefined)),
    [id],
  )

  const [form, setForm] = useState<Survey | null>(null)
  const [error, setError] = useState('')

  const ready = isNew || !loading
  if (form === null && ready) {
    setForm(existing ?? blankSurvey())
  }

  if (!ready || form === null) {
    return <div className="py-16 text-center text-ink-60">Загрузка…</div>
  }

  if (!isNew && !existing) {
    return (
      <div className="py-10 text-center">
        <h1 className="font-serif text-2xl text-neft">Опросник не найден</h1>
        <Button to="/admin/surveys" className="mt-6" size="sm">
          ← К списку опросников
        </Button>
      </div>
    )
  }

  const survey = form
  const setSurvey = (next: Survey) => setForm(next)

  const updateQuestion = (qid: string, patch: Partial<SurveyQuestion>) =>
    setSurvey({
      ...survey,
      questions: survey.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
    })

  const addQuestion = () => setSurvey({ ...survey, questions: [...survey.questions, blankQuestion()] })

  const removeQuestion = (qid: string) =>
    setSurvey({ ...survey, questions: survey.questions.filter((q) => q.id !== qid) })

  const moveQuestion = (index: number, dir: -1 | 1) => {
    const next = [...survey.questions]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setSurvey({ ...survey, questions: next })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!survey.title.trim()) {
      setError('Укажите название опросника.')
      return
    }
    if (survey.questions.length === 0) {
      setError('Добавьте хотя бы один вопрос.')
      return
    }
    if (survey.questions.some((q) => !q.title.trim())) {
      setError('У каждого вопроса должен быть текст.')
      return
    }

    const payload: Survey = {
      ...survey,
      title: survey.title.trim(),
      description: survey.description.trim(),
      relatedCourseId: survey.relatedCourseId?.trim() || undefined,
      questions: survey.questions.map((q) => ({
        ...q,
        title: q.title.trim(),
        options:
          q.type === 'single' || q.type === 'multiple'
            ? (q.options ?? []).map((o) => o.trim()).filter(Boolean)
            : undefined,
      })),
    }

    if (isNew) await api.surveys.create(payload)
    else await api.surveys.update(survey.id, payload)
    navigate('/admin/surveys')
  }

  return (
    <div>
      <Link to="/admin/surveys" className="text-sm text-ink-60 hover:text-neft">
        ← К списку опросников
      </Link>

      <div className="mt-4">
        <p className="eyebrow mb-3">{isNew ? 'Новый опросник' : 'Редактирование'}</p>
        <h1 className="font-serif text-3xl text-neft">
          {isNew ? 'Создание опросника' : survey.title || 'Без названия'}
        </h1>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <Input
          label="Название"
          value={survey.title}
          onChange={(e) => setSurvey({ ...survey, title: e.target.value })}
          placeholder="Обратная связь по программе"
          required
        />
        <Textarea
          label="Описание"
          value={survey.description}
          onChange={(e) => setSurvey({ ...survey, description: e.target.value })}
          placeholder="Для чего опрос и сколько займёт времени."
        />
        <Input
          label="ID связанной программы (необязательно)"
          value={survey.relatedCourseId ?? ''}
          onChange={(e) => setSurvey({ ...survey, relatedCourseId: e.target.value })}
          placeholder="strategic-leadership"
        />

        {/* Конструктор вопросов */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl text-neft">Вопросы</h2>
            <Button type="button" variant="secondary" size="sm" onClick={addQuestion}>
              + Вопрос
            </Button>
          </div>

          {survey.questions.length === 0 && (
            <p className="rounded-card border border-dashed border-ink-20 px-4 py-8 text-center text-ink-60">
              Вопросов пока нет. Нажмите «+ Вопрос».
            </p>
          )}

          {survey.questions.map((q, index) => {
            const hasOptions = q.type === 'single' || q.type === 'multiple'
            return (
              <div key={q.id} className="rounded-card border border-ink-10 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-3 text-sm font-semibold text-ink-40">{index + 1}.</span>
                  <div className="flex-1 space-y-3">
                    <Input
                      label="Текст вопроса"
                      value={q.title}
                      onChange={(e) => updateQuestion(q.id, { title: e.target.value })}
                      placeholder="Насколько полезной была программа?"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-[0.72rem] uppercase tracking-wide text-ink-60">Тип</span>
                        <select
                          className={cn(fieldBase)}
                          value={q.type}
                          onChange={(e) =>
                            updateQuestion(q.id, {
                              type: e.target.value as SurveyQuestionType,
                              options:
                                e.target.value === 'single' || e.target.value === 'multiple'
                                  ? q.options ?? ['', '']
                                  : undefined,
                            })
                          }
                        >
                          {QUESTION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-3 self-end pb-3">
                        <input
                          type="checkbox"
                          checked={Boolean(q.required)}
                          onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                          className="h-4 w-4 accent-ocean"
                        />
                        <span className="text-sm text-ink-80">Обязательный</span>
                      </label>
                    </div>

                    {hasOptions && (
                      <div className="space-y-2">
                        <span className="block text-[0.72rem] uppercase tracking-wide text-ink-60">
                          Варианты ответа
                        </span>
                        {(q.options ?? []).map((opt, oi) => (
                          <div key={oi} className="flex gap-2">
                            <input
                              className={cn(fieldBase, 'flex-1')}
                              value={opt}
                              onChange={(e) => {
                                const options = [...(q.options ?? [])]
                                options[oi] = e.target.value
                                updateQuestion(q.id, { options })
                              }}
                              placeholder={`Вариант ${oi + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestion(q.id, {
                                  options: (q.options ?? []).filter((_, i) => i !== oi),
                                })
                              }
                              className="rounded-token px-3 text-ink-40 hover:bg-ink-5 hover:text-ocean"
                              aria-label="Удалить вариант"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => updateQuestion(q.id, { options: [...(q.options ?? []), ''] })}
                          className="text-sm text-ocean hover:text-oceanc-80"
                        >
                          + Добавить вариант
                        </button>
                      </div>
                    )}

                    <div className="flex gap-1 pt-1">
                      <button
                        type="button"
                        onClick={() => moveQuestion(index, -1)}
                        disabled={index === 0}
                        className="rounded-token px-2 py-1 text-ink-40 hover:bg-ink-5 hover:text-neft disabled:opacity-30"
                        aria-label="Выше"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveQuestion(index, 1)}
                        disabled={index === survey.questions.length - 1}
                        className="rounded-token px-2 py-1 text-ink-40 hover:bg-ink-5 hover:text-neft disabled:opacity-30"
                        aria-label="Ниже"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeQuestion(q.id)}
                        className="ml-auto rounded-token px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                      >
                        Удалить вопрос
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 border-t border-ink-10 pt-6">
          <Button type="submit">{isNew ? 'Создать опросник' : 'Сохранить изменения'}</Button>
          <Button to="/admin/surveys" variant="secondary">
            Отмена
          </Button>
        </div>
      </form>
    </div>
  )
}
