import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Check } from '@/components/ui/Icon'
import { useAuth } from '@/context/AuthContext'

interface Props {
  programId: string
  programTitle: string
}

/**
 * Форма «Оставить заявку» на странице программы.
 *
 * Заявка уходит на бэкенд (`POST /api/applications`) и попадает в админ-панель
 * приёмной комиссии. Работает и для гостя, и для авторизованного слушателя —
 * у второго поля имени и e-mail подставляются из профиля.
 */
export function ApplicationForm({ programId, programTitle }: Props) {
  const { user } = useAuth()
  // Корень формы/подтверждения — нужен, чтобы вернуть блок в поле зрения
  // после отправки. Callback-ref, потому что элемент меняется (form → div).
  const rootRef = useRef<HTMLElement | null>(null)

  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  // Сессия восстанавливается асинхронно — подставляем профиль, когда он готов,
  // не затирая уже введённые вручную значения.
  useEffect(() => {
    if (user?.name) setName((prev) => prev || user.name)
    if (user?.email) setEmail((prev) => prev || user.email)
  }, [user?.name, user?.email])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError('Заполните имя, e-mail и телефон — по ним с вами свяжется приёмная комиссия.')
      return
    }
    if (phone.replace(/\D/g, '').length < 10) {
      setError('Укажите номер телефона полностью, с кодом города или оператора.')
      return
    }
    if (!consent) {
      setError('Для отправки заявки нужно согласие на обработку персональных данных.')
      return
    }

    setSending(true)
    try {
      await api.applications.create({
        programId,
        programTitle,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        comment: comment.trim() || undefined,
      })
      setSent(true)
      // Форма схлопывается до короткого подтверждения — возвращаем его в поле
      // зрения, иначе экран остаётся прокрученным на пустое место.
      requestAnimationFrame(() =>
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось отправить заявку. Попробуйте ещё раз или напишите нам на почту.',
      )
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div ref={(el) => (rootRef.current = el)} className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
          <Check width={26} height={26} />
        </span>
        <h3 className="mt-5 font-serif text-2xl text-neft">Заявка отправлена</h3>
        <p className="mx-auto mt-3 max-w-md text-ink-60">
          Приёмная комиссия свяжется с вами по указанным контактам и расскажет о ближайшем
          наборе на программу «{programTitle}».
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false)
            setPhone('')
            setComment('')
            setConsent(false)
          }}
          className="mt-6 text-[0.72rem] uppercase tracking-wide text-ink-60 underline hover:text-neft"
        >
          Оставить ещё одну заявку
        </button>
      </div>
    )
  }

  return (
    <form
      ref={(el) => (rootRef.current = el)}
      onSubmit={submit}
      className="text-left"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Имя и фамилия"
          name="application-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Иван Иванов"
        />
        <Input
          label="Телефон"
          name="application-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+7 900 000-00-00"
        />
      </div>
      <div className="mt-4">
        <Input
          label="E-mail"
          name="application-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.ru"
        />
      </div>
      <div className="mt-4">
        <Textarea
          label="Комментарий (необязательно)"
          name="application-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Расскажите о задачах, которые хотите решить на программе"
          className="min-h-[96px]"
        />
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[0.78rem] leading-relaxed text-ink-60">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-ocean"
        />
        <span>
          Я даю{' '}
          <Link to="/consent-personal-data" className="underline hover:text-ink-80">
            согласие на обработку персональных данных
          </Link>{' '}
          и принимаю{' '}
          <Link to="/privacy" className="underline hover:text-ink-80">
            политику конфиденциальности
          </Link>{' '}
          МАБЛ.
        </span>
      </label>

      {error && <p className="mt-4 text-[0.8rem] text-ocean">{error}</p>}

      <Button type="submit" size="lg" fullWidth className="mt-6" disabled={sending}>
        {sending ? 'Отправляем…' : 'Отправить заявку'}
      </Button>
    </form>
  )
}
