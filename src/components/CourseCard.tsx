import { Link } from 'react-router-dom'
import type { Course } from '@/types'
import { Button } from './ui/Button'
import { ProgressBar } from './ui/ProgressBar'
import { ArrowRight, Lock } from './ui/Icon'
import { Badge } from './ui/Badge'
import { courseFormatLabel } from '@/lib/labels'
import { formatPrice, formatDuration, displayTitle, isFree, cn } from '@/lib/utils'
import { courses } from '@/data/courses'

interface CourseCardProps {
  course: Course
  owned: boolean
}

/**
 * Строгая обложка программы (строго по бренд-гайду): сплошная брендовая
 * плоскость + тонкая академическая рамка + крупная серифная монограмма.
 * Различается по программе цветом (Нефть/Океан), буквой, дисциплиной и номером.
 * Только бренд-палитра, без фото, градиентов и иллюстраций.
 */
function CourseCover({ course }: { course: Course }) {
  // Океан — для интерактива/чтения (SCORM, лонгрид), Нефть — для видео-программ
  const isOcean = course.format === 'scorm' || course.format === 'longread'
  const number = courses.findIndex((c) => c.id === course.id) + 1

  return (
    <Link
      to={`/courses/${course.id}`}
      className={cn(
        'relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-t-card text-wisdom',
        isOcean ? 'bg-ocean' : 'bg-neft',
      )}
    >
      {/* тонкая академическая рамка */}
      <span className="pointer-events-none absolute inset-4 border border-wisdom/20" />

      {/* название программы на брендовой плоскости */}
      <span className="relative line-clamp-3 px-10 text-center font-serif text-[1.35rem] font-light leading-tight text-wisdom">
        {displayTitle(course.title)}
      </span>

      {/* формат */}
      <span className="absolute left-4 top-4">
        <Badge tone={isOcean ? 'dark' : 'ocean'} className="ring-1 ring-wisdom/20">
          {courseFormatLabel[course.format]}
        </Badge>
      </span>

      {/* дисциплина и номер программы */}
      <span className="absolute bottom-3.5 left-5 text-[0.66rem] uppercase tracking-wide text-wisdom/55">
        {course.tags[0]}
      </span>
      <span className="absolute bottom-3.5 right-5 font-serif text-[0.72rem] uppercase tracking-wide text-wisdom/45">
        № {String(number).padStart(2, '0')}
      </span>
    </Link>
  )
}

/** Карточка курса для каталога и дашборда. */
export function CourseCard({ course, owned }: CourseCardProps) {
  return (
    <article className="group flex flex-col rounded-card border border-ink-10 bg-wisdom transition-colors duration-200 hover:border-ink-40">
      <CourseCover course={course} />

      <div className="flex flex-1 flex-col p-6">
        <div className="mb-3 flex items-center gap-2 text-[0.7rem] uppercase tracking-wide text-ink-60">
          <span>{course.level}</span>
          <span className="h-1 w-1 rounded-full bg-ink-20" />
          <span>{formatDuration(course.durationHours)}</span>
        </div>

        <p className="text-sm text-ink-60">
          <Link to={`/courses/${course.id}`} className="hover:text-ocean">
            {course.subtitle}
          </Link>
        </p>

        <div className="mt-4 flex-1" />

        {owned ? (
          <div className="space-y-4">
            <ProgressBar value={course.progress} showLabel />
            <Button to={`/courses/${course.id}`} variant="secondary" size="sm" fullWidth>
              {course.progress > 0 ? 'Продолжить' : 'Начать обучение'}
              <ArrowRight width={16} height={16} />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-t border-ink-10 pt-4">
            <span className="font-serif text-lg text-neft">{formatPrice(course.price)}</span>
            {isFree(course.price) ? (
              <Button to={`/checkout?course=${course.id}`} size="sm">
                Получить доступ
                <ArrowRight width={15} height={15} />
              </Button>
            ) : (
              <Button to={`/checkout?course=${course.id}`} size="sm">
                <Lock width={15} height={15} />
                Купить
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
