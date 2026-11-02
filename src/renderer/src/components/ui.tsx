import type { ReactNode } from 'react'
import type { Language, Platform } from '../../../shared/types'
import { PLATFORM_LABEL } from '../lib/format'
import { Icon } from './Icon'

export function Panel({
  title,
  actions,
  children,
  className = ''
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
          <h2 className="panel-title">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function LangBadge({ language }: { language: Language }): JSX.Element {
  const cls = language === 'vi' ? 'bg-red-900/60 text-yellow-300 border-red-700' : 'bg-blue-950/70 text-sky-200 border-blue-800'
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{language.toUpperCase()}</span>
}

export function PlatformBadge({ platform }: { platform: Platform }): JSX.Element {
  const cls =
    platform === 'tiktok'
      ? 'bg-pink-950/60 text-pink-200 border-pink-800'
      : platform === 'youtube'
        ? 'bg-red-950/60 text-red-200 border-red-800'
        : 'bg-orange-950/60 text-orange-200 border-orange-800'
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{PLATFORM_LABEL[platform]}</span>
}

export function PhaseBadge({ phase }: { phase: number }): JSX.Element {
  return (
    <span className="rounded border border-night-500 bg-night-700/60 px-1.5 py-0.5 text-[10px] font-semibold text-night-400">
      Giai đoạn {phase}
    </span>
  )
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }): JSX.Element {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-ink-600 ${className}`}>
      <div className="h-full rounded-full bg-blood-500 transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-500">{children}</div>
}

/** Màn hình/tính năng chưa làm ở GĐ hiện tại */
export function PhasePlaceholder({
  title,
  phase,
  features,
  children
}: {
  title: string
  phase: number
  features: string[]
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="panel p-8">
        <div className="mb-3 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
          <PhaseBadge phase={phase} />
        </div>
        <p className="mb-5 text-slate-400">
          Màn hình này sẽ được triển khai ở <b className="text-night-400">Giai đoạn {phase}</b>. Các tính năng dự kiến:
        </p>
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f} className="flex gap-2 text-slate-300">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-night-400" />
              {f}
            </li>
          ))}
        </ul>
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
