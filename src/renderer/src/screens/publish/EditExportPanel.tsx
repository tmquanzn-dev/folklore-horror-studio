/**
 * Xuất cho phần mềm dựng: SRT (phụ đề), FCPXML (Final Cut / DaVinci Resolve), CapCut (draft mẫu – template mode).
 */
import { useEffect, useState } from 'react'
import type { EditExportResult, PublicSettings } from '../../../../shared/ipc'
import type { Release } from '../../../../shared/types'
import { AsyncButton } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/ui'
import { useApp } from '../../store/appStore'

export function EditExportPanel({ release }: { release: Release }): JSX.Element {
  const toast = useApp((s) => s.toast)
  const runAction = useApp((s) => s.runAction)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [result, setResult] = useState<{ label: string; r: EditExportResult } | null>(null)
  useEffect(() => {
    void window.api.invoke('settings:get').then(setSettings)
  }, [])
  const ready = !!release.voiceTrack?.mixedPath && release.scenes.length > 0
  const run = (label: string, ch: 'export:srt' | 'export:fcpxml' | 'export:capcut') => async (): Promise<void> => {
    const r = await window.api.invoke(ch, release.storyId, release.id)
    setResult({ label, r })
    toast(`Đã xuất ${label}`, 'info')
  }
  const tplName = settings?.capcutTemplateDir ? settings.capcutTemplateDir.split(/[\\/]/).pop() : null

  return (
    <Panel title="Xuất cho phần mềm dựng">
      {!ready ? <p className="mb-3 text-xs text-amber-300">Cần chạy AutoEdit tới bước 19 (giọng, cảnh, mix) trước khi xuất.</p> : null}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border border-ink-600 bg-ink-850 p-3">
          <div className="font-semibold text-slate-100">Phụ đề .srt</div>
          <p className="mt-1 text-xs text-slate-400">
            ≤ 2 dòng × 42 ký tự, tải lên YouTube / TikTok hoặc nhập vào NLE.{release.language === 'en' ? ' Kèm file tiếng Việt từ bản dịch.' : ''}
          </p>
          <AsyncButton className="btn-secondary mt-2 text-xs" disabled={!ready} onClick={run('SRT', 'export:srt')}>
            Xuất SRT
          </AsyncButton>
        </div>
        <div className="rounded-md border border-ink-600 bg-ink-850 p-3">
          <div className="font-semibold text-slate-100">FCPXML</div>
          <p className="mt-1 text-xs text-slate-400">Final Cut Pro / DaVinci Resolve: ảnh theo cảnh, clip AI, bản mix, giọng riêng (tắt sẵn), marker chapter + SRT.</p>
          <AsyncButton className="btn-secondary mt-2 text-xs" disabled={!ready} onClick={run('FCPXML', 'export:fcpxml')}>
            Xuất FCPXML
          </AsyncButton>
        </div>
        <div className="rounded-md border border-ink-600 bg-ink-850 p-3">
          <div className="font-semibold text-slate-100">CapCut (draft mẫu)</div>
          <p className="mt-1 text-xs text-slate-400">
            Nhân bản 1 ảnh + 1 audio + 1 chữ từ draft mẫu của bạn (giữ font, màu, animation).
          </p>
          <div className="mt-1 truncate text-[11px] text-slate-500" title={settings?.capcutTemplateDir}>
            Mẫu: {tplName ?? <span className="text-amber-300">chưa chọn</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AsyncButton className="btn-secondary text-xs" disabled={!ready || !tplName} onClick={run('draft CapCut', 'export:capcut')}>
              Xuất CapCut
            </AsyncButton>
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() =>
                void runAction(async () => {
                  const s = await window.api.invoke('export:chooseCapcutTemplate')
                  if (s) setSettings(s)
                })
              }
            >
              Chọn draft mẫu
            </button>
            <button
              className="btn-ghost px-2 py-1 text-xs"
              title={settings?.capcutDraftsDir}
              onClick={() =>
                void runAction(async () => {
                  const s = await window.api.invoke('export:chooseCapcutDrafts')
                  if (s) setSettings(s)
                })
              }
            >
              Thư mục draft…
            </button>
          </div>
        </div>
      </div>

      {result ? (
        <div className="mt-3 rounded-md border border-ink-600 bg-ink-850 p-3 text-xs">
          <div className="mb-1 font-semibold text-slate-200">Kết quả xuất {result.label}</div>
          <ul className="space-y-1">
            {result.r.files.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-slate-300" title={f}>
                  {f}
                </span>
                <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => void runAction(() => window.api.invoke('export:reveal', f))}>
                  <Icon name="folder" className="h-3.5 w-3.5" /> Mở
                </button>
              </li>
            ))}
          </ul>
          {result.r.warnings.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-amber-300">
              {result.r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
