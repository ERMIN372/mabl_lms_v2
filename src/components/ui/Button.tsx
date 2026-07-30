import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 font-semibold uppercase tracking-wide transition-colors duration-200 rounded-token disabled:opacity-50 disabled:pointer-events-none select-none'

const variants: Record<Variant, string> = {
  // Океан — основной акцент
  primary: 'bg-ocean text-wisdom hover:bg-oceanc-80',
  // Тонкая обводка в академическом стиле
  secondary: 'border border-ink-20 text-neft hover:border-neft hover:bg-ink-5',
  ghost: 'text-neft hover:bg-ink-5',
  // Нефть
  dark: 'bg-neft text-wisdom hover:bg-ink-80',
}

const sizes: Record<Size, string> = {
  sm: 'text-[0.7rem] px-4 py-2',
  md: 'text-[0.75rem] px-6 py-3',
  lg: 'text-[0.8rem] px-8 py-4',
}

interface CommonProps {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  className?: string
  children: ReactNode
}

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined }
type ButtonAsLink = CommonProps & {
  to: string
  state?: unknown
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export const Button = forwardRef<HTMLButtonElement, ButtonAsButton | ButtonAsLink>(
  function Button(props, ref) {
    const { variant = 'primary', size = 'md', fullWidth, className, children } = props
    const classes = cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)

    if ('to' in props && props.to) {
      return (
        <Link to={props.to} state={props.state} onClick={props.onClick} className={classes}>
          {children}
        </Link>
      )
    }
    const { variant: _v, size: _s, fullWidth: _f, className: _c, children: _ch, ...rest } =
      props as ButtonAsButton
    void _v; void _s; void _f; void _c; void _ch
    return (
      <button ref={ref} className={classes} {...rest}>
        {children}
      </button>
    )
  },
)
