/**
 * SCORM-пакеты, лежащие в репозитории (public/scorm/<id>/).
 *
 * Такие пакеты раздаёт сам Vercel как статику: без serverless-функций, без
 * Blob-хранилища, без лимитов на операции и без риска приостановки хранилища.
 * Это основной способ публикации курсов на бесплатном плане.
 *
 * Как добавить пакет:
 * 1) распаковать .zip в `public/scorm/<id>/` (id — латиницей, через дефис);
 * 2) добавить сюда запись: id, название, путь точки входа из imsmanifest.xml
 *    (обычно `res/index.html`) и число файлов (для информации в админке);
 * 3) закоммитить — после деплоя пакет появится в админке в разделе
 *    «Пакеты в репозитории», откуда из него создаётся курс.
 */

export interface RepoScormPackage {
  id: string
  title: string
  /** Путь точки входа внутри пакета, например `res/index.html`. */
  launch: string
  /** Число файлов в пакете — показывается в админке. */
  fileCount: number
}

export const repoScormPackages: RepoScormPackage[] = [
  {
    id: 'manager-intro',
    title: 'Эспрессо-тоник тропики',
    launch: 'res/index.html',
    fileCount: 48,
  },
]

/** URL точки входа пакета: статика, которую Vercel отдаёт напрямую. */
export function repoScormLaunchUrl(pkg: RepoScormPackage): string {
  return `/scorm/${pkg.id}/${pkg.launch}`
}
