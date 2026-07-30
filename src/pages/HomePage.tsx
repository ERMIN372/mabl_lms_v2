import { Link } from 'react-router-dom'
import { Container, SectionHeading } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CourseCard } from '@/components/CourseCard'
import { Crest } from '@/components/brand/Crest'
import { ArrowRight, ArrowUpRight, Clock, Pin } from '@/components/ui/Icon'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useCourses } from '@/context/CoursesContext'
import { usePurchases } from '@/context/PurchaseContext'
import { formatDate, formatDateTime, formatPrice } from '@/lib/utils'

export default function HomePage() {
  const { canAccessCourse } = usePurchases()
  const { courses } = useCourses()
  const { data: webinar } = useAsync(() => api.events.next(), [])
  const { data: newsData } = useAsync(() => api.news.list(), [])
  const featured = courses.slice(0, 3)
  const latestNews = (newsData ?? []).slice(0, 3)

  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-ink-10 bg-neft text-wisdom">
        <div className="brand-pattern absolute inset-0 opacity-[0.06]" />
        <Container className="relative py-16 md:py-32">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div>
              <p className="eyebrow mb-6 text-wisdom/50">Sapere · Ducere — Знать, чтобы лидировать</p>
              <h1 className="display-title text-3xl sm:text-4xl md:text-6xl">
                Международная академия бизнес лидерства
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-wisdom/70">
                Академическое образование для руководителей нового поколения. Стратегия,
                финансы, переговоры и лидерство — в строгой образовательной традиции МАБЛ.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
                <Button to="/courses" size="lg" className="w-full sm:w-auto">
                  Каталог программ
                  <ArrowRight width={18} height={18} />
                </Button>
                <Button to="/login" size="lg" variant="secondary" className="w-full border-wisdom/30 text-wisdom hover:border-wisdom hover:bg-wisdom/5 sm:w-auto">
                  Личный кабинет
                </Button>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <Crest withBanner className="h-60 w-60 md:h-80 md:w-80" />
            </div>
          </div>
        </Container>
      </section>

      {/* NEXT WEBINAR */}
      {webinar && (
      <section className="py-20 md:py-24">
        <Container>
          <div className="overflow-hidden rounded-card border border-ink-10">
            <div className="grid md:grid-cols-[1fr_0.9fr]">
              <div className="p-8 md:p-12">
                <Badge tone="ocean">Ближайший вебинар</Badge>
                <h2 className="mt-5 font-serif text-3xl leading-tight text-neft">{webinar.title}</h2>
                <p className="mt-4 max-w-md text-ink-60">{webinar.description}</p>

                <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 text-sm text-ink-80">
                  <span className="inline-flex items-center gap-2">
                    <Clock width={16} height={16} className="text-ocean" />
                    {formatDateTime(webinar.date)}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Pin width={16} height={16} className="text-ocean" />
                    {webinar.location}
                  </span>
                </div>

                <div className="mt-9 flex flex-wrap items-center gap-5">
                  <Button to="/calendar" size="md">
                    Записаться · {formatPrice(webinar.price ?? 0)}
                  </Button>
                  {webinar.speaker && (
                    <span className="text-sm text-ink-60">Спикер: {webinar.speaker}</span>
                  )}
                </div>
              </div>

              <div className="relative flex items-center justify-center bg-neft p-12">
                <div className="brand-pattern absolute inset-0 opacity-[0.08]" />
                <Crest className="relative h-36 w-36" />
              </div>
            </div>
          </div>
        </Container>
      </section>
      )}

      {/* COURSES */}
      {featured.length > 0 && (
      <section className="border-t border-ink-10 bg-ink-5 py-20 md:py-24">
        <Container>
          <div className="flex items-end justify-between gap-6">
            <SectionHeading eyebrow="Образование" title="Флагманские программы" />
            <Link to="/courses" className="hidden items-center gap-2 text-sm uppercase tracking-wide text-ocean hover:text-oceanc-80 md:inline-flex">
              Все курсы <ArrowUpRight width={16} height={16} />
            </Link>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featured.map((course) => (
              <CourseCard key={course.id} course={course} owned={canAccessCourse(course)} />
            ))}
          </div>
        </Container>
      </section>
      )}

      {/* NEWS */}
      {latestNews.length > 0 && (
      <section className="py-20 md:py-24">
        <Container>
          <div className="flex items-end justify-between gap-6">
            <SectionHeading eyebrow="Хроника академии" title="Новости" />
            <Link to="/news" className="hidden items-center gap-2 text-sm uppercase tracking-wide text-ocean hover:text-oceanc-80 md:inline-flex">
              Все новости <ArrowUpRight width={16} height={16} />
            </Link>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-card border border-ink-10 bg-ink-10 md:grid-cols-3">
            {latestNews.map((item) => (
              <Link key={item.id} to={`/news/${item.id}`} className="group bg-wisdom p-8 transition-colors hover:bg-ink-5">
                <Badge tone="outline">{item.category}</Badge>
                <p className="mt-4 text-[0.72rem] uppercase tracking-wide text-ink-40">{formatDate(item.date)}</p>
                <h3 className="mt-2 font-serif text-xl leading-snug text-neft group-hover:text-ocean">{item.title}</h3>
                <p className="mt-3 text-sm text-ink-60">{item.excerpt}</p>
              </Link>
            ))}
          </div>
        </Container>
      </section>
      )}

      {/* CTA */}
      <section className="border-t border-ink-10 bg-ocean text-wisdom">
        <Container className="py-20 text-center md:py-24">
          <p className="eyebrow mb-5 text-wisdom/60">Поступление открыто</p>
          <h2 className="display-title mx-auto max-w-3xl text-3xl md:text-5xl">
            Начните обучение в МАБЛ
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-wisdom/75">
            Выберите программу, оформите доступ и присоединитесь к сообществу лидеров академии.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Button to="/courses" size="lg" variant="dark">
              Выбрать программу
            </Button>
          </div>
        </Container>
      </section>
    </div>
  )
}
