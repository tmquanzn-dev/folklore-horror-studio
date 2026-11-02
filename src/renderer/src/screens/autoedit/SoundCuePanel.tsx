import { useEffect, useState } from 'react'
import type { Release, SoundCue, Story } from '../../../../shared/types'
import { AsyncButton, Num } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { Field } from '../../components/ui'
import { playAudio } from '../../lib/audio'
import { useApp } from '../../store/appStore'

const KIND_LABEL: Record<SoundCue['kind'], string> = {
  ambience: 'Ambience (nền)',
  sfx: 'SFX',
  stinger: 'Stinger (nhấn)',
  music: 'Nhạc nền',
  silence: 'Khoảng lặng có chủ đích'
}

/** Cột phải AutoEdit khi chọn một sound cue trên timeline */
export function SoundCuePanel({ story, release }: { story: Story; release: Release }): JSX.Element | null {
  const cueId = useApp((s) => s.selectedCueId)
  const library = useApp((s) => s.library)
  const refresh = useApp((s) => s.refresh)
  const selectCue = useApp((s) => s.selectCue)
  const cue = release.soundCues.find((c) => c.id === cueId) ?? null
  const [d, setD] = useState<SoundCue | null>(cue)
  useEffect(() => setD(cue), [cue])
  if (!cue || !d) return null

  const assets = (library?.soundAssets ?? []).filter((a) => a.kind === d.kind && a.licenseConfirmed)
  const asset = library?.soundAssets.find((a) => a.id === d.assetId)
  const dirty = JSON.stringify(d) !== JSON.stringify(cue)
  const locked = !!release.pipelineState?.running
  const save = async (cues: SoundCue[]): Promise<void> => {
    await window.api.invoke('release:updateSoundCues', story.id, release.id, cues)
    await refresh()
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm">
      <div>
        <div className="panel-title">Sound cue</div>
        <div className="mt-1 text-slate-100">{KIND_LABEL[d.kind]}</div>
        {d.reason ? <div className="mt-1 text-[11px] text-slate-400">{d.reason}</div> : null}
      </div>
      {d.kind !== 'silence' ? (
        <Field label="Âm thanh (đã xác nhận giấy phép)">
          <div className="flex gap-2">
            <select className="input min-w-0 flex-1" value={d.assetId ?? ''} disabled={locked} onChange={(e) => setD({ ...d, assetId: e.target.value })}>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.durationSec.toFixed(1)}s
                </option>
              ))}
            </select>
            <AsyncButton className="btn-ghost px-2" disabled={!d.assetId} onClick={async () => playAudio(await window.api.invoke('sound:preview', d.assetId as string))}>
              <Icon name="play" className="h-3.5 w-3.5" />
            </AsyncButton>
          </div>
          {asset ? <div className="mt-1 text-[11px] text-slate-500">Giấy phép: {asset.license || '(chưa ghi)'}</div> : null}
        </Field>
      ) : (
        <p className="text-[11px] text-slate-400">Trong đoạn này mọi âm nền (ambience, nhạc, SFX) bị tắt – chỉ còn giọng, tạo cảm giác nín thở trước cao trào.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Num label="Bắt đầu (s)" value={d.start} step={0.1} min={0} onChange={(v) => setD({ ...d, start: v })} className="w-full" />
        <Num label="Kết thúc (s)" value={d.end} step={0.1} min={0} onChange={(v) => setD({ ...d, end: v })} className="w-full" />
        {d.kind !== 'silence' ? (
          <>
            <Num label="Fade vào (s)" value={d.fadeIn} step={0.1} min={0} onChange={(v) => setD({ ...d, fadeIn: v })} className="w-full" />
            <Num label="Fade ra (s)" value={d.fadeOut} step={0.1} min={0} onChange={(v) => setD({ ...d, fadeOut: v })} className="w-full" />
          </>
        ) : null}
      </div>
      {d.kind !== 'silence' ? (
        <Field label={`Âm lượng tương đối: ${d.volume.toFixed(2)}`}>
          <input type="range" min={0} max={1.5} step={0.05} className="w-full accent-blood-500" value={d.volume} disabled={locked} onChange={(e) => setD({ ...d, volume: Number(e.target.value) })} />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <AsyncButton className="btn-primary flex-1" disabled={!dirty || locked} onClick={() => save(release.soundCues.map((c) => (c.id === d.id ? d : c)))}>
          Lưu cue
        </AsyncButton>
        <AsyncButton
          className="btn-secondary"
          disabled={locked}
          onClick={async () => {
            await save(release.soundCues.filter((c) => c.id !== d.id))
            selectCue(null)
          }}
        >
          Xoá
        </AsyncButton>
      </div>
      <div className="mt-2 space-y-2 border-t border-ink-600 pt-3">
        <AsyncButton
          className="btn-secondary w-full"
          disabled={locked}
          onClick={async () => {
            await window.api.invoke('audio:remix', story.id, release.id)
            await refresh()
          }}
        >
          Mix lại (ducking + chuẩn loudness)
        </AsyncButton>
        <AsyncButton
          className="btn-ghost w-full text-xs"
          disabled={locked}
          confirm="Thiết kế lại toàn bộ sound cue (bỏ các chỉnh sửa tay) rồi mix lại?"
          onClick={async () => {
            await window.api.invoke('audio:redesign', story.id, release.id)
            await refresh()
          }}
        >
          Thiết kế lại âm thanh (LLM)
        </AsyncButton>
      </div>
    </div>
  )
}
