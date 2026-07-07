import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ArrowUpRight, Clipboard } from '@/components/ui/Icon'
import { AdminPageHeader } from '@/components/admin/AdminUI'
import { api } from '@/api'
import type { ScormPackage } from '@/api'
import { useCourses } from '@/context/CoursesContext'
import { formatDateTime } from '@/lib/utils'
import type { Course } from '@/types'

/** Загрузка и управление SCORM-пакетами. */
export default function AdminScormPage() {
  const navigate = useNavigate()
  const { addCourse } = useCourses()
  const [packages, setPackages] = useState<ScormPackage[]>([])
  const [busy, setBusy] = useState(false)
  const [creatingId, setCreatingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = async () => setPackages(await api.scorm.list())

  useEffect(() => {
    refresh()
  }, [])

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await api.scorm.upload(file)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить пакет')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onCreateCourse = async (pkg: ScormPackage) => {
    if (creatingId) return
    setError('')
    setCreatingId(pkg.id)
    const draft: Course = {
      id: '',
      title: pkg.title,
      subtitle: 'Интерактивный SCORM-тренинг',
      description: 'Загруженный SCORM-пакет. Отредактируйте описание программы при необходимости.',
      format: 'scorm',
      level: 'Базовый',
      instructor: 'МАБЛ',
      durationHours: 1,
      lessonsCount: 1,
      price: 0,
      progress: 0,
      tags: ['SCORM', 'Тренинг'],
      modules: [
        {
          id: 'm1',
          title: 'Модуль 1',
          lessons: [
            {
              id: `${pkg.id}-sco`,
              title: pkg.title,
              format: 'scorm',
              duration: '—',
              launchUrl: pkg.launchUrl,
            },
          ],
        },
      ],
    }
    try {
      const id = await addCourse(draft)
      navigate(`/admin/courses/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать курс из пакета')
    } finally {
      setCreatingId(null)
    }
  }

  const onRemove = async (pkg: ScormPackage) => {
    if (window.confirm(`Удалить пакет «${pkg.title}»? Курсы со ссылкой на него перестанут работать.`)) {
      await api.scorm.remove(pkg.id)
      await refresh()
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="SCORM-пакеты"
        description="Загрузите .zip с SCORM-пакетом (1.2). Пакет распаковывается и становится доступен для подключения к программе."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={onUpload}
            />
            <Button onClick={() => fileRef.current?.click()} size="sm" disabled={busy}>
              {busy ? 'Загрузка…' : '+ Загрузить SCORM (.zip)'}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mt-6 rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
          {error}
        </div>
      )}

      {packages.length > 0 ? (
        <div className="mt-8 overflow-hidden rounded-card border border-ink-10">
          <div className="hidden grid-cols-12 gap-4 border-b border-ink-10 bg-ink-5 px-5 py-3 text-[0.68rem] uppercase tracking-wide text-ink-60 md:grid">
            <span className="col-span-5">Пакет</span>
            <span className="col-span-3">Загружен</span>
            <span className="col-span-4 text-right">Действия</span>
          </div>
          <ul className="divide-y divide-ink-10">
            {packages.map((pkg) => (
              <li
                key={pkg.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="min-w-0 md:col-span-5">
                  <p className="truncate font-serif text-lg text-neft">{pkg.title}</p>
                  <p className="text-[0.74rem] text-ink-60">{pkg.fileCount} файлов</p>
                </div>
                <div className="text-sm text-ink-60 md:col-span-3">{formatDateTime(pkg.uploadedAt)}</div>
                <div className="flex flex-wrap gap-1 md:col-span-4 md:flex-nowrap md:justify-end">
                  <a
                    href={pkg.launchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-60 hover:bg-ink-5 hover:text-neft"
                  >
                    Открыть <ArrowUpRight width={14} height={14} />
                  </a>
                  <Button
                    onClick={() => onCreateCourse(pkg)}
                    variant="ghost"
                    size="sm"
                    disabled={creatingId !== null}
                  >
                    {creatingId === pkg.id ? 'Создаём…' : 'Создать курс'}
                  </Button>
                  <button
                    onClick={() => onRemove(pkg)}
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
        <div className="mt-8 rounded-card border border-dashed border-ink-20 py-20 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ink-5 text-ink-60">
            <Clipboard width={24} height={24} />
          </span>
          <p className="mt-4 font-serif text-xl text-neft">Пока нет загруженных пакетов</p>
          <p className="mt-2 text-ink-60">Загрузите .zip с SCORM-пакетом, чтобы подключить его к программе.</p>
          <Button onClick={() => fileRef.current?.click()} size="sm" className="mt-6" disabled={busy}>
            {busy ? 'Загрузка…' : '+ Загрузить SCORM (.zip)'}
          </Button>
        </div>
      )}
    </div>
  )
}
