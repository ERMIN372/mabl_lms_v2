import { useMemo, useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Crest } from '@/components/brand/Crest'
import { Check, ArrowRight } from '@/components/ui/Icon'
import { ApplicationForm } from '@/components/ApplicationForm'
import { getProgramById } from '@/data/programs'
import type { ProgramModule } from '@/types'

interface Anchor {
  id: string
  label: string
}

/** Группировка модулей по фазам (месяцам/этапам), если они заданы. */
function groupModules(modules: ProgramModule[]): { phase: string | null; items: ProgramModule[] }[] {
  const groups: { phase: string | null; items: ProgramModule[] }[] = []
  for (const m of modules) {
    const phase = m.phase ?? null
    const last = groups[groups.length - 1]
    if (last && last.phase === phase) last.items.push(m)
    else groups.push({ phase, items: [m] })
  }
  return groups
}

/**
 * Прокрутка к форме заявки.
 *
 * Переход по якорю внутри SPA обрабатывает <ScrollToTop/>, но если адрес уже
 * содержит `#apply`, маршрут не меняется и эффект не срабатывает — тогда
 * прокручиваем сами, чтобы кнопка всегда вела к форме.
 */
function scrollToApply() {
  document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function ProgramDetailPage() {
  const { id } = useParams()
  const program = id ? getProgramById(id) : undefined
  const [openModule, setOpenModule] = useState<string | null>(null)

  const grouped = useMemo(() => (program ? groupModules(program.modules) : []), [program])

  if (!program) return <Navigate to="/programs" replace />

  const anchors: Anchor[] = [
    { id: 'about', label: 'О программе' },
    { id: 'outcomes', label: 'Результаты' },
    ...(program.careers?.length ? [{ id: 'careers', label: 'Карьера' }] : []),
    { id: 'structure', label: 'Структура' },
    { id: 'apply', label: 'Поступление' },
  ]

  return (
    <div className="pb-24">
      {/* ---------- ШАПКА ---------- */}
      <section className="relative overflow-hidden bg-neft text-wisdom">
        <div className="brand-pattern absolute inset-0 opacity-[0.08]" />
        <Container className="relative py-16 md:py-24">
          <Link to="/programs" className="text-sm text-wisdom/60 hover:text-wisdom">
            ← Все программы
          </Link>
          <div className="mt-8 flex items-start gap-5">
            <Crest className="hidden h-16 w-16 shrink-0 sm:block" onDark />
            <div>
              <p className="eyebrow text-wisdom/50">{program.category}</p>
              <h1 className="mt-3 font-serif text-3xl font-light uppercase leading-tight tracking-wide md:text-5xl">
                {program.title}
              </h1>
              {program.subtitle && (
                <p className="mt-3 font-serif text-xl text-wisdom/80 md:text-2xl">{program.subtitle}</p>
              )}
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-wisdom/70">{program.tagline}</p>

          {/* Ключевые факты */}
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-card bg-wisdom/10 sm:grid-cols-3 lg:grid-cols-6">
            {program.facts.map((f) => (
              <div key={f.label} className="bg-neft p-5">
                <dt className="text-[0.66rem] uppercase tracking-wide text-wisdom/45">{f.label}</dt>
                <dd className="mt-1 font-serif text-lg leading-tight text-wisdom">{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button to="#apply" size="lg" onClick={scrollToApply}>
              Оставить заявку
            </Button>
            {program.document && (
              <span className="inline-flex items-center rounded-token border border-wisdom/20 px-5 py-3 text-[0.72rem] uppercase tracking-wide text-wisdom/70">
                Документ: {program.document}
              </span>
            )}
          </div>
        </Container>
      </section>

      {/* ---------- ЯКОРНАЯ НАВИГАЦИЯ ---------- */}
      <nav className="sticky top-20 z-30 border-b border-ink-10 bg-wisdom/95 backdrop-blur">
        <Container className="flex gap-6 overflow-x-auto py-4">
          {anchors.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              className="whitespace-nowrap text-[0.74rem] uppercase tracking-wide text-ink-60 transition-colors hover:text-ocean"
            >
              {a.label}
            </a>
          ))}
        </Container>
      </nav>

      {/* ---------- О ПРОГРАММЕ / ПРОФИЛЬ ---------- */}
      <section id="about" className="scroll-mt-36">
        <Container className="py-16 md:py-20">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="eyebrow mb-4">О программе</p>
              <h2 className="font-serif text-3xl font-light text-neft">
                Профиль выпускника
              </h2>
              {program.profileSummary && (
                <p className="mt-5 text-lg leading-relaxed text-ink-70">{program.profileSummary}</p>
              )}
            </div>
            {program.competencies && (
              <div>
                <p className="mb-4 text-sm uppercase tracking-wide text-ink-40">Ключевые компетенции</p>
                <div className="flex flex-wrap gap-2">
                  {program.competencies.map((c) => (
                    <Badge key={c} tone="outline">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* ---------- РЕЗУЛЬТАТЫ ОБУЧЕНИЯ ---------- */}
      <section id="outcomes" className="scroll-mt-36 bg-ink-5">
        <Container className="py-16 md:py-20">
          <p className="eyebrow mb-4">{program.outcomesTitle ?? 'Результаты обучения'}</p>
          <h2 className="max-w-3xl font-serif text-3xl font-light text-neft">
            {program.outcomesIntro ?? 'По завершении программы выпускник будет способен:'}
          </h2>
          <ul className="mt-10 grid gap-x-10 gap-y-5 md:grid-cols-2">
            {program.outcomes.map((o, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
                  <Check width={14} height={14} />
                </span>
                <span className="text-ink-70">{o}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ---------- КАРЬЕРА + БИЗНЕС-ЭФФЕКТ ---------- */}
      {(program.careers?.length || program.businessEffect?.length) && (
        <section id="careers" className="scroll-mt-36">
          <Container className="py-16 md:py-20">
            <div className="grid gap-12 lg:grid-cols-2">
              {program.careers && (
                <div>
                  <p className="eyebrow mb-4">Карьерные возможности</p>
                  <h2 className="font-serif text-2xl font-light text-neft">
                    Программа готовит к позициям
                  </h2>
                  <ul className="mt-6 space-y-px overflow-hidden rounded-card border border-ink-10">
                    {program.careers.map((c) => (
                      <li
                        key={c}
                        className="flex items-center gap-3 border-b border-ink-10 bg-wisdom px-5 py-3.5 text-ink-80 last:border-0"
                      >
                        <ArrowRight width={15} height={15} className="text-ocean" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {program.businessEffect && (
                <div>
                  <p className="eyebrow mb-4">Бизнес-эффект</p>
                  <h2 className="font-serif text-2xl font-light text-neft">
                    Что получают выпускники
                  </h2>
                  <ul className="mt-6 space-y-3">
                    {program.businessEffect.map((b) => (
                      <li key={b} className="flex gap-3 text-ink-70">
                        <span className="mt-0.5 text-ocean">
                          <Check width={16} height={16} />
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                  {program.businessEffectConclusion && (
                    <p className="mt-6 border-l-2 border-ocean bg-oceanc-10 p-5 font-serif text-lg leading-relaxed text-neft">
                      {program.businessEffectConclusion}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Container>
        </section>
      )}

      {/* ---------- СТРУКТУРА ПРОГРАММЫ ---------- */}
      <section id="structure" className="scroll-mt-36 bg-neft text-wisdom">
        <div className="relative overflow-hidden">
          <div className="brand-pattern absolute inset-0 opacity-[0.06]" />
          <Container className="relative py-16 md:py-20">
            <p className="eyebrow mb-4 text-wisdom/50">Структура программы</p>
            <h2 className="max-w-3xl font-serif text-3xl font-light uppercase tracking-wide">
              {program.structureTitle ?? 'Содержание программы'}
            </h2>
            {program.structureSubtitle && (
              <p className="mt-4 max-w-2xl text-wisdom/60">{program.structureSubtitle}</p>
            )}

            <div className="mt-10 space-y-10">
              {grouped.map((g, gi) => (
                <div key={gi}>
                  {g.phase && (
                    <p className="mb-4 text-[0.72rem] uppercase tracking-[0.2em] text-ocean">{g.phase}</p>
                  )}
                  <div className="space-y-2">
                    {g.items.map((m) => {
                      const key = m.title
                      const open = openModule === key
                      return (
                        <div key={key} className="overflow-hidden rounded-token border border-wisdom/15">
                          <button
                            onClick={() => setOpenModule(open ? null : key)}
                            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-wisdom/5"
                          >
                            <span className="font-serif text-lg text-wisdom">{m.title}</span>
                            <span
                              className={`shrink-0 text-wisdom/60 transition-transform ${open ? 'rotate-45' : ''}`}
                              aria-hidden
                            >
                              +
                            </span>
                          </button>
                          {open && (
                            <div className="border-t border-wisdom/10 px-5 py-5">
                              <div className="flex flex-wrap gap-2">
                                {m.topics.map((t) => (
                                  <span
                                    key={t}
                                    className="rounded-full bg-wisdom/10 px-3 py-1 text-sm text-wisdom/80"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                              {m.result && (
                                <p className="mt-4 text-sm text-wisdom/70">
                                  <span className="font-semibold uppercase tracking-wide text-ocean">
                                    {m.resultLabel ?? 'Результат'}:
                                  </span>{' '}
                                  {m.result}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Сквозные треки */}
            {program.tracks && (
              <div className="mt-14">
                <p className="eyebrow mb-6 text-wisdom/50">Сквозные треки</p>
                <div className="grid gap-5 md:grid-cols-3">
                  {program.tracks.map((t) => (
                    <div key={t.title} className="rounded-card border border-wisdom/15 p-6">
                      <p className="font-serif text-lg text-wisdom">{t.title}</p>
                      <ul className="mt-4 space-y-2">
                        {t.items.map((it) => (
                          <li key={it} className="text-sm text-wisdom/65">— {it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Capstone / международный модуль */}
            {program.capstone && (
              <div className="mt-14 rounded-card border border-ocean/40 bg-ocean/10 p-8 md:p-10">
                <p className="eyebrow mb-3 text-ocean">Финал программы</p>
                <h3 className="font-serif text-2xl text-wisdom">{program.capstone.title}</h3>
                {program.capstone.intro && (
                  <p className="mt-3 text-wisdom/70">{program.capstone.intro}</p>
                )}
                <ul className="mt-6 grid gap-3 md:grid-cols-2">
                  {program.capstone.items.map((it) => (
                    <li key={it} className="flex gap-3 text-wisdom/85">
                      <span className="mt-0.5 text-ocean">
                        <Check width={16} height={16} />
                      </span>
                      {it}
                    </li>
                  ))}
                </ul>
                {program.international && (
                  <p className="mt-6 inline-flex rounded-token bg-wisdom/10 px-4 py-2 text-sm text-wisdom/80">
                    🌍 Международный модуль: {program.international}
                  </p>
                )}
              </div>
            )}
          </Container>
        </div>
      </section>

      {/* ---------- ПОСТУПЛЕНИЕ / CTA ---------- */}
      <section id="apply" className="scroll-mt-36">
        <Container className="py-16 md:py-24">
          <div className="mx-auto max-w-3xl rounded-card border border-ink-10 bg-ink-5 p-10 text-center md:p-14">
            <p className="eyebrow mb-4">Поступление</p>
            <h2 className="font-serif text-3xl font-light text-neft">
              Готовы присоединиться к программе «{program.title}»?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-ink-60">
              Оставьте заявку — приёмная комиссия свяжется с вами, расскажет о ближайшем
              наборе, условиях и формате обучения.
            </p>
            <div className="mt-8">
              <ApplicationForm programId={program.id} programTitle={program.title} />
            </div>
            <p className="mt-6 text-[0.78rem] text-ink-60">
              Ещё выбираете?{' '}
              <Link to="/programs" className="underline hover:text-neft">
                Посмотреть другие программы
              </Link>
            </p>
            {program.document && (
              <p className="mt-8 text-[0.72rem] uppercase tracking-wide text-ink-40">
                По итогам — {program.document}
              </p>
            )}
          </div>
        </Container>
      </section>
    </div>
  )
}
