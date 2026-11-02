import { useEffect, useState } from 'react'
import { providersConfig, puppetConfig } from '../../../../shared/config'
import { isPipelineComplete, RELEASE_PIPELINE } from '../../../../shared/pipeline'
import type { Release, RunMode } from '../../../../shared/types'
import { Icon } from '../../components/Icon'
import { PhaseBadge } from '../../components/ui'
import { useApp, useMockMode } from '../../store/appStore'

/** Cột trái AutoEdit: chế độ chạy, nguồn giọng, heroRatio, thư viện âm thanh, nút Bắt đầu / Tiếp tục / Huỷ */
export function RunPanel({ release }: { release: Release }): JSX.Element {
  const [mode, setMode] = useState<RunMode>(release.pipelineState?.mode ?? 'review')
  const start = useApp((s) => s.startPipeline)
  const cont = useApp((s) => s.continuePipeline)
  const cancel = useApp((s) => s.cancelPipeline)
  const resetFrom = useApp((s) => s.resetPipelineFrom)
  const runAction = useApp((s) => s.runAction)
  const setScreen = useApp((s) => s.setScreen)
  const mock = useMockMode()
  const soundCount = useApp((s) => s.library?.soundAssets.filter((a) => a.licenseConfirmed).length ?? 0)
  const [heroRatio, setHeroRatio] = useState(release.heroRatio)
  useEffect(() => setHeroRatio(release.heroRatio), [release.heroRatio])
  const setHero = (): Promise<void> =>
    runAction(async () => {
      if (Math.abs(heroRatio - release.heroRatio) < 1e-6) return
      await window.api.invoke('release:update', release.storyId, release.id, { heroRatio })
    })

  const st = release.pipelineState
  const running = !!st?.running
  const waiting = st ? RELEASE_PIPELINE.find((d) => st.steps[d.no]?.status === 'waitingApproval') : undefined
  const failed = st ? RELEASE_PIPELINE.find((d) => st.steps[d.no]?.status === 'failed') : undefined
  const complete = isPipelineComplete(st)

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <div>
        <div className="panel-title mb-2">Chế độ chạy</div>
        <div className="space-y-1.5">
          {(
            [
              ['review', 'Duyệt từng bước', 'Dừng ở mọi điểm duyệt ★ (mặc định)'],
              ['fullAuto', 'Full Auto – bản nháp', 'Tự duyệt, chỉ để tạo bản nháp nhanh']
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-2 rounded-md border p-2 ${
                mode === value ? 'border-blood-500 bg-blood-700/20' : 'border-ink-600 hover:bg-ink-700'
              }`}
            >
              <input type="radio" className="mt-1 accent-blood-500" checked={mode === value} onChange={() => setMode(value)} disabled={running} />
              <span>
                <span className="block text-sm text-slate-200">{label}</span>
                <span className="block text-[11px] text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="panel-title mb-2">Nguồn giọng</div>
        <div className="flex gap-2">
          {(['tts', 'recorded'] as const).map((src) => {
            const on = (release.voiceSource ?? 'tts') === src
            return (
              <button
                key={src}
                disabled={running}
                className={`chip ${on ? 'border-night-500 bg-night-700/50 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                onClick={() => void runAction(() => window.api.invoke('recording:setSource', release.storyId, release.id, src))}
              >
                {src === 'tts' ? `TTS${mock ? ' (Mock)' : ''}` : 'Tự thu + Whisper'}
              </button>
            )
          })}
        </div>
        {release.voiceSource === 'recorded' ? (
          <p className="mt-1 text-[11px] text-slate-500">
            {release.recording ? `File: ${release.recording.originalName}` : 'Chưa có file – nhập ở Voice Studio.'} Bước 11 chép lời + căn mốc, bước 12 dùng file tự thu.
          </p>
        ) : null}
      </div>

      <div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            className="mt-1 accent-blood-500"
            disabled={running}
            checked={(release.puppetMaxRatio ?? puppetConfig.puppetMaxRatio) > 0}
            onChange={(e) =>
              void runAction(() => window.api.invoke('release:update', release.storyId, release.id, { puppetMaxRatio: e.target.checked ? puppetConfig.puppetMaxRatio : 0 }))
            }
          />
          <span>
            Người kể lên hình (rối 2D)
            <span className="block text-[11px] text-slate-500">
              Cảnh người kể diễn bằng rối: chớp mắt, khớp môi, thở – tối đa {Math.round(puppetConfig.puppetMaxRatio * 100)}% thời lượng. Cần người kể có rối (màn Nhân vật). Đổi ⇒ chạy lại từ bước 14.
            </span>
          </span>
        </label>
      </div>

      <div>
        <div className="panel-title mb-1">Tỷ lệ cảnh hero (video AI): {Math.round(heroRatio * 100)}%</div>
        <input
          type="range"
          min={0}
          max={0.4}
          step={0.01}
          value={heroRatio}
          disabled={running}
          className="w-full accent-blood-500"
          onChange={(e) => setHeroRatio(Number(e.target.value))}
          onMouseUp={() => void setHero()}
          onKeyUp={() => void setHero()}
        />
        <div className="text-[11px] text-slate-500">
          {mock ? 'Mock: clip giả lập, miễn phí' : `${providersConfig.video.veo.displayName}: ~$${(providersConfig.video.veo.pricePerSecond * providersConfig.video.veo.clipSeconds).toFixed(2)}/cảnh – luôn báo giá ở bước 16`}
        </div>
      </div>

      <div>
        <div className="panel-title mb-1">Âm thanh</div>
        <div className="text-[11px] text-slate-500">
          {soundCount} âm thanh đã xác nhận giấy phép.{' '}
          <button className="text-night-400 underline" onClick={() => setScreen('settings')}>
            Thư viện âm thanh
          </button>
        </div>
      </div>

      <div className="flex-1" />

      <div className="space-y-2">
        {waiting && !running && !waiting.approval ? (
          <div className="space-y-2 rounded-md border border-amber-700 bg-amber-950/40 p-2">
            <div className="text-[11px] text-amber-200">{st?.steps[waiting.no]?.message}</div>
            <button className="btn-primary w-full" onClick={() => void runAction(() => window.api.invoke('pipeline:continue', release.storyId, release.id, 'approved'))}>
              Đồng ý & tạo
            </button>
            <button className="btn-secondary w-full" onClick={() => void runAction(() => window.api.invoke('pipeline:continue', release.storyId, release.id, 'declined'))}>
              Bỏ qua (dùng Ken Burns / parallax)
            </button>
          </div>
        ) : waiting && !running ? (
          <button className="btn-primary w-full py-3 text-base" onClick={() => void cont()}>
            <Icon name="next" /> Tiếp tục (đã duyệt bước {waiting.no})
          </button>
        ) : (
          <button className="btn-primary w-full py-3 text-base" disabled={running} onClick={() => void start(mode)}>
            <Icon name="play" />
            {failed ? `Chạy lại bước ${failed.no}` : complete ? 'Chạy lại (dùng cache)' : st ? 'Bắt đầu / Chạy tiếp' : 'Bắt đầu'}
          </button>
        )}
        {running ? (
          <button className="btn-secondary w-full" onClick={() => void cancel()}>
            <Icon name="stop" className="h-4 w-4" /> Huỷ
          </button>
        ) : null}
        <button className="btn-ghost w-full text-xs" disabled={running || !st} onClick={() => void resetFrom(RELEASE_PIPELINE[0].no)}>
          <Icon name="refresh" className="h-4 w-4" /> Đặt lại toàn bộ (giữ cache media)
        </button>
      </div>
    </div>
  )
}
