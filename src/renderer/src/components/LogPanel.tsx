import { useEffect, useRef } from 'react'
import { useApp } from '../store/appStore'
import { Icon } from './Icon'

export function LogPanel(): JSX.Element | null {
  const open = useApp((s) => s.logOpen)
  const logs = useApp((s) => s.logs)
  const toggleLog = useApp((s) => s.toggleLog)
  const logFile = useApp((s) => s.appInfo?.logFile)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, logs.length])

  if (!open) return null
  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-ink-600 bg-ink-950">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-1.5">
        <span className="panel-title">Nhật ký</span>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="truncate">File log: {logFile ?? '–'}</span>
          <button className="btn-ghost px-1 py-0.5" onClick={() => toggleLog(false)}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-1 font-mono text-[11.5px] leading-5">
        {logs.map((l) => (
          <div
            key={l.id}
            className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-slate-400'}
          >
            <span className="text-slate-600">{l.time.slice(11, 19)}</span>{' '}
            <span className="text-slate-500">[{l.scope}]</span> <span className="whitespace-pre-wrap">{l.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
