import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Crest } from '@/components/brand/Crest'
import { Check } from '@/components/ui/Icon'
import { api } from '@/api'
import { useAuth } from '@/context/AuthContext'

/**
 * Подтверждение e-mail шестизначным кодом из письма.
 * Открывается после регистрации и по ссылке из баннера в личном кабинете.
 */
export default function VerifyEmailPage() {
  const { user, isAuthenticated, isEmailVerified, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = (location.state as { from?: string })?.from || '/dashboard'

  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [done, setDone] = useState(false)
  // Пауза между повторными отправками кода.
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isEmailVerified && !done) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      await api.auth.verifyEmail(code)
      await refreshProfile()
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подтвердить код')
    } finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    setError('')
    setInfo('')
    setResending(true)
    try {
      setInfo(await api.auth.sendCode())
      setCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код')
      setCooldown(60)
    } finally {
      setResending(false)
    }
  }

  if (done) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
            <Check width={32} height={32} />
          </span>
          <h1 className="mt-6 font-serif text-3xl text-neft">E-mail подтверждён</h1>
          <p className="mt-3 text-ink-60">
            Адрес {user?.email} подтверждён. Теперь вы сможете восстановить пароль и будете получать
            письма о доступе к программам.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button onClick={() => navigate(next, { replace: true })}>Продолжить</Button>
          </div>
        </div>
      </Container>
    )
  }

  return (
    <Container className="py-20 md:py-28">
      <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10">
        <Crest className="mx-auto h-14 w-14" />
        <h1 className="mt-6 text-center font-serif text-3xl text-neft">Подтвердите e-mail</h1>
        <p className="mt-3 text-center text-ink-60">
          Мы отправили шестизначный код на <span className="text-neft">{user?.email}</span>.
          Он действует 15 минут.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <Input
            label="Код из письма"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="text-center text-lg tracking-[0.4em]"
            required
          />

          {error && (
            <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-token border border-ink-20 bg-ink-5 px-4 py-3 text-sm text-neft">
              {info}
            </div>
          )}

          <Button type="submit" fullWidth size="lg" disabled={loading || code.length !== 6}>
            {loading ? 'Проверяем…' : 'Подтвердить'}
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => void resend()}
            disabled={resending || cooldown > 0}
            className="text-ocean underline disabled:text-ink-40 disabled:no-underline"
          >
            {cooldown > 0
              ? `Отправить код повторно через ${cooldown} с`
              : resending
                ? 'Отправляем…'
                : 'Отправить код повторно'}
          </button>
          <Link to={next} className="text-ink-60 hover:text-neft">
            Пропустить пока
          </Link>
        </div>

        <p className="mt-6 border-t border-ink-10 pt-5 text-[0.72rem] leading-relaxed text-ink-40">
          Письмо не пришло за пару минут — проверьте папку «Спам». Если адрес указан с ошибкой,
          напишите в поддержку академии: адрес аккаунта меняет администратор.
        </p>
      </div>
    </Container>
  )
}
