import { getStepDef, PIPELINE_TOTAL_STEPS } from '../../../shared/pipeline'
import { formatUsd } from '../lib/format'
import { useApp, useReleases } from '../store/appStore'
import { Icon } from './Icon'

/** Thanh trạng thái: chi phí, chế độ Mock, bước đang chạy, nút mở Nhật ký */
export function StatusBar(): JSX.Element {
  const stories = useApp((s) => s.stories)
  const appInfo = useApp((s) => s.appInfo)
  const logOpen = useApp((s) => s.logOpen)
  const toggleLog = useApp((s) => s.toggleLog)
  const releases = useReleases()
  const lastLog = useApp((s) => s.logs[s.logs.length - 1])

  const monthCost = stories.reduce((sum, s) => sum + s.costActual, 0)
  const running = releases.find((r) => r.pipelineState?.running)
  const step = running?.pipelineState?.currentStep != null ? getStepDef(running.pipelineState.currentStep) : undefined
  const progress = step && running?.pipelineState ? running.pipelineState.steps[step.no]?.progress ?? 0 : 0

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-ink-700 bg-ink-950 px-3 text-[11px] text-slate-400">
      <span>
        Chi phí tháng: <b className="text-slate-200">{formatUsd(monthCost)}</b>
      </span>
      {appInfo?.mockMode ? (
        <span className="rounded bg-night-700/70 px-1.5 text-night-400">Chế độ Mock (không tốn phí)</span>
      ) : null}
      {running && step ? (
        <span className="text-blood-300">
          ● BƯỚC {step.no}/{PIPELINE_TOTAL_STEPS}: {step.title} – {Math.round(progress * 100)}%
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-slate-500">{lastLog ? lastLog.message : ''}</span>
      <button
        onClick={() => toggleLog()}
        className={`flex items-center gap-1 rounded px-2 py-0.5 ${logOpen ? 'bg-ink-700 text-slate-200' : 'hover:bg-ink-800'}`}
      >
        <Icon name="log" className="h-3.5 w-3.5" /> Nhật ký
      </button>
    </footer>
  )
}
