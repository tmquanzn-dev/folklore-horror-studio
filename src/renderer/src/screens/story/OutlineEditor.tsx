import { useEffect, useState } from 'react'
import type { Beat, Story } from '../../../../shared/types'
import { Area, AsyncButton, ListText } from '../../components/forms'
import { Panel } from '../../components/ui'
import { llmEstimateLabel } from '../../lib/estimate'
import { beatEditConfirm, outlineRegenerateConfirm } from '../../lib/impactText'
import { useApp, useMockMode, useReleases } from '../../store/appStore'

/** Dàn ý theo beat: LLM tạo (bước 2) → sửa → ★ duyệt (bước 3) */
export function OutlineEditor({ story }: { story: Story }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const releases = useReleases()
  const mock = useMockMode()
  const [beats, setBeats] = useState<Beat[]>(story.outline.beats)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setBeats(story.outline.beats)
  }, [story.outline.beats, dirty])

  const edit = (i: number, patch: Partial<Beat>): void => {
    setBeats((bs) => bs.map((b, k) => (k === i ? { ...b, ...patch } : b)))
    setDirty(true)
  }
  const move = (i: number, d: number): void => {
    setBeats((bs) => {
      const arr = [...bs]
      const j = i + d
      if (j < 0 || j >= arr.length) return arr
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
    setDirty(true)
  }
  const approved = story.outline.approval.status === 'approved'
  const est = llmEstimateLabel(mock, 3000, 4000)

  return (
    <Panel
      title={`Dàn ý – ${beats.length} beat · ${approved ? '✓ đã duyệt' : '★ chờ duyệt'}`}
      actions={
        <>
          <AsyncButton
            className="btn-secondary text-xs"
            confirm={outlineRegenerateConfirm(story, releases)}
            onClick={async () => {
              await window.api.invoke('story:generateOutline', story.id)
              setDirty(false)
              await refresh()
            }}
          >
            {story.outline.beats.length ? 'Tạo lại (LLM)' : 'Tạo dàn ý (LLM)'} · {est}
          </AsyncButton>
          {dirty ? (
            <AsyncButton
              confirm={beatEditConfirm(story, beats, releases)}
              className="btn-primary text-xs"
              onClick={async () => {
                await window.api.invoke('story:update', story.id, { beats })
                setDirty(false)
                await refresh()
              }}
            >
              Lưu dàn ý
            </AsyncButton>
          ) : null}
          {!approved && beats.length > 0 && !dirty ? (
            <AsyncButton
              className="btn-primary text-xs"
              onClick={async () => {
                await window.api.invoke('story:approveOutline', story.id)
                await refresh()
              }}
            >
              ★ Duyệt dàn ý
            </AsyncButton>
          ) : null}
        </>
      }
    >
      {beats.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có dàn ý. Bấm "Tạo dàn ý (LLM)" – LLM viết 6–8 beat song ngữ kèm cường độ cảm xúc.</p>
      ) : (
        <ol className="space-y-3">
          {beats.map((b, i) => (
            <li key={b.id} className="rounded-md border border-ink-600 bg-ink-850 p-3">
              <div className="mb-2 flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-600 text-xs">{i + 1}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={b.emotionalIntensity}
                  className="w-32 accent-blood-500"
                  title="Cường độ cảm xúc"
                  onChange={(e) => edit(i, { emotionalIntensity: Number(e.target.value) })}
                />
                <span className="text-[11px] text-slate-500">cường độ {b.emotionalIntensity.toFixed(2)}</span>
                <div className="flex-1" />
                <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => move(i, -1)}>↑</button>
                <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => move(i, 1)}>↓</button>
                <button
                  className="btn-ghost px-1.5 py-0.5 text-xs text-red-300"
                  onClick={() => {
                    setBeats((bs) => bs.filter((_, k) => k !== i))
                    setDirty(true)
                  }}
                >
                  Xoá
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Area value={b.summaryVi} onChange={(v) => edit(i, { summaryVi: v })} rows={2} />
                <Area value={b.summaryEn} onChange={(v) => edit(i, { summaryEn: v })} rows={2} className="italic text-slate-400" />
              </div>
              <div className="mt-2">
                <ListText value={b.mustShow} onChange={(v) => edit(i, { mustShow: v })} placeholder="Phải thể hiện: a, b, c" />
              </div>
            </li>
          ))}
        </ol>
      )}
      {beats.length > 0 ? (
        <button
          className="btn-ghost mt-3 text-xs"
          onClick={() => {
            const id = `b${Date.now().toString(36)}`
            setBeats((bs) => [...bs, { id, order: bs.length + 1, summaryVi: '', summaryEn: '', emotionalIntensity: 0.5, mustShow: [] }])
            setDirty(true)
          }}
        >
          + Thêm beat
        </button>
      ) : null}
    </Panel>
  )
}
