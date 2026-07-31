import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Grid } from '@/components/ui/Icon'
import { AdminPageHeader } from '@/components/admin/AdminUI'
import { useCourses } from '@/context/CoursesContext'
import { courseFormatLabel } from '@/lib/labels'
import { formatPrice } from '@/lib/utils'

/** Админ-панель: управление каталогом программ (список + действия). */
export default function AdminCoursesPage() {
  const { courses, deleteCourse } = useCourses()

  const onDelete = (id: string, title: string) => {
    if (window.confirm(`Удалить программу «${title}»? Действие необратимо.`)) {
      deleteCourse(id)
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Программы академии"
        description={`Всего программ: ${courses.length}. Создавайте, редактируйте и удаляйте курсы каталога.`}
        actions={
          <Button to="/admin/courses/new" size="sm">
            + Добавить программу
          </Button>
        }
      />

      {courses.length > 0 ? (
        <div className="mt-10 overflow-hidden rounded-card border border-ink-10">
          {/* Шапка таблицы (десктоп) */}
          <div className="hidden grid-cols-12 gap-4 border-b border-ink-10 bg-ink-5 px-5 py-3 text-[0.68rem] uppercase tracking-wide text-ink-60 md:grid">
            <span className="col-span-4">Программа</span>
            <span className="col-span-2">Формат</span>
            <span className="col-span-2">Уровень</span>
            <span className="col-span-1 text-right">Цена</span>
            <span className="col-span-3 text-right">Действия</span>
          </div>

          <ul className="divide-y divide-ink-10">
            {courses.map((course) => (
              <li
                key={course.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="min-w-0 md:col-span-4">
                  <Link
                    to={`/admin/courses/${course.id}`}
                    className="font-serif text-lg text-neft hover:text-ocean"
                  >
                    {course.title}
                  </Link>
                  <p className="truncate text-sm text-ink-60">{course.subtitle}</p>
                </div>
                <div className="md:col-span-2">
                  <Badge tone="ocean">{courseFormatLabel[course.format]}</Badge>
                </div>
                <div className="text-sm text-ink-60 md:col-span-2">{course.level}</div>
                <div className="whitespace-nowrap text-sm text-neft md:col-span-1 md:text-right">
                  {formatPrice(course.price)}
                </div>
                <div className="flex flex-wrap gap-1 md:col-span-3 md:flex-nowrap md:justify-end">
                  <Button to={`/admin/courses/${course.id}`} variant="ghost" size="sm">
                    Изменить
                  </Button>
                  <button
                    onClick={() => onDelete(course.id, course.title)}
                    className="whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-10 rounded-card border border-dashed border-ink-20 py-20 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ink-5 text-ink-60">
            <Grid width={24} height={24} />
          </span>
          <p className="mt-4 font-serif text-xl text-neft">В каталоге пока нет программ</p>
          <p className="mt-2 text-ink-60">Добавьте первую программу — она сразу появится в каталоге.</p>
          <div className="mt-6 flex justify-center">
            <Button to="/admin/courses/new" size="sm">
              + Добавить программу
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
