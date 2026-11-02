import { useEffect, useMemo, useRef, useState } from 'react'
import { charactersForStory } from '../../../shared/logic/voices'
import type { AspectRatio, SceneBankItem } from '../../../shared/types'
import { AsyncButton, Avatar } from '../components/forms'
import { SceneEditModal } from '../components/SceneEditModal'
import { Empty } from '../components/ui'
import { imageEstimateLabel, llmEstimateLabel } from '../lib/estimate'
import { errorMessage, SHOT_LABEL } from '../lib/format'
import { useMediaUrl } from '../lib/preview'
import { useApp, useCurrentRelease, useCurrentStory, useMockMode } from '../store/appStore'

/**
 * Storyboard: duyệt ngân hàng cảnh. Phím tắt (khi đã chọn một thẻ):
 *   A duyệt · R tạo lại ảnh khung đang xem · E sửa prompt/cast · V tạo bản 9:16 vẽ riêng · ←/→ chuyển thẻ
 */
export function StoryboardScreen(): JSX.Element {
  const story = useCurrentStory()
  const release = useCurrentRelease()
  const library = useApp((s) => s.library)
  const queue = useApp((s) => s.queue)
  const toast = useApp((s) => s.toast)
  const refresh = useApp((s) => s.refresh)
  const setScreen = useApp((s) => s.setScreen)
  const mock = useMockMode()
  const mediaUrl = useMediaUrl(story?.id)
  const [view, setView] = useState<AspectRatio>('16:9')
  const [filterChar, setFilterChar] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SceneBankItem | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag

  const chars = useMemo(() => (story && library ? charactersForStory(story.id, library.characters) : []), [story, library])
  const scenes = useMemo(
    () => (story ? (filterChar ? story.sceneBank.filter((s) => s.cast.some((m) => m.characterId === filterChar)) : story.sceneBank) : []),
    [story, filterChar]
  )
  const providerId = mock ? 'mock' : 'gemini'

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      toast(errorMessage(err))
    }
  }
  const update = (sceneId: string, patch: Partial<SceneBankItem>): Promise<void> =>
    act(async () => {
      await window.api.invoke('scene:update', story!.id, sceneId, patch)
      await refresh()
    })
  const regen = (sceneId: string, aspect: AspectRatio): Promise<void> =>
    act(async () => {
      const s = story!.sceneBank.find((x) => x.id === sceneId)
      await window.api.invoke('images:generateScenes', story!.id, [sceneId], aspect, { regenerate: !!s?.media[aspect] && s.media[aspect]?.provider !== 'focus-crop' })
      toast(`Đã đưa cảnh vào hàng chờ (${aspect})`, 'info')
    })

  // Phím tắt
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (editing || !selectedId || !story || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.ctrlKey || e.metaKey) return
      const idx = scenes.findIndex((s) => s.id === selectedId)
      const key = e.key.toLowerCase()
      if (key === 'a') void update(selectedId, { approval: { status: 'approved' } })
      else if (key === 'r') void regen(selectedId, view)
      else if (key === 'e') setEditing(story.sceneBank.find((s) => s.id === selectedId) ?? null)
      else if (key === 'v') void regen(selectedId, '9:16')
      else if (e.key === 'ArrowRight' && idx < scenes.length - 1) setSelectedId(scenes[idx + 1].id)
      else if (e.key === 'ArrowLeft' && idx > 0) setSelectedId(scenes[idx - 1].id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!story || !library) return <Empty>Chọn Story ở thanh trên.</Empty>

  const approved = story.sceneBank.filter((s) => s.approval.status === 'approved').length
  const waiting7 = release?.pipelineState?.steps[7]?.status === 'waitingApproval'
  const busyIds = new Set(
    (queue?.jobs ?? []).filter((j) => (j.status === 'queued' || j.status === 'running') && j.storyId === story.id).map((j) => (j.payload as { sceneId?: string }).sceneId)
  )
  const issues = story.sceneBank.filter((s) => s.consistency && !s.consistency.ok).length

  const pointFromEvent = (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-sm">
        <div className="flex overflow-hidden rounded-md border border-ink-500">
          {(['16:9', '9:16'] as const).map((a) => (
            <button key={a} onClick={() => setView(a)} className={`px-3 py-1 text-xs ${view === a ? 'bg-blood-600 text-white' : 'bg-ink-700 text-slate-300'}`}>
              {a}
            </button>
          ))}
        </div>
        <select className="input py-1 text-xs" value={filterChar} onChange={(e) => setFilterChar(e.target.value)}>
          <option value="">Mọi nhân vật</option>
          {chars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">
          {approved}/{story.sceneBank.length} cảnh đã duyệt{issues ? ` · ⚠ ${issues} cảnh lệch nhân vật` : ''}
        </span>
        <div className="flex-1" />
        <span className="hidden text-[11px] text-slate-500 xl:inline">Chọn thẻ rồi bấm: A duyệt · R tạo lại · E sửa · V bản dọc · ←/→</span>
        <AsyncButton
          className="btn-ghost text-xs"
          onClick={async () => {
            await window.api.invoke('scene:checkConsistency', story.id, story.sceneBank.filter((s) => s.media['16:9'] && s.cast.length).map((s) => s.id))
            await refresh()
          }}
        >
          Kiểm tra đồng nhất · {llmEstimateLabel(mock, 3000 * story.sceneBank.length, 300 * story.sceneBank.length)}
        </AsyncButton>
        <AsyncButton
          className="btn-secondary text-xs"
          onClick={async () => {
            for (const s of story.sceneBank) if (s.approval.status !== 'approved') await window.api.invoke('scene:update', story.id, s.id, { approval: { status: 'approved' } })
            await refresh()
          }}
        >
          Duyệt tất cả
        </AsyncButton>
        {waiting7 && release ? (
          <AsyncButton
            className="btn-primary text-xs"
            onClick={async () => {
              await window.api.invoke('pipeline:continue', story.id, release.id)
              setScreen('autoedit')
            }}
          >
            ★ Duyệt storyboard & tiếp tục
          </AsyncButton>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {scenes.length === 0 ? <p className="text-sm text-slate-500">Chưa có cảnh. Đề xuất ngân hàng cảnh ở màn Story.</p> : null}
        <div className={`grid gap-3 ${view === '16:9' ? 'grid-cols-[repeat(auto-fill,minmax(300px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'}`}>
          {scenes.map((s) => {
            const idx = story.sceneBank.indexOf(s) + 1
            const m = s.media[view]
            const focus = drag?.id === s.id ? drag : s.focusPoint
            const isSel = selectedId === s.id
            const variants = s.variants.filter((v) => v.aspect === view)
            return (
              <div
                key={s.id}
                className={`panel overflow-hidden ${isSel ? 'ring-2 ring-blood-500' : ''} ${s.approval.status === 'approved' ? 'border-emerald-800' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <div
                  className={`relative select-none bg-ink-900 ${view === '16:9' ? 'aspect-video cursor-crosshair' : 'aspect-[9/16]'}`}
                  title={view === '16:9' ? 'Kéo để đặt focusPoint (tâm cắt dọc & zoom)' : ''}
                  onMouseDown={(e) => {
                    if (view !== '16:9') return
                    setSelectedId(s.id)
                    setDrag({ id: s.id, ...pointFromEvent(e) })
                  }}
                  onMouseMove={(e) => {
                    if (dragRef.current?.id === s.id) setDrag({ id: s.id, ...pointFromEvent(e) })
                  }}
                  onMouseUp={() => {
                    const d = dragRef.current
                    if (d?.id === s.id) {
                      setDrag(null)
                      void update(s.id, { focusPoint: { x: Math.round(d.x * 100) / 100, y: Math.round(d.y * 100) / 100 } })
                    }
                  }}
                  onMouseLeave={() => dragRef.current?.id === s.id && setDrag(null)}
                >
                  {m ? (
                    <img src={mediaUrl(m.path, m.createdAt)} draggable={false} className="h-full w-full object-cover" alt="" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-slate-600">{view === '9:16' ? 'chưa có bản dọc – phím V' : 'chưa có ảnh – phím R'}</div>
                  )}
                  {view === '16:9' ? (
                    <span
                      className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300 shadow"
                      style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
                    />
                  ) : null}
                  <span className="absolute left-1 top-1 rounded bg-ink-950/80 px-1.5 text-xs font-bold text-slate-100">#{idx}</span>
                  <div className="absolute right-1 top-1 flex gap-1">
                    {s.approval.status === 'approved' ? <span className="chip border-emerald-700 bg-ink-950/80 text-emerald-300">✓ duyệt</span> : null}
                    {busyIds.has(s.id) ? <span className="chip border-blood-500 bg-ink-950/80 text-blood-300">đang tạo</span> : null}
                    {m?.provider === 'focus-crop' ? <span className="chip bg-ink-950/80">cắt tự động</span> : null}
                  </div>
                  <div className="absolute bottom-1 left-1 flex -space-x-1.5">
                    {s.cast.map((cm) => {
                      const c = chars.find((x) => x.id === cm.characterId)
                      return c ? <Avatar key={cm.characterId} name={c.name} id={c.id} size={24} ring={c.locked} /> : null
                    })}
                  </div>
                  {s.consistency ? (
                    <span
                      className={`chip absolute bottom-1 right-1 bg-ink-950/80 ${s.consistency.ok ? 'border-emerald-700 text-emerald-300' : 'border-amber-600 text-amber-300'}`}
                      title={s.consistency.issues.join('\n') || 'Nhân vật khớp character sheet'}
                    >
                      {s.consistency.ok ? 'đồng nhất ✓' : `⚠ lệch ${s.consistency.issues.length}`}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1.5 p-2">
                  <div className="text-[11px] text-slate-400">
                    beat {story.outline.beats.find((b) => b.id === s.beatId)?.order} · {SHOT_LABEL[s.shotType]} · {s.cameraAngle}
                    {s.needsVerticalVersion ? <span className="text-night-400"> · cần 9:16 riêng</span> : null}
                  </div>
                  <div className="line-clamp-2 text-xs text-slate-200">{s.description}</div>
                  {s.consistency && !s.consistency.ok ? <div className="text-[11px] text-amber-300">{s.consistency.issues[0]}</div> : null}
                  {variants.length ? (
                    <div className="flex gap-1 overflow-x-auto">
                      {variants.map((v) => (
                        <button
                          key={v.id}
                          title={`${v.note} – bấm để dùng ảnh này`}
                          className={`shrink-0 overflow-hidden rounded border ${v.note.includes('chờ') ? 'border-amber-500' : 'border-ink-500'}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void act(async () => {
                              await window.api.invoke('scene:applyVariant', story.id, s.id, v.id)
                              await refresh()
                            })
                          }}
                        >
                          <img src={mediaUrl(v.media.path, v.media.createdAt)} className={view === '16:9' ? 'h-9 w-16 object-cover' : 'h-16 w-9 object-cover'} alt="" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => void update(s.id, { approval: { status: s.approval.status === 'approved' ? 'pending' : 'approved' } })}>
                      {s.approval.status === 'approved' ? 'Bỏ duyệt' : 'A Duyệt'}
                    </button>
                    <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => void regen(s.id, view)}>
                      R Tạo lại · {imageEstimateLabel(mock, providerId, 1)}
                    </button>
                    <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => setEditing(s)}>
                      E Sửa
                    </button>
                    <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => void regen(s.id, '9:16')}>
                      V Bản dọc
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editing ? (
        <SceneEditModal
          scene={editing}
          characters={chars}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await window.api.invoke('scene:update', story.id, editing.id, patch)
            await refresh()
          }}
        />
      ) : null}
    </div>
  )
}
