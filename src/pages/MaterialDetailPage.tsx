import { Link, useParams } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Document } from '@/components/ui/Icon'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useCourses } from '@/context/CoursesContext'
import { formatDate } from '@/lib/utils'

export default function MaterialDetailPage() {
  const { id = '' } = useParams()
  const { getCourseById } = useCourses()
  const { data: material, loading } = useAsync(() => api.materials.get(id), [id])

  if (loading) {
    return <Container className="py-24 text-center text-ink-60">Загрузка…</Container>
  }

  if (!material) {
    return (
      <Container className="py-24 text-center">
        <h1 className="font-serif text-3xl text-neft">Материал не найден</h1>
        <Button to="/materials" className="mt-8">К библиотеке</Button>
      </Container>
    )
  }

  const course = material.courseId ? getCourseById(material.courseId) : undefined
  // downloadUrl отдаёт файл вложением; fileUrl — запасной вариант для
  // материалов, загруженных до появления отдельной ссылки на скачивание.
  const downloadUrl = material.fileDownloadUrl ?? material.fileUrl

  return (
    <article className="py-14 md:py-20">
      <Container className="max-w-3xl">
        <Link to="/materials" className="text-sm text-ink-60 hover:text-neft">← Материалы</Link>

        <div className="mt-6 flex items-start gap-5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-card border border-ink-10 text-ocean">
            <Document width={26} height={26} />
          </span>
          <div>
            <Badge tone="neutral">{material.type}</Badge>
            <h1 className="mt-3 font-serif text-3xl leading-tight text-neft">{material.title}</h1>
            <p className="mt-2 text-[0.72rem] uppercase tracking-wide text-ink-40">
              {formatDate(material.date)} · {material.size}
            </p>
          </div>
        </div>

        <p className="mt-8 text-lg text-ink-80">{material.description}</p>

        <div className="mt-6 space-y-4 leading-relaxed text-ink-80">
          {material.body?.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          {/* Файл прикрепляется в админ-панели и лежит в хранилище (Blob).
              Пока его нет, материал читается прямо на странице. */}
          {downloadUrl ? (
            <Button href={downloadUrl} download={material.fileName}>
              Скачать материал
            </Button>
          ) : (
            <p className="text-sm text-ink-60">
              Файл для скачивания не прикреплён — материал доступен для чтения на этой странице.
            </p>
          )}
          {course && (
            <Button to={`/courses/${course.id}`} variant="secondary">
              К курсу «{course.title}»
            </Button>
          )}
        </div>
      </Container>
    </article>
  )
}
