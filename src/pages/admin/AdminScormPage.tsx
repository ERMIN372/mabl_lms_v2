import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ArrowUpRight, Clipboard } from '@/components/ui/Icon'
import { AdminPageHeader } from '@/components/admin/AdminUI'
import { api } from '@/api'
import type { ScormPackage, ScormDiagnostics } from '@/api'
import { useCourses } from '@/context/CoursesContext'
import { formatDateTime } from '@/lib/utils'
import type { Course } from '@/types'

/** Наглядный вывод серверной диагностики пакета. */
function DiagnosticsPanel({ report }: { report: ScormDiagnostics }) {
  const allOk = !report.listError && report.failed.length === 0 && report.fileCount > 0
  return (
    <div className="mt-2 rounded-token border border-ink-10 bg-ink-5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-70">
        <span>
          Авторизация хранилища: <b>{report.mode === 'none' ? 'нет' : report.mode.toUpperCase()}</b>
        </span>
        <span>
          Файлов: <b>{report.fileCount}</b>, доступно: <b>{report.okCount}</b>, ошибок:{' '}
          <b className={report.failed.length ? 'text-ocean' : ''}>{report.failed.length}</b>
        </span>
        <span className="text-ink-50">({report.tookMs} мс)</span>
      </div>

      {report.listError && (
        <p className="mt-2 font-semibold text-ocean">
          Не удалось получить список файлов из хранилища: {report.listError}
        </p>
      )}

      {allOk && (
        <p className="mt-2 font-semibold text-emerald-600">
          Все файлы пакета отдаются сервером. Если курс не открывается — очистите кэш
          (Ctrl+Shift+R) или отключите service worker.
        </p>
      )}

      {report.failed.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 font-semibold text-ocean">Не отдаются:</p>
          <ul className="space-y-0.5 font-mono text-[0.72rem] text-ink-70">
            {report.failed.slice(0, 20).map((f: ScormDiagnostics['failed'][number]) => (
              <li key={f.path}>
                {f.path} — {f.sizeKb} КБ — {f.via} — статус {String(f.status)}
              </li>
            ))}
            {report.failed.length > 20 && <li>…ещё {report.failed.length - 20}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Загрузка и управление SCORM-пакетами. */
export default function AdminScormPage() {
  const navigate = useNavigate()
  const { addCourse } = useCourses()
  const [packages, setPackages] = useState<ScormPackage[]>([])
  // Доступность пакета в серверном хранилище: id → доступен ли launch-файл.
  // Ловит пакеты, оставшиеся только в кэше браузера загрузившего (старый формат):
  // у админа такой пакет открывался, а у остальных пользователей — нет.
  const [available, setAvailable] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [creatingId, setCreatingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Результаты серверной диагностики пакета: id → отчёт (или 'loading').
  const [diag, setDiag] = useState<Record<string, ScormDiagnostics | 'loading'>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadLabel = busy
    ? progress
      ? `Загрузка ${progress.done}/${progress.total}…`
      : 'Загрузка…'
    : '+ Загрузить SCORM (.zip)'

  const refresh = async () => {
    const list = await api.scorm.list()
    setPackages(list)
    const checks = await Promise.all(
      list.map(async (pkg) => {
        try {
          const resp = await fetch(pkg.launchUrl, { cache: 'no-store' })
          return [pkg.id, resp.ok] as const
        } catch {
          return [pkg.id, false] as const
        }
      }),
    )
    setAvailable(Object.fromEntries(checks))
  }

  useEffect(() => {
    refresh()
  }, [])

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setProgress(null)
    setError('')
    try {
      await api.scorm.upload(
        file,
        (done, total) => setProgress({ done, total }),
        (id) =>
          window.confirm(
            `Пакет «${id}» уже загружен. Заменить его файлы новой версией? ` +
              'Курсы, использующие пакет, продолжат работать с обновлёнными материалами. ' +
              'Нажмите «Отмена», чтобы сохранить как отдельный новый пакет.',
          ),
      )
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить пакет')
    } finally {
      setBusy(false)
      setProgress(null)
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
      subtitle: 'Интерактивный тренинг',
      // Описание и куратор заполняются администратором на странице редактирования,
      // куда происходит переход сразу после создания курса.
      description: '',
      format: 'scorm',
      level: 'Базовый',
      instructor: 'МАБЛ',
      curator: '',
      durationHours: 1,
      lessonsCount: 1,
      price: 0,
      progress: 0,
      tags: ['Тренинг'],
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

  const onDiagnose = async (pkg: ScormPackage) => {
    setDiag((d) => ({ ...d, [pkg.id]: 'loading' }))
    try {
      const report = await api.scorm.diagnose(pkg.id)
      setDiag((d) => ({ ...d, [pkg.id]: report }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить диагностику')
      setDiag((d) => {
        const next = { ...d }
        delete next[pkg.id]
        return next
      })
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
              {uploadLabel}
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
                  {available[pkg.id] === false && (
                    <p className="mt-1 text-[0.74rem] font-semibold text-ocean">
                      Недоступен в серверном хранилище — у слушателей курс не открывается.
                      Загрузите этот пакет заново (файлы заменятся, курсы восстановятся).
                    </p>
                  )}
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
                  <Button
                    onClick={() => onDiagnose(pkg)}
                    variant="ghost"
                    size="sm"
                    disabled={diag[pkg.id] === 'loading'}
                  >
                    {diag[pkg.id] === 'loading' ? 'Проверяем…' : 'Диагностика'}
                  </Button>
                  <button
                    onClick={() => onRemove(pkg)}
                    className="whitespace-nowrap rounded-token px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ocean hover:bg-oceanc-10"
                  >
                    Удалить
                  </button>
                </div>

                {diag[pkg.id] && diag[pkg.id] !== 'loading' && (
                  <div className="md:col-span-12">
                    <DiagnosticsPanel report={diag[pkg.id] as ScormDiagnostics} />
                  </div>
                )}
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
            {uploadLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
