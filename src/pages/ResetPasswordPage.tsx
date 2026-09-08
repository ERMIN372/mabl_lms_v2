import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { Crest } from '@/components/brand/Crest'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'

/**
 * Страница смены пароля по ссылке из письма (/reset-password?token=…).
 * Токен одноразовый и живёт 2 часа; после успешной смены сервер сразу открывает
 * сессию, поэтому уводим пользователя в личный кабинет.
 */
export default function ResetPasswordPage() {
  const { resetPassword } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов.')
      return
    }
    if (password !== repeat) {
      setError('Пароли не совпадают.')
      return
    }
    setLoading(true)
    try {
      const account = await resetPassword(token, password)
      navigate(account.kind === 'admin' ? '/admin' : '/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить пароль')
    } finally {
      setLoading(false)
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
            Новый пароль откроет доступ к программам, вебинарам и сообществу академии.
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

          <p className="eyebrow mb-3">Восстановление</p>
          <h1 className="font-serif text-3xl text-neft">Новый пароль</h1>

          {!token ? (
            <div className="mt-9 space-y-5">
              <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
                Ссылка неполная: в адресе нет кода восстановления. Откройте ссылку из письма
                целиком или запросите новую.
              </div>
              <Link to="/login" className="block text-sm text-ink-60 hover:text-neft">
                ← Вернуться ко входу
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-9 space-y-5">
              <p className="text-sm text-ink-60">
                Придумайте новый пароль — не короче 8 символов. Ссылка из письма срабатывает
                один раз.
              </p>
              <Input
                label="Новый пароль"
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                label="Повторите пароль"
                type="password"
                name="password-repeat"
                autoComplete="new-password"
                placeholder="••••••••"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                required
              />

              {error && (
                <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
                  {error}
                </div>
              )}

              <Button type="submit" fullWidth size="lg" disabled={loading}>
                {loading ? 'Сохраняем…' : 'Сохранить пароль'}
              </Button>
              <Link to="/login" className="block text-sm text-ink-60 hover:text-neft">
                ← Вернуться ко входу
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
