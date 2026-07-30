import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Container } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Crest } from '@/components/brand/Crest'
import { Check } from '@/components/ui/Icon'
import { api } from '@/api'

/** Смена пароля по одноразовой ссылке из письма (/reset-password?token=…). */
export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10 text-center">
          <h1 className="font-serif text-3xl text-neft">Ссылка недействительна</h1>
          <p className="mt-3 text-ink-60">
            Откройте ссылку из письма целиком или запросите восстановление доступа заново.
          </p>
          <Button to="/login" className="mt-8">К входу</Button>
        </div>
      </Container>
    )
  }

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
      await api.auth.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить пароль')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <Container className="py-20 md:py-28">
        <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-oceanc-10 text-ocean">
            <Check width={32} height={32} />
          </span>
          <h1 className="mt-6 font-serif text-3xl text-neft">Пароль изменён</h1>
          <p className="mt-3 text-ink-60">Войдите в личный кабинет с новым паролем.</p>
          <Button onClick={() => navigate('/login', { replace: true })} className="mt-8">
            Войти
          </Button>
        </div>
      </Container>
    )
  }

  return (
    <Container className="py-20 md:py-28">
      <div className="mx-auto max-w-lg rounded-card border border-ink-10 bg-wisdom p-10">
        <Crest className="mx-auto h-14 w-14" />
        <h1 className="mt-6 text-center font-serif text-3xl text-neft">Новый пароль</h1>
        <p className="mt-3 text-center text-ink-60">
          Задайте пароль для входа в личный кабинет МАБЛ.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <Input
            label="Новый пароль"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Не короче 8 символов."
            required
            minLength={8}
          />
          <Input
            label="Повторите пароль"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
            minLength={8}
          />

          {error && (
            <div className="rounded-token border border-ocean/40 bg-oceanc-10 px-4 py-3 text-sm text-ocean">
              {error}
            </div>
          )}

          <Button type="submit" fullWidth size="lg" disabled={loading}>
            {loading ? 'Сохраняем…' : 'Сохранить пароль'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-ink-60 hover:text-neft">← Вернуться ко входу</Link>
        </p>
      </div>
    </Container>
  )
}
