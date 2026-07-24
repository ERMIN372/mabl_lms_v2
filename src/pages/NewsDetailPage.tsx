import { Link, useParams } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Crest } from '@/components/brand/Crest'
import { Carousel } from '@/components/ui/Carousel'
import { NewsEngagement } from '@/components/news/NewsEngagement'
import { Linkify } from '@/components/ui/Linkify'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { formatDate } from '@/lib/utils'

export default function NewsDetailPage() {
  const { id = '' } = useParams()
  const { data, loading } = useAsync(() => api.news.list(), [])
  const news = data ?? []
  const item = news.find((n) => n.id === id)

  if (loading) {
    return <Container className="py-24 text-center text-ink-60">Загрузка…</Container>
  }

  if (!item) {
    return (
      <Container className="py-24 text-center">
        <h1 className="font-serif text-3xl text-neft">Новость не найдена</h1>
        <Button to="/news" className="mt-8">Ко всем новостям</Button>
      </Container>
    )
  }

  const related = news.filter((n) => n.id !== item.id && n.category === item.category).slice(0, 2)
  const gallery = item.images?.length ? item.images : item.cover ? [item.cover] : []

  return (
    <article className="py-14 md:py-20">
      <Container className="max-w-3xl">
        <Link to="/news" className="text-sm text-ink-60 hover:text-neft">← Все новости</Link>

        <div className="mt-6">
          <Badge tone="ocean">{item.category}</Badge>
          <p className="mt-4 text-[0.72rem] uppercase tracking-wide text-ink-40">
            {formatDate(item.date)} · {item.readingTime}
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight text-neft">{item.title}</h1>
        </div>

        {gallery.length > 1 ? (
          <Carousel images={gallery} className="my-10" />
        ) : gallery.length === 1 ? (
          <div className="my-10 overflow-hidden rounded-card">
            <img
              src={gallery[0]}
              alt=""
              className="aspect-video w-full object-cover"
            />
          </div>
        ) : (
          <div className="relative my-10 flex h-56 items-center justify-center overflow-hidden rounded-card bg-neft md:h-80">
            <div className="brand-pattern absolute inset-0 opacity-[0.08]" />
            <Crest className="relative h-24 w-24" onDark />
          </div>
        )}

        <div className="space-y-5 text-lg leading-relaxed text-ink-80">
          {item.body.map((p, i) => (
            <p key={i}>
              <Linkify text={p} />
            </p>
          ))}
        </div>

        <NewsEngagement newsId={item.id} />

        {related.length > 0 && (
          <div className="mt-16 border-t border-ink-10 pt-10">
            <p className="eyebrow mb-6">Ещё по теме</p>
            <div className="grid gap-6 sm:grid-cols-2">
              {related.map((r) => (
                <Link key={r.id} to={`/news/${r.id}`} className="group rounded-card border border-ink-10 p-6 transition-colors hover:border-ink-40">
                  <p className="text-[0.7rem] uppercase tracking-wide text-ink-40">{formatDate(r.date)}</p>
                  <h3 className="mt-2 font-serif text-lg leading-snug text-neft group-hover:text-ocean">{r.title}</h3>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Container>
    </article>
  )
}
