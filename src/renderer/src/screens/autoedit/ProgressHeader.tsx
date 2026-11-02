import { useEffect, useState } from 'react'
import { getStepDef, PIPELINE_TOTAL_STEPS, RELEASE_PIPELINE, stepStatusLabel } from '../../../../shared/pipeline'
import type { PipelineState } from '../../../../shared/types'
import { Icon } from '../../components/Icon'
import { ProgressBar } from '../../components/ui'
import { formatDuration } from '../../lib/format'
import { useApp } from '../../store/appStore'

/** "BƯỚC 16/23: Tạo video AI – 64%" + thời gian đã chạy + ước tính còn lại */
export function ProgressHeader({ state }: { state: PipelineState | null }): JSX.Element {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!state?.running) return
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [state?.running])

  if (!state) {
    return <div className="text-sm text-slate-400">Chưa chạy. Chọn chế độ rồi bấm "Bắt đầu".</div>
  }
  const def = state.currentStep != null ? getStepDef(state.currentStep) : undefined
  if (!def) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-300">
        <Icon name="check" className="h-4 w-4" /> Đã hoàn tất tất cả các bước – xem video ở màn Xuất bản.
      </div>
    )
  }
  const st = state.steps[def.no]
  const elapsed = st?.startedAt ? Date.now() - new Date(st.startedAt).getTime() : 0
  const p = st?.progress ?? 0
  const eta = st?.status === 'running' && p > 0.02 ? (elapsed * (1 - p)) / p : null
  const color =
    st?.status === 'failed'
      ? 'text-red-400'
      : st?.status === 'waitingApproval'
        ? 'text-amber-300'
        : st?.status === 'running'
          ? 'text-blood-300'
          : 'text-slate-300'

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <div className={`text-base font-semibold ${color}`}>
          BƯỚC {def.no}/{PIPELINE_TOTAL_STEPS}: {def.title}
          {def.approval ? ' ★' : ''} – {st?.status === 'running' ? `${Math.round(p * 100)}%` : stepStatusLabel(st?.status ?? 'pending')}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-400">
          {st?.status === 'running' ? (
            <>
              <span className="flex items-center gap-1">
                <Icon name="clock" className="h-3.5 w-3.5" /> {formatDuration(elapsed)}
              </span>
              {eta != null ? <span>còn ~{formatDuration(eta)}</span> : null}
            </>
          ) : null}
        </div>
      </div>
      {st?.status === 'running' ? <ProgressBar value={p} /> : null}
      <div className="text-xs text-slate-400">{st?.error ?? st?.message ?? ''}</div>
    </div>
  )
}

/** Danh sách các bước với trạng thái + nút "Chạy lại từ đây" */
export function StepList({ state }: { state: PipelineState | null }): JSX.Element {
  const resetFrom = useApp((s) => s.resetPipelineFrom)
  return (
    <ol className="space-y-0.5">
      {RELEASE_PIPELINE.map((d) => {
        const st = state?.steps[d.no]
        const status = st?.status ?? 'pending'
        const dot =
          status === 'done'
            ? 'bg-emerald-500'
            : status === 'skipped'
              ? 'bg-slate-500'
              : status === 'running'
                ? 'animate-pulse bg-blood-500'
                : status === 'waitingApproval'
                  ? 'bg-amber-400'
                  : status === 'failed'
                    ? 'bg-red-500'
                    : status === 'cancelled'
                      ? 'bg-orange-500'
                      : 'bg-ink-500'
        return (
          <li
            key={d.no}
            className={`group flex items-center gap-2 rounded px-2 py-1 text-xs ${state?.currentStep === d.no ? 'bg-ink-700' : ''}`}
            title={st?.error ?? st?.message ?? d.phaseNote ?? ''}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="w-6 text-right text-slate-500">{d.no}</span>
            <span className={`flex-1 truncate ${status === 'skipped' ? 'text-slate-500' : 'text-slate-200'}`}>
              {d.title}
              {d.approval ? <span className="text-amber-300"> ★</span> : null}
            </span>
            <span className={`shrink-0 text-[10px] text-slate-500 ${!state?.running && state && status !== 'pending' ? 'group-hover:hidden' : ''}`}>
              {stepStatusLabel(status)}
            </span>
            {!state?.running && state && status !== 'pending' ? (
              <button
                className="hidden shrink-0 text-[10px] text-night-400 hover:underline group-hover:inline"
                onClick={() => void resetFrom(d.no)}
              >
                chạy lại từ đây
              </button>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
