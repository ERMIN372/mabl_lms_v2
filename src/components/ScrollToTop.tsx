import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Прокрутка при смене маршрута.
 *
 * Обычный переход открывает страницу сверху. Если в адресе есть якорь
 * (`/programs/emba-hrd#apply`), браузер сам к нему не прокручивает — переход
 * внутри SPA не перезагружает документ, — поэтому доводим до нужной секции
 * вручную. Отступ под «липкой» шапкой задаётся классом `scroll-mt-*` секции.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}
