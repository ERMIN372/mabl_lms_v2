import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Textarea } from '@/components/ui/Input'
import { User } from '@/components/ui/Icon'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/lib/utils'
import type { ForumComment } from '@/types'

export default function ForumTopicPage() {
  const { id = '' } = useParams()
  const { data: topic, loading } = useAsync(() => api.forum.getTopic(id), [id])
  const { data: sectionsData } = useAsync(() => api.forum.listSections(), [])
  const { user } = useAuth()

  const [comments, setComments] = useState<ForumComment[]>([])
  const [text, setText] = useState('')

  useEffect(() => {
    if (topic) setComments(topic.comments)
  }, [topic])

  if (loading) {
    return <Container className="py-24 text-center text-ink-60">Загрузка…</Container>
  }

  if (!topic) {
    return (
      <Container className="py-24 text-center">
        <h1 className="font-serif text-3xl text-neft">Тема не найдена</h1>
        <Button to="/forum" className="mt-8">К форуму</Button>
      </Container>
    )
  }

  const section = (sectionsData ?? []).find((s) => s.id === topic.sectionId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    const comment: ForumComment = {
      id: 'c' + Date.now(),
      author: user?.name ?? 'Гость',
      date: new Date().toISOString(),
      text: text.trim(),
    }
    setComments((prev) => [...prev, comment])
    setText('')
  }

  return (
    <article className="py-14 md:py-20">
      <Container className="max-w-3xl">
        <Link to="/forum" className="text-sm text-ink-60 hover:text-neft">← Форум</Link>

        <div className="mt-6">
          {section && <Badge tone="outline">{section.title}</Badge>}
          <h1 className="mt-4 font-serif text-3xl leading-tight text-neft">{topic.title}</h1>
          <p className="mt-3 text-[0.78rem] uppercase tracking-wide text-ink-40">
            {topic.author} · {formatDateTime(topic.date)}
          </p>
        </div>

        <div className="mt-6 rounded-card border border-ink-10 bg-ink-5 p-6 leading-relaxed text-ink-80">
          {topic.body}
        </div>

        {/* Комментарии */}
        <section className="mt-12">
          <h2 className="font-serif text-xl text-neft">
            Ответы <span className="text-ink-40">· {comments.length}</span>
          </h2>

          <div className="mt-6 space-y-5">
            {comments.length === 0 && (
              <p className="rounded-card border border-dashed border-ink-20 px-5 py-8 text-center text-sm text-ink-60">
                Пока нет ответов. Будьте первым.
              </p>
            )}
            {comments.map((c) => (
              <div key={c.id} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neft text-wisdom">
                  <User width={18} height={18} />
                </span>
                <div className="flex-1 rounded-card border border-ink-10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-neft">{c.author}</p>
                    <p className="text-[0.7rem] uppercase tracking-wide text-ink-40">{formatDateTime(c.date)}</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-80">{c.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Форма ответа */}
          <form onSubmit={submit} className="mt-8 rounded-card border border-ink-10 p-6">
            <p className="eyebrow mb-4">Оставить ответ</p>
            <Textarea
              name="comment"
              placeholder="Поделитесь мнением или опытом…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[0.72rem] text-ink-40">
                {user ? `Вы вошли как ${user.name}` : 'Ответ будет опубликован от имени гостя'}
              </p>
              <Button type="submit" size="sm" disabled={!text.trim()}>
                Отправить
              </Button>
            </div>
          </form>
        </section>
      </Container>
    </article>
  )
}
