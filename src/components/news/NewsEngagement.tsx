import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Linkify } from '@/components/ui/Linkify'
import { api } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { cn, formatDateTime } from '@/lib/utils'
import type { NewsComment, NewsReactions } from '@/types'

/** Набор доступных реакций. */
const REACTIONS = ['👍', '❤️', '🔥', '👏', '🎓']

/** Реакции + комментарии под новостью. */
export function NewsEngagement({ newsId }: { newsId: string }) {
  const { user, isAuthenticated, isAdmin } = useAuth()
  const [reactions, setReactions] = useState<NewsReactions>({ counts: {}, mine: [] })
  const [comments, setComments] = useState<NewsComment[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.news.getReactions(newsId), api.news.listComments(newsId)])
      .then(([r, c]) => {
        if (!active) return
        setReactions(r)
        setComments(c)
      })
      .catch(() => active && setError('Не удалось загрузить обсуждение.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [newsId, user?.id])

  const onReact = async (emoji: string) => {
    if (!user) return
    try {
      setReactions(await api.news.toggleReaction(newsId, emoji))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить реакцию.')
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || !user) return
    setBusy(true)
    setError(null)
    try {
      const comment = await api.news.addComment(newsId, { body })
      setComments((prev) => [...prev, comment])
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить комментарий.')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (comment: NewsComment) => {
    if (!window.confirm('Удалить комментарий?')) return
    try {
      await api.news.removeComment(newsId, comment.id)
      setComments((prev) => prev.filter((c) => c.id !== comment.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить комментарий.')
    }
  }

  const canDelete = (c: NewsComment) => isAdmin || (Boolean(c.userId) && c.userId === user?.id)

  return (
    <section className="mt-16 border-t border-ink-10 pt-10">
      {/* Реакции */}
      <p className="eyebrow mb-4">Реакции</p>
      <div className="flex flex-wrap gap-2">
        {REACTIONS.map((emoji) => {
          const count = reactions.counts[emoji] ?? 0
          const active = reactions.mine.includes(emoji)
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              disabled={!isAuthenticated}
              title={isAuthenticated ? 'Поставить реакцию' : 'Войдите, чтобы реагировать'}
              className={cn(
                'flex items-center gap-1.5 rounded-token border px-3 py-1.5 text-base transition-colors',
                active
                  ? 'border-ocean bg-oceanc-10 text-neft'
                  : 'border-ink-20 text-ink-80 hover:border-neft',
                !isAuthenticated && 'cursor-not-allowed opacity-60 hover:border-ink-20',
              )}
            >
              <span>{emoji}</span>
              {count > 0 && <span className="text-sm font-semibold text-ink-60">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Комментарии */}
      <p className="eyebrow mb-4 mt-12">
        Комментарии{comments.length > 0 ? ` · ${comments.length}` : ''}
      </p>

      {error && <p className="mb-4 text-sm text-ocean">{error}</p>}

      {isAuthenticated ? (
        <form onSubmit={onSubmit} className="mb-8">
          <Textarea
            name="comment"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Поделитесь мнением…"
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !text.trim()}>
              {busy ? 'Отправка…' : 'Отправить'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mb-8 rounded-card border border-ink-10 bg-ink-5 px-5 py-4 text-sm text-ink-60">
          Чтобы оставить комментарий или реакцию,{' '}
          <Link to="/login" className="font-semibold text-ocean hover:underline">
            войдите в аккаунт
          </Link>
          .
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-60">Загрузка обсуждения…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-ink-60">Пока нет комментариев. Будьте первым!</p>
      ) : (
        <ul className="space-y-5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-card border border-ink-10 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neft text-xs font-semibold text-wisdom">
                    {c.author.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-neft">{c.author}</p>
                    <p className="text-[0.7rem] uppercase tracking-wide text-ink-40">
                      {formatDateTime(c.createdAt)}
                    </p>
                  </div>
                </div>
                {canDelete(c) && (
                  <button
                    onClick={() => onDelete(c)}
                    className="shrink-0 rounded-token px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                  >
                    Удалить
                  </button>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-ink-80">
                <Linkify text={c.body} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
