import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea
    className={cn(
      'flex min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-950 shadow-sm',
      'placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100',
      'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70',
      className
    )}
    {...props}
  />
}
