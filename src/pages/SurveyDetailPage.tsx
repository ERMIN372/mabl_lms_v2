import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Check } from '@/components/ui/Icon'
import { Crest } from '@/components/brand/Crest'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/utils'
import type { SurveyQuestion } from '@/types'

type AnswerValue = string | string[] | number

export default function SurveyDetailPage() {
  const { id = '' } = useParams()
  const { data: survey, loading } = useAsync(() => api.surveys.get(id), [id])

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)

  if (loading) {
    return <Container className="py-24 text-center text-ink-60">Загрузка…</Container>
  }

  if (!survey) {
    return (
      <Container className="py-24 text-center">
        <h1 className="font-serif text-3xl text-neft">Опрос не найден</h1>
        <Button to="/surveys" className="mt-8">Ко всем опросам</Button>
      </Container>
    )
  }

  const setAnswer = (qid: string, value: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }))
    setErrors((prev) => ({ ...prev, [qid]: false }))
  }

  const toggleMultiple = (qid: string, option: string) => {
    const current = (answers[qid] as string[]) || []
    const next = current.includes(option)
      ? current.filter((o) => o !== option)
      : [...current, option]
    setAnswer(qid, next)
  }

  const validate = () => {
    const nextErrors: Record<string, boolean> = {}
    survey.questions.forEach((q) => {
      if (!q.required) return
      const a = answers[q.id]
      const empty =
        a === undefined ||
        a === '' ||
        (Array.isArray(a) && a.length === 0)
      if (empty) nextErrors[q.id] = true
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) {
      const firstError = document.querySelector('[data-error="true"]')
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    // Ответы опросов пока не сохраняются на сервере — показываем подтверждение.
    setSubmitted(true)
  }

  // Экран успеха
  if (submitted) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
            <Check width={32} height={32} />
          </span>
          <h1 className="mt-6 font-serif text-3xl text-neft">Спасибо за ответы</h1>
          <p className="mt-3 text-ink-60">
            Ваша обратная связь по опросу «{survey.title}» отправлена. Она помогает академии
            становиться лучше.
          </p>
          <Crest className="mx-auto mt-8 h-14 w-14" />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button to="/surveys" variant="secondary">К другим опросам</Button>
            <Button to="/dashboard">В личный кабинет</Button>
          </div>
        </div>
      </Container>
    )
  }

  return (
    <article className="py-14 md:py-20">
      <Container className="max-w-2xl">
        <Link to="/surveys" className="text-sm text-ink-60 hover:text-neft">← Опросники</Link>
        <p className="eyebrow mb-3 mt-6">Опрос</p>
        <h1 className="font-serif text-3xl leading-tight text-neft">{survey.title}</h1>
        <p className="mt-3 text-ink-60">{survey.description}</p>

        <form onSubmit={submit} className="mt-10 space-y-8">
          {survey.questions.map((q, index) => (
            <QuestionBlock
              key={q.id}
              question={q}
              index={index + 1}
              value={answers[q.id]}
              error={errors[q.id]}
              onSingle={(v) => setAnswer(q.id, v)}
              onMultiple={(opt) => toggleMultiple(q.id, opt)}
              onScale={(v) => setAnswer(q.id, v)}
              onText={(v) => setAnswer(q.id, v)}
            />
          ))}

          <div className="flex flex-col-reverse items-stretch gap-4 border-t border-ink-10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[0.72rem] text-ink-40">Поля со знаком · обязательны</p>
            <Button type="submit" size="lg" className="w-full sm:w-auto">Отправить ответы</Button>
          </div>
        </form>
      </Container>
    </article>
  )
}

interface QuestionBlockProps {
  question: SurveyQuestion
  index: number
  value: AnswerValue | undefined
  error?: boolean
  onSingle: (v: string) => void
  onMultiple: (opt: string) => void
  onScale: (v: number) => void
  onText: (v: string) => void
}

function QuestionBlock({
  question,
  index,
  value,
  error,
  onSingle,
  onMultiple,
  onScale,
  onText,
}: QuestionBlockProps) {
  return (
    <fieldset
      data-error={Boolean(error)}
      className={cn(
        'rounded-card border bg-wisdom p-6',
        error ? 'border-ocean' : 'border-ink-10',
      )}
    >
      <legend className="px-1 text-[0.72rem] uppercase tracking-wide text-ink-40">
        Вопрос {index}
      </legend>
      <p className="font-serif text-lg leading-snug text-neft">
        {question.title}
        {question.required && <span className="text-ocean"> ·</span>}
      </p>

      <div className="mt-5">
        {/* single */}
        {question.type === 'single' && (
          <div className="space-y-2.5">
            {question.options?.map((opt) => {
              const selected = value === opt
              return (
                <label
                  key={opt}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-token border px-4 py-3 transition-colors',
                    selected ? 'border-ocean bg-oceanc-10' : 'border-ink-20 hover:border-neft',
                  )}
                >
                  <span className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border',
                    selected ? 'border-ocean' : 'border-ink-40',
                  )}>
                    {selected && <span className="h-2 w-2 rounded-full bg-ocean" />}
                  </span>
                  <input
                    type="radio"
                    name={question.id}
                    className="sr-only"
                    checked={selected}
                    onChange={() => onSingle(opt)}
                  />
                  <span className="text-sm text-neft">{opt}</span>
                </label>
              )
            })}
          </div>
        )}

        {/* multiple */}
        {question.type === 'multiple' && (
          <div className="space-y-2.5">
            {question.options?.map((opt) => {
              const selected = Array.isArray(value) && value.includes(opt)
              return (
                <label
                  key={opt}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-token border px-4 py-3 transition-colors',
                    selected ? 'border-ocean bg-oceanc-10' : 'border-ink-20 hover:border-neft',
                  )}
                >
                  <span className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-token border',
                    selected ? 'border-ocean bg-ocean text-wisdom' : 'border-ink-40',
                  )}>
                    {selected && <Check width={12} height={12} />}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    onChange={() => onMultiple(opt)}
                  />
                  <span className="text-sm text-neft">{opt}</span>
                </label>
              )
            })}
          </div>
        )}

        {/* scale 1–5 */}
        {question.type === 'scale' && (
          <div className="flex gap-2 sm:gap-3">
            {[1, 2, 3, 4, 5].map((n) => {
              const selected = value === n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onScale(n)}
                  className={cn(
                    'flex h-12 flex-1 items-center justify-center rounded-card border font-serif text-lg transition-colors sm:w-12 sm:flex-none',
                    selected ? 'border-ocean bg-ocean text-wisdom' : 'border-ink-20 text-neft hover:border-neft',
                  )}
                >
                  {n}
                </button>
              )
            })}
          </div>
        )}

        {/* text */}
        {question.type === 'text' && (
          <Textarea
            name={question.id}
            placeholder="Ваш ответ…"
            value={(value as string) || ''}
            onChange={(e) => onText(e.target.value)}
          />
        )}
      </div>

      {error && <p className="mt-3 text-[0.75rem] text-ocean">Пожалуйста, ответьте на этот вопрос.</p>}
    </fieldset>
  )
}
