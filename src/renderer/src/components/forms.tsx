import { useState, type ReactNode } from 'react'
import { errorMessage } from '../lib/format'
import { useApp } from '../store/appStore'
import { Icon } from './Icon'

/** Nút chạy tác vụ async: hiện "Đang chạy…", khoá nút, lỗi ⇒ toast tiếng Việt */
export function AsyncButton({
  onClick,
  children,
  className = 'btn-secondary',
  disabled,
  title,
  confirm
}: {
  onClick: () => Promise<unknown>
  children: ReactNode
  className?: string
  disabled?: boolean
  title?: string
  /** Hỏi xác nhận trước (dùng hộp thoại trong app, không dùng window.confirm) */
  confirm?: string
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const toast = useApp((s) => s.toast)
  const run = async (): Promise<void> => {
    setAsking(false)
    setBusy(true)
    try {
      await onClick()
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className={className} disabled={disabled || busy} title={title} onClick={() => (confirm ? setAsking(true) : void run())}>
        {busy ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
        {busy ? 'Đang chạy…' : children}
      </button>
      {asking ? (
        <Modal title="Xác nhận" onClose={() => setAsking(false)}>
          <p className="text-sm text-slate-300">{confirm}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAsking(false)}>
              Huỷ
            </button>
            <button className="btn-primary" onClick={() => void run()}>
              Đồng ý
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className={`panel max-h-full w-full overflow-auto p-5 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <button className="btn-ghost px-1 py-1" onClick={onClose}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Text({
  label,
  value,
  onChange,
  placeholder,
  className = ''
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}): JSX.Element {
  const input = <input className={`input w-full ${className}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  return label ? <Labeled label={label}>{input}</Labeled> : input
}

export function Area({
  label,
  value,
  onChange,
  rows = 2,
  placeholder,
  className = ''
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  className?: string
}): JSX.Element {
  const area = (
    <textarea
      className={`input w-full resize-y leading-relaxed ${className}`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  return label ? <Labeled label={label}>{area}</Labeled> : area
}

export function Num({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  className = 'w-24'
}: {
  label?: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  className?: string
}): JSX.Element {
  const input = (
    <input
      type="number"
      className={`input ${className}`}
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
  return label ? <Labeled label={label}>{input}</Labeled> : input
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  className = 'w-full'
}: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
}): JSX.Element {
  const sel = (
    <select className={`input ${className}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  return label ? <Labeled label={label}>{sel}</Labeled> : sel
}

export function Labeled({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

/** Chuỗi "a, b, c" ⇄ mảng */
export function ListText({ label, value, onChange, placeholder }: { label?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }): JSX.Element {
  const [text, setText] = useState(value.join(', '))
  const [last, setLast] = useState(value)
  if (last !== value && value.join(', ') !== text.split(',').map((s) => s.trim()).filter(Boolean).join(', ')) {
    setLast(value)
    setText(value.join(', '))
  }
  return (
    <Text
      label={label}
      value={text}
      placeholder={placeholder}
      onChange={(t) => {
        setText(t)
        const arr = t.split(',').map((s) => s.trim()).filter(Boolean)
        setLast(arr)
        onChange(arr)
      }}
    />
  )
}

const AVATAR_COLORS = ['#7c3aed', '#b3122e', '#0e7490', '#a16207', '#15803d', '#be185d', '#4338ca']

export function Avatar({ name, id, size = 24, ring }: { name: string; id: string; size?: number; ring?: boolean }): JSX.Element {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${ring ? 'ring-2 ring-amber-300' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.4, background: AVATAR_COLORS[h % AVATAR_COLORS.length] }}
    >
      {initials || '?'}
    </span>
  )
}
