import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { Crest } from '@/components/brand/Crest'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { safeRedirectPath } from '@/lib/utils'

/**
 * Подтверждение e-mail шестизначным кодом из письма.
 * Открывается сразу после регистрации и по ссылке из баннера в кабинете.
 *
 * Подтверждение не блокирует покупку программ — оно нужно, чтобы слушатель мог
 * восстановить пароль и получать письма о доступе.
 */
export default function VerifyEmailPage() {
  const { user, isAuthenticated, verifyEmail, resendCode } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as { from?: string; codeError?: string }
  const next = safeRedirectPath(state.from)

  const [code, setCode] = useState('')
  const [error, setError] = useState(state.codeError ?? '')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  // Пауза между повторными отправками: сервер всё равно не пришлёт чаще.
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.emailVerified) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      await verifyEmail(code)
      navigate(next, { replace: true })
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
      setInfo(await resendCode())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код')
    } finally {
      setResending(false)
      setCooldown(60)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Брендовая панель */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-neft p-12 text-wisdom lg:flex">
        <div className="brand-pattern absolute inset-0 opacity-[0.07]" />
        <div className="relative">
          <Logo onDark />
        </div>
        <div className="relative">
          <Crest withBanner className="mb-10 h-32 w-32" onDark />
          <h2 className="display-title text-4xl">Знать, чтобы лидировать</h2>
          <p className="mt-5 max-w-sm text-wisdom/60">
            Подтверждённый адрес нужен, чтобы восстановить доступ и получать письма об
            открытии программ.
          </p>
        </div>
        <p className="relative text-[0.72rem] uppercase tracking-wide text-wisdom/40">
          Sapere · Ducere
        </p>
      </div>

      {/* Форма */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>

          <p className="eyebrow mb-3">Регистрация</p>
          <h1 className="font-serif text-3xl text-neft">Подтвердите e-mail</h1>

          <form onSubmit={submit} className="mt-9 space-y-5">
            <p className="text-sm text-ink-60">
              Мы отправили шестизначный код на{' '}
              <span className="font-semibold text-neft">{user?.email}</span>. Он действует
              15 минут. Проверьте входящие и папку «Спам».
            </p>

            <Input
              label="Код из письма"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />

            {error && (
              <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-token border border-ink-20 bg-ink-5 px-4 py-3 text-sm text-ink-80">
                {info}
              </div>
            )}

            <Button type="submit" fullWidth size="lg" disabled={loading || code.length !== 6}>
              {loading ? 'Проверяем…' : 'Подтвердить'}
            </Button>

            <button
              type="button"
              onClick={resend}
              disabled={resending || cooldown > 0}
              className="block text-sm text-ink-60 transition-colors hover:text-neft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cooldown > 0
                ? `Выслать код повторно можно через ${cooldown} с`
                : resending
                  ? 'Отправляем…'
                  : 'Выслать код повторно'}
            </button>

            <Link to={next} className="block text-sm text-ink-60 hover:text-neft">
              Пропустить и перейти в кабинет →
            </Link>
          </form>
        </div>
      </div>
    </div>
  )
}
