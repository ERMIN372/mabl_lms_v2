import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Карусель изображений: автолистание, стрелки, точки и свайп на тач-устройствах.
 * Высота подстраивается под текущее фото (без чёрных полей по бокам), картинка
 * показывается целиком — без обрезки.
 */
export function Carousel({
  images,
  className,
  interval = 5000,
}: {
  images: string[]
  className?: string
  interval?: number
}) {
  const [index, setIndex] = useState(0)
  const count = images.length
  const touchStartX = useRef<number | null>(null)

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count])
  const next = useCallback(() => go(index + 1), [go, index])
  const prev = useCallback(() => go(index - 1), [go, index])

  // Автолистание; таймер перезапускается при любой смене кадра.
  useEffect(() => {
    if (count <= 1) return
    const t = setTimeout(() => setIndex((p) => (p + 1) % count), interval)
    return () => clearTimeout(t)
  }, [count, index, interval])

  if (count === 0) return null

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 40) (dx < 0 ? next : prev)()
    touchStartX.current = null
  }

  const arrowClass =
    'absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-neft/70 text-3xl leading-none text-wisdom shadow-lg ring-1 ring-wisdom/30 backdrop-blur transition hover:bg-neft hover:scale-105'

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-card',
        className,
      )}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <img
        key={index}
        src={images[index]}
        alt=""
        className="block aspect-video w-full object-cover animate-fadeIn"
      />

      {count > 1 && (
        <>
          <button type="button" aria-label="Предыдущее фото" onClick={prev} className={cn(arrowClass, 'left-3 pb-1 pr-0.5')}>
            ‹
          </button>
          <button type="button" aria-label="Следующее фото" onClick={next} className={cn(arrowClass, 'right-3 pb-1 pl-0.5')}>
            ›
          </button>

          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
            {images.map((_, i) => (
              <button
                type="button"
                key={i}
                aria-label={`Фото ${i + 1}`}
                onClick={() => go(i)}
                className={cn(
                  'h-2 rounded-full shadow ring-1 ring-neft/20 transition-all',
                  i === index ? 'w-5 bg-wisdom' : 'w-2 bg-wisdom/70 hover:bg-wisdom',
                )}
              />
            ))}
          </div>

          <div className="absolute right-3 top-3 rounded-full bg-neft/70 px-2.5 py-1 text-[0.65rem] font-semibold text-wisdom backdrop-blur">
            {index + 1}/{count}
          </div>
        </>
      )}
    </div>
  )
}
