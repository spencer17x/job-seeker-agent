import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

const variants: Record<ButtonVariant, string> = {
  default: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700',
  secondary: 'bg-slate-100 text-slate-900 shadow-sm hover:bg-slate-200',
  outline: 'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 hover:text-slate-950',
  ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-950',
  destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700'
}

const sizes: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3',
  lg: 'h-11 rounded-lg px-6',
  icon: 'size-10'
}

export function buttonVariants({
  variant = 'default',
  size = 'default',
  className
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className
  )
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return <button type={type} className={buttonVariants({ variant, size, className })} {...props} />
}
