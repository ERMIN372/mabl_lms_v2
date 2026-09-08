import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Crest } from '@/components/brand/Crest'
import { Book, Check, Clipboard, Lock, Play } from '@/components/ui/Icon'
import { ScormPlayer } from '@/components/ScormPlayer'
import type { ScormStatus } from '@/components/ScormPlayer'
import { useCourses } from '@/context/CoursesContext'
import { usePurchases } from '@/context/PurchaseContext'
import { useAuth } from '@/context/AuthContext'
import { formatPrice, formatDuration, displayTitle, cn } from '@/lib/utils'
import { courseFormatLabel } from '@/lib/labels'
import type { Lesson } from '@/types'

/** Плейсхолдер плеера в зависимости от формата урока. */
function LessonPlayer({
  lesson,
  student,
  onScormStatus,
}: {
  lesson: Lesson
  /** Слушатель, которому засчитывается прохождение тренинга. */
  student: { id: string; name: string }
  onScormStatus?: (s: ScormStatus) => void
}) {
  if (lesson.format === 'video') {
    return (
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-card bg-neft text-wisdom">
        <div className="brand-pattern absolute inset-0 opacity-[0.07]" />
        <div className="relative text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-wisdom/30">
            <Play width={26} height={26} />
          </span>
          <p className="mt-4 text-sm uppercase tracking-wide text-wisdom/60">Видео · {lesson.duration}</p>
          <p className="mt-1 text-xs text-wisdom/40">Видеоматериал появится здесь после публикации</p>
        </div>
      </div>
    )
  }
  if (lesson.format === 'scorm') {
    if (lesson.launchUrl) {
      return (
        <ScormPlayer
          src={lesson.launchUrl}
          title={lesson.title}
          studentId={student.id}
          studentName={student.name}
          // Прогресс хранится в браузере, поэтому ключ привязан к слушателю:
          // на общем компьютере иначе виден чужой прогресс.
          storageKey={`mabl.scorm.${student.id}.${lesson.id}`}
          onStatus={onScormStatus}
        />
      )
    }
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-card border border-dashed border-ink-20 bg-ink-5 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-card border border-ink-20 text-ocean">
          <Clipboard width={26} height={26} />
        </span>
        <p className="mt-4 text-sm uppercase tracking-wide text-ink-60">Интерактивный тренинг · {lesson.duration}</p>
        <p className="mt-1 max-w-xs text-xs text-ink-40">
          Материалы тренинга появятся здесь после публикации.
        </p>
      </div>
    )
  }
  // longread
  return (
    <article className="rounded-card border border-ink-10 bg-wisdom p-8">
      <p className="eyebrow mb-4">Лонгрид · {lesson.duration}</p>
      <h3 className="font-serif text-2xl text-neft">{lesson.title}</h3>
      <div className="mt-5 space-y-4 leading-relaxed text-ink-80">
        <p>
          Полный текстовый материал урока с иллюстрациями, цитатами и врезками появится здесь
          после публикации.
        </p>
        <p>
          Лонгриды раскрывают теоретическую основу программы и дополняют видео-лекции и
          интерактивные модули, формируя целостную картину темы.
        </p>
      </div>
    </article>
  )
}

export default function CourseDetailPage() {
  const { id = '' } = useParams()
  const { getCourseById, updateCourse } = useCourses()
  const course = getCourseById(id)
  const { canAccessCourse, accessStale, refreshAccess, loading: accessLoading } = usePurchases()
  const { user, isAuthenticated } = useAuth()
  // Материалы программы открываются только авторизованному слушателю с
  // оплаченным заказом (бесплатные программы — сразу после входа). Гость видит
  // только описание.
  const owned = course ? canAccessCourse(course) : false

  const firstLesson = course?.modules[0]?.lessons[0]
  const [activeLesson, setActiveLesson] = useState<Lesson | undefined>(firstLesson)

  // Прогресс из SCORM: обновляем прогресс курса и отмечаем урок пройденным.
  const handleScormStatus = (s: ScormStatus) => {
    if (!course || !activeLesson) return
    const current = course.progress ?? 0
    const next = Math.max(current, s.progress)
    const courseLesson = course.modules.flatMap((m) => m.lessons).find((l) => l.id === activeLesson.id)
    const needComplete = s.completed && !courseLesson?.completed
    if (next <= current && !needComplete) return
    const modules = s.completed
      ? course.modules.map((m) => ({
          ...m,
          lessons: m.lessons.map((l) => (l.id === activeLesson.id ? { ...l, completed: true } : l)),
        }))
      : course.modules
    void updateCourse(course.id, { progress: next, modules })
  }

  if (!course) {
    return (
      <Container className="py-24 text-center">
        <h1 className="font-serif text-3xl text-neft">Курс не найден</h1>
        <Button to="/courses" className="mt-8">К каталогу</Button>
      </Container>
    )
  }

  // Актуальный статус активного урока (из каталога, обновляется после SCORM).
  const activeLessonFresh = course.modules
    .flatMap((m) => m.lessons)
    .find((l) => l.id === activeLesson?.id)
  const lessonDone = activeLessonFresh?.completed ?? false

  return (
    <div>
      {/* Шапка курса */}
      <section className="relative overflow-hidden border-b border-ink-10 bg-neft text-wisdom">
        <div className="brand-pattern absolute inset-0 opacity-[0.05]" />
        <Container className="relative py-16 md:py-20">
          <Link to="/courses" className="text-sm text-wisdom/50 hover:text-wisdom">← Каталог</Link>
          <div className="mt-6 grid gap-10 lg:grid-cols-[1.4fr_0.6fr] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ocean">{courseFormatLabel[course.format]}</Badge>
                <Badge tone="dark" className="ring-1 ring-wisdom/20">{course.level}</Badge>
              </div>
              <h1 className="mt-5 font-serif text-4xl leading-tight md:text-5xl">{displayTitle(course.title)}</h1>
              <p className="mt-4 max-w-2xl text-lg text-wisdom/70">{course.subtitle}</p>
              {course.description && (
                <p className="mt-4 max-w-3xl leading-relaxed text-wisdom/60">{course.description}</p>
              )}
              <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-wisdom/60">
                {course.instructor && <span>Преподаватель: {course.instructor}</span>}
                {course.curator && <span>Куратор кафедры: {course.curator}</span>}
                <span>{formatDuration(course.durationHours)}</span>
                <span>{course.lessonsCount} уроков</span>
              </div>
              {course.tags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {course.tags.map((t) => (
                    <Badge key={t} tone="dark" className="ring-1 ring-wisdom/20">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden justify-end lg:flex">
              <Crest className="h-28 w-28" onDark />
            </div>
          </div>
        </Container>
      </section>

      <Container className="py-14 md:py-20">
        {/* Контент урока / превью — на всю ширину, чтобы SCORM-пакету хватало
            места показать собственную панель с содержанием и прогрессом. */}
        {activeLesson && (
          <section className="mb-12">
            <h2 className="mb-4 font-serif text-2xl text-neft">
              {owned ? 'Обучение' : 'Предпросмотр материалов'}
            </h2>
            {owned ? (
              <div className="space-y-4">
                {lessonDone && (
                  <div className="flex items-center gap-3 rounded-card border border-ocean/30 bg-oceanc-10 px-5 py-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ocean text-wisdom">
                      <Check width={16} height={16} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-neft">Тренинг пройден</p>
                      <p className="text-[0.78rem] text-ink-60">Урок «{activeLesson.title}» завершён.</p>
                    </div>
                  </div>
                )}
                <LessonPlayer
                  lesson={activeLesson}
                  student={{ id: user?.id ?? 'guest', name: user?.name || 'Слушатель' }}
                  onScormStatus={handleScormStatus}
                />
              </div>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center rounded-card border border-dashed border-ink-20 bg-ink-5 text-center">
                <Lock width={30} height={30} className="text-ink-40" />
                <p className="mt-4 max-w-sm text-sm text-ink-60">
                  {isAuthenticated
                    ? 'Материалы курса откроются после оплаты — здесь доступно только описание программы.'
                    : 'Материалы курса доступны после входа в личный кабинет и оплаты — здесь доступно только описание программы.'}
                </p>
                {isAuthenticated ? (
                  <Button to={`/checkout?course=${course.id}`} size="sm" className="mt-5">
                    {course.price === 0 ? 'Получить доступ' : `Купить за ${formatPrice(course.price)}`}
                  </Button>
                ) : (
                  <Button to="/login" state={{ from: `/courses/${course.id}` }} size="sm" className="mt-5">
                    Войти в личный кабинет
                  </Button>
                )}
              </div>
            )}
          </section>
        )}

        <div className="grid gap-12 lg:grid-cols-[1.5fr_0.9fr]">
          {/* Основная колонка */}
          <div className="space-y-12">
            {/* Программа */}
            <section>
              <h2 className="mb-5 font-serif text-2xl text-neft">Программа курса</h2>
              <div className="space-y-6">
                {course.modules.map((module) => (
                  <div key={module.id}>
                    <p className="mb-2 text-[0.72rem] uppercase tracking-wide text-ink-60">{module.title}</p>
                    <ul className="overflow-hidden rounded-card border border-ink-10">
                      {module.lessons.map((lesson) => {
                        const selectable = owned
                        const isActive = activeLesson?.id === lesson.id
                        return (
                          <li key={lesson.id}>
                            <button
                              disabled={!selectable}
                              onClick={() => setActiveLesson(lesson)}
                              className={cn(
                                'flex w-full items-center gap-3 border-b border-ink-10 px-4 py-3 text-left last:border-b-0 transition-colors',
                                isActive && selectable ? 'bg-ink-5' : 'hover:bg-ink-5',
                                !selectable && 'cursor-default',
                              )}
                            >
                              <span className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-ink-40',
                                lesson.completed ? 'border-ocean bg-oceanc-10 text-ocean' : 'border-ink-20',
                              )}>
                                {lesson.completed ? <Check width={14} height={14} /> : <Book width={13} height={13} />}
                              </span>
                              <span className="min-w-0 flex-1 text-sm text-neft">{lesson.title}</span>
                              <span className="shrink-0"><Badge tone="outline">{courseFormatLabel[lesson.format]}</Badge></span>
                              <span className="hidden w-16 shrink-0 text-right text-xs text-ink-40 sm:block">{lesson.duration}</span>
                              {!owned && <Lock width={14} height={14} className="text-ink-40" />}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Боковая колонка */}
          <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <Card>
              <CardBody>
                {owned ? (
                  <>
                    <p className="eyebrow mb-4">Ваш прогресс</p>
                    <ProgressBar value={course.progress} showLabel />
                    <Button fullWidth className="mt-6">
                      Продолжить обучение
                    </Button>
                    {course.surveyId && (
                      <Button to={`/surveys/${course.surveyId}`} variant="secondary" fullWidth className="mt-3">
                        Пройти опрос
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {isAuthenticated && accessStale && (
                      <div className="mb-6 rounded-token border border-ink-20 bg-ink-5 px-4 py-3 text-sm text-neft">
                        Не удалось проверить доступ к программе — похоже, связь с сервером. Если
                        программа уже оплачена, не платите второй раз: обновите проверку.
                        <button
                          type="button"
                          onClick={() => void refreshAccess()}
                          disabled={accessLoading}
                          className="mt-3 block text-sm text-ocean underline underline-offset-4 disabled:opacity-60"
                        >
                          {accessLoading ? 'Проверяем…' : 'Проверить доступ ещё раз'}
                        </button>
                      </div>
                    )}
                    <p className="eyebrow mb-2">Стоимость</p>
                    <p className="font-serif text-4xl font-light text-neft">{formatPrice(course.price)}</p>
                    <p className="mt-2 text-sm text-ink-60">
                      {isAuthenticated
                        ? 'Полный доступ к материалам курса навсегда.'
                        : 'Полный доступ к материалам курса навсегда — после входа и оплаты.'}
                    </p>
                    {isAuthenticated ? (
                      <Button to={`/checkout?course=${course.id}`} fullWidth size="lg" className="mt-6">
                        <Lock width={16} height={16} /> {course.price === 0 ? 'Получить доступ' : 'Купить курс'}
                      </Button>
                    ) : (
                      <Button
                        to="/login"
                        state={{ from: `/courses/${course.id}` }}
                        fullWidth
                        size="lg"
                        className="mt-6"
                      >
                        <Lock width={16} height={16} /> Войти и оформить доступ
                      </Button>
                    )}
                    <ul className="mt-6 space-y-2 text-sm text-ink-60">
                      <li className="flex gap-2"><Check width={16} height={16} className="text-ocean" /> {course.lessonsCount} уроков</li>
                      <li className="flex gap-2"><Check width={16} height={16} className="text-ocean" /> Видео, лонгриды, тренинги</li>
                      <li className="flex gap-2"><Check width={16} height={16} className="text-ocean" /> Сертификат МАБЛ</li>
                    </ul>
                  </>
                )}
              </CardBody>
            </Card>
          </aside>
        </div>
      </Container>
    </div>
  )
}
