import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Crest } from '@/components/brand/Crest'
import { Check, Lock } from '@/components/ui/Icon'
import { useCourses } from '@/context/CoursesContext'
import { usePurchases } from '@/context/PurchaseContext'
import { useAuth } from '@/context/AuthContext'
import { formatPrice, formatDuration, displayTitle } from '@/lib/utils'
import { courseFormatLabel } from '@/lib/labels'

/** Незавершённый платёж: номер заказа и ссылка на форму ЮKassa. */
interface PendingPayment {
  orderId: string
  url: string
  at: number
}

/** Ссылка живёт ограниченное время — старую показывать бессмысленно. */
const PENDING_TTL_MS = 6 * 60 * 60 * 1000

function pendingKey(courseId: string): string {
  return `mabl.pending.payment.${courseId}`
}

function loadPending(courseId: string): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(courseId))
    if (!raw) return null
    const value = JSON.parse(raw) as PendingPayment
    if (!value?.url || !value.orderId) return null
    if (Date.now() - value.at > PENDING_TTL_MS) {
      sessionStorage.removeItem(pendingKey(courseId))
      return null
    }
    return value
  } catch {
    return null
  }
}

function savePending(courseId: string, value: PendingPayment): void {
  try {
    sessionStorage.setItem(pendingKey(courseId), JSON.stringify(value))
  } catch {
    /* хранилище недоступно — не критично */
  }
}

function clearPending(courseId: string): void {
  try {
    sessionStorage.removeItem(pendingKey(courseId))
  } catch {
    /* хранилище недоступно — не критично */
  }
}

export default function CheckoutPage() {
  const [params] = useSearchParams()
  const courseId = params.get('course') || ''
  const returnOrderId = params.get('order') || ''
  const { getCourseById } = useCourses()
  const course = getCourseById(courseId)
  const { canAccessCourse, refreshAccess } = usePurchases()
  const { user, isAuthenticated } = useAuth()

  const [email, setEmail] = useState(user?.email || '')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  // Созданный, но не оплаченный платёж: браузер уходит на форму ЮKassa, и если
  // она не открылась (нет сети до yoomoney.ru, закрыли вкладку), ссылка не
  // должна потеряться — держим её здесь же.
  const [pending, setPending] = useState<PendingPayment | null>(() => loadPending(courseId))
  const [checking, setChecking] = useState(false)
  // Состояние возврата с платёжной формы ЮKassa.
  const [returnState, setReturnState] = useState<'idle' | 'checking' | 'pending' | 'done'>(
    returnOrderId ? 'checking' : 'idle',
  )

  const alreadyOwned = useMemo(() => (course ? canAccessCourse(course) : false), [course, canAccessCourse])

  // E-mail подставляем из профиля, как только сессия восстановлена.
  useEffect(() => {
    if (user?.email) setEmail((prev) => prev || user.email)
  }, [user?.email])

  // Возврат с ЮKassa: подтверждаем оплату по номеру заказа.
  useEffect(() => {
    if (!returnOrderId) return
    let active = true
    setReturnState('checking')
    api.payments
      .statusByOrder(returnOrderId)
      .then(async (res) => {
        if (!active) return
        if (res.paid) {
          await refreshAccess()
          clearPending(courseId)
          if (active) setReturnState('done')
        } else {
          setReturnState('pending')
        }
      })
      .catch(() => active && setReturnState('pending'))
    return () => {
      active = false
    }
  }, [returnOrderId, courseId, refreshAccess])

  if (!course) {
    return (
      <Container className="py-24 text-center">
        <h1 className="font-serif text-3xl text-neft">Курс не найден</h1>
        <p className="mt-4 text-ink-60">Выберите программу в каталоге.</p>
        <Button to="/courses" className="mt-8">К каталогу</Button>
      </Container>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setProcessing(true)
    try {
      const result = await api.payments.pay({
        itemId: course.id,
        itemTitle: course.title,
        amount: course.price,
        currency: 'RUB',
        customerEmail: email,
      })
      if (result.status !== 'redirect') {
        setError(result.message)
        return
      }
      // Ссылку сохраняем до перехода: если форма не откроется, человек вернётся
      // на эту страницу и сможет открыть её заново или проверить оплату.
      if (result.confirmationUrl) {
        const info: PendingPayment = {
          orderId: result.orderId,
          url: result.confirmationUrl,
          at: Date.now(),
        }
        savePending(courseId, info)
        setPending(info)
      }
    } catch {
      setError('Не удалось перейти к оплате. Попробуйте ещё раз.')
    } finally {
      setProcessing(false)
    }
  }

  // Проверить оплату по сохранённому заказу, не дожидаясь возврата с формы.
  const checkPending = async () => {
    if (!pending) return
    setChecking(true)
    setError('')
    try {
      const res = await api.payments.statusByOrder(pending.orderId)
      if (res.paid) {
        await refreshAccess()
        clearPending(courseId)
        setPending(null)
        setReturnState('done')
      } else {
        setError('Платёж пока не подтверждён. Если вы его не завершили — откройте страницу оплаты.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось проверить платёж.')
    } finally {
      setChecking(false)
    }
  }

  const cancelPending = () => {
    clearPending(courseId)
    setPending(null)
    setError('')
  }

  // Оплатить программу может только авторизованный слушатель: доступ
  // привязывается к аккаунту, а не к браузеру.
  if (!isAuthenticated) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
            <Lock width={28} height={28} />
          </span>
          <h1 className="mt-6 font-serif text-3xl text-neft">Войдите в личный кабинет</h1>
          <p className="mt-3 text-ink-60">
            Доступ к программе «{displayTitle(course.title)}» открывается в вашем личном кабинете,
            поэтому оплата возможна только после входа. Если аккаунта ещё нет — зарегистрируйтесь,
            это займёт минуту.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button to="/login" state={{ from: `/checkout?course=${course.id}` }}>
              Войти или зарегистрироваться
            </Button>
            <Button to={`/courses/${course.id}`} variant="secondary">К описанию программы</Button>
          </div>
        </div>
      </Container>
    )
  }

  // Экран возврата с ЮKassa, пока статус оплаты не подтверждён.
  if ((returnState === 'checking' || returnState === 'pending') && !alreadyOwned) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10 text-center">
          <h1 className="font-serif text-3xl text-neft">
            {returnState === 'checking' ? 'Проверяем оплату…' : 'Платёж обрабатывается'}
          </h1>
          <p className="mt-3 text-ink-60">
            {returnState === 'checking'
              ? 'Подтверждаем статус платежа в ЮKassa. Это займёт несколько секунд.'
              : 'Платёж ещё не подтверждён. Если средства списаны, доступ откроется автоматически в течение нескольких минут.'}
          </p>
          {returnState === 'pending' && (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button onClick={() => window.location.reload()}>Проверить ещё раз</Button>
              <Button to="/dashboard" variant="secondary">В личный кабинет</Button>
            </div>
          )}
        </div>
      </Container>
    )
  }

  // Экран успеха
  if (returnState === 'done' || alreadyOwned) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
            <Check width={32} height={32} />
          </span>
          <h1 className="mt-6 font-serif text-3xl text-neft">Доступ открыт</h1>
          <p className="mt-3 text-ink-60">
            Курс «{displayTitle(course.title)}» добавлен в ваш личный кабинет. Можно приступать к обучению.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button to={`/courses/${course.id}`}>Перейти к курсу</Button>
            <Button to="/dashboard" variant="secondary">
              В личный кабинет
            </Button>
          </div>
        </div>
      </Container>
    )
  }

  return (
    <Container className="py-12 md:py-16">
      <Link to="/courses" className="text-sm text-ink-60 hover:text-neft">← Назад к каталогу</Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_0.85fr]">
        {/* Платёжная форма */}
        <div>
          <p className="eyebrow mb-3">Оформление доступа</p>
          <h1 className="font-serif text-3xl text-neft">Оплата курса</h1>
          <p className="mt-3 max-w-md text-ink-60">
            Оплата проходит на защищённой странице ЮKassa. После подтверждения платежа доступ
            к программе откроется в вашем личном кабинете автоматически.
          </p>

          {pending && (
            <div className="mt-8 rounded-card border border-ocean/30 bg-oceanc-10 p-5">
              <p className="text-sm font-semibold text-neft">Платёж уже создан · заказ {pending.orderId}</p>
              <p className="mt-1.5 text-sm text-ink-60">
                Если страница оплаты не открылась, откройте её по ссылке — например, с телефона.
                Ссылка действует несколько часов. Уже оплатили — нажмите «Проверить оплату».
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => window.location.assign(pending.url)}>
                  Открыть страницу оплаты
                </Button>
                <Button size="sm" variant="secondary" disabled={checking} onClick={() => void checkPending()}>
                  {checking ? 'Проверяем…' : 'Проверить оплату'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelPending}>
                  Оформить заново
                </Button>
              </div>
              <p className="mt-3 break-all text-[0.72rem] text-ink-40">{pending.url}</p>
            </div>
          )}

          <form onSubmit={submit} className="mt-8 space-y-5">
            <Input
              label="E-mail для чека и доступа"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              hint="На этот адрес ЮKassa отправит кассовый чек."
            />

            {error && (
              <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" fullWidth disabled={processing}>
              <Lock width={16} height={16} />
              {processing ? 'Переходим к оплате…' : `Перейти к оплате · ${formatPrice(course.price)}`}
            </Button>
            <p className="text-center text-[0.72rem] text-ink-40">
              Нажимая «Перейти к оплате», вы принимаете <Link to="/offer" className="underline hover:text-ink-80">публичную оферту</Link>, <Link to="/privacy" className="underline hover:text-ink-80">политику конфиденциальности</Link> и даёте <Link to="/consent-personal-data" className="underline hover:text-ink-80">согласие на обработку персональных данных</Link> МАБЛ.
            </p>
          </form>
        </div>

        {/* Сводка заказа */}
        <aside className="lg:pt-16">
          <div className="overflow-hidden rounded-card border border-ink-10">
            <div className="relative flex items-center gap-4 bg-neft p-6 text-wisdom">
              <div className="brand-pattern absolute inset-0 opacity-[0.08]" />
              <Crest className="relative h-14 w-14" onDark />
              <div className="relative">
                <p className="text-[0.7rem] uppercase tracking-wide text-wisdom/50">Программа</p>
                <p className="font-serif text-lg leading-tight">{displayTitle(course.title)}</p>
              </div>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex items-center gap-2">
                <Badge tone="ocean">{courseFormatLabel[course.format]}</Badge>
                <Badge tone="outline">{course.level}</Badge>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-ink-60">Преподаватель</dt><dd className="text-neft">{course.instructor}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-60">Объём</dt><dd className="text-neft">{formatDuration(course.durationHours)} · {course.lessonsCount} уроков</dd></div>
              </dl>
              <div className="flex items-center justify-between border-t border-ink-10 pt-4">
                <span className="text-sm uppercase tracking-wide text-ink-60">Итого</span>
                <span className="font-serif text-2xl text-neft">{formatPrice(course.price)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </Container>
  )
}
