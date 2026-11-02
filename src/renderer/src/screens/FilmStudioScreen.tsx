import { useMemo, useState } from 'react'
import { providersConfig } from '../../../shared/config'
import { charactersForStory } from '../../../shared/logic/voices'
import type { AspectRatio, Job } from '../../../shared/types'
import { AsyncButton, Avatar } from '../components/forms'
import { Icon } from '../components/Icon'
import { Empty, PhaseBadge, ProgressBar } from '../components/ui'
import { imageEstimateLabel } from '../lib/estimate'
import { formatUsd } from '../lib/format'
import { useCharacterUrl, useMediaUrl } from '../lib/preview'
import { useApp, useCurrentStory, useMockMode } from '../store/appStore'

type Mode = 'image' | 'video' | 'character'
type Tab = 'library' | 'queue'

const STATUS: Record<Job['status'], { label: string; cls: string }> = {
  queued: { label: 'Chờ', cls: 'border-ink-500 text-slate-300' },
  running: { label: 'Đang tạo', cls: 'border-blood-500 text-blood-300' },
  done: { label: 'Xong', cls: 'border-emerald-700 text-emerald-300' },
  failed: { label: 'Lỗi', cls: 'border-red-700 text-red-300' },
  cancelled: { label: 'Đã huỷ', cls: 'border-orange-700 text-orange-300' }
}

type ScenePayload = { kind: string; sceneId?: string; characterId?: string; aspect?: string }

export function FilmStudioScreen(): JSX.Element {
  const story = useCurrentStory()
  const library = useApp((s) => s.library)
  const queue = useApp((s) => s.queue)
  const runAction = useApp((s) => s.runAction)
  const toast = useApp((s) => s.toast)
  const mock = useMockMode()
  const mediaUrl = useMediaUrl(story?.id)
  const charUrl = useCharacterUrl()
  const [mode, setMode] = useState<Mode>('image')
  const [tab, setTab] = useState<Tab>('library')
  const [provider, setProvider] = useState<'gemini' | 'mock'>('gemini')
  const [aspect, setAspect] = useState<AspectRatio>('16:9')
  const [filterChar, setFilterChar] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [maxEdge, setMaxEdge] = useState<string>('original')

  const chars = useMemo(() => (story && library ? charactersForStory(story.id, library.characters) : []), [story, library])
  if (!story || !library) return <Empty>Chọn Story ở thanh trên.</Empty>

  const providerId = mock ? 'mock' : provider
  const settings = queue?.settings ?? { concurrency: 4, autoRun: true, autoDl: true }
  const jobs = queue?.jobs ?? []
  const counts = queue?.state.counts ?? { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
  const scenes = filterChar ? story.sceneBank.filter((s) => s.cast.some((m) => m.characterId === filterChar)) : story.sceneBank
  const latestJob = (sceneId: string): Job | undefined =>
    [...jobs].reverse().find((j) => (j.payload as ScenePayload).sceneId === sceneId && (j.payload as ScenePayload).aspect === aspect && j.storyId === story.id)
  const setOpt = (patch: Partial<typeof settings>): void =>
    void runAction(async () => useApp.setState({ queue: await window.api.invoke('queue:setOptions', patch) }))
  const toggle = (id: string): void => {
    const n = new Set(selected)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setSelected(n)
  }
  const sel = scenes.filter((s) => selected.has(s.id))
  const generate = async (ids: string[], regenerate: boolean): Promise<void> => {
    const n = await window.api.invoke('images:generateScenes', story.id, ids, aspect, { providerId, regenerate })
    toast(`Đã đưa ${n} ảnh vào hàng chờ${settings.autoRun ? '' : ' – AUTO đang TẮT, bấm Bắt đầu để chạy'}`, 'info')
    setTab('queue')
  }
  const storyJobs = jobs.filter((j) => j.storyId === story.id || j.storyId === null)
  const spentInQueue = storyJobs.reduce((s, j) => s + j.actualCost, 0)

  return (
    <div className="grid h-full min-h-0 grid-cols-[290px_minmax(0,1fr)]">
      <aside className="space-y-5 overflow-auto border-r border-ink-700 bg-ink-850 p-4 text-sm">
        <div>
          <div className="panel-title mb-2">Chế độ</div>
          <div className="space-y-1.5">
            {(
              [
                ['image', 'Tạo ảnh cảnh', ''],
                ['video', 'Ảnh → Video', 'GĐ4'],
                ['character', 'Đồng nhất nhân vật', 'character sheet, biểu cảm, trạng thái']
              ] as const
            ).map(([v, label, hint]) => (
              <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 ${mode === v ? 'border-blood-500 bg-blood-700/20' : 'border-ink-600'} ${v === 'video' ? 'opacity-50' : ''}`}>
                <input type="radio" className="accent-blood-500" checked={mode === v} disabled={v === 'video'} onChange={() => setMode(v)} />
                <span>
                  {label} {hint ? <span className="text-[11px] text-slate-500">· {hint}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="panel-title">Model</div>
          <select className="input w-full" value={providerId} disabled={mock} onChange={(e) => setProvider(e.target.value as 'gemini' | 'mock')}>
            <option value="gemini">{providersConfig.image.gemini.displayName} · {providersConfig.image.gemini.model}</option>
            <option value="mock">{providersConfig.image.mock.displayName}</option>
          </select>
          {mock ? <div className="text-[11px] text-night-400">Chế độ Mock đang bật ⇒ luôn dùng ảnh placeholder.</div> : null}
        </div>

        <div className="space-y-2">
          <div className="panel-title">Nhân vật / thực thể</div>
          <select className="input w-full" value={filterChar} onChange={(e) => setFilterChar(e.target.value)}>
            <option value="">Tất cả</option>
            {chars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {mode === 'image' ? (
          <div className="space-y-2">
            <div className="panel-title">Tỷ lệ</div>
            <div className="flex overflow-hidden rounded-md border border-ink-500">
              {(['16:9', '9:16', '1:1'] as const).map((a) => (
                <button
                  key={a}
                  disabled={a === '1:1'}
                  title={a === '1:1' ? '1:1 dùng cho ảnh nhân vật (chế độ Đồng nhất nhân vật)' : ''}
                  onClick={() => a !== '1:1' && setAspect(a)}
                  className={`flex-1 px-3 py-1 text-xs disabled:opacity-40 ${aspect === a ? 'bg-blood-600 text-white' : 'bg-ink-700 text-slate-300'}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="panel-title">Số luồng</span>
            <b className="text-slate-100">{settings.concurrency}</b>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={settings.concurrency}
            className="w-full accent-blood-500"
            onChange={(e) => useApp.setState({ queue: queue ? { ...queue, settings: { ...settings, concurrency: Number(e.target.value) } } : null })}
            onMouseUp={(e) => setOpt({ concurrency: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => setOpt({ concurrency: Number((e.target as HTMLInputElement).value) })}
          />
          <div className="text-[11px] text-slate-500">
            Giới hạn riêng: Gemini {providersConfig.image.gemini.maxConcurrency} luồng, Mock {providersConfig.image.mock.maxConcurrency}.
          </div>
          <label className="flex items-center justify-between rounded-md border border-ink-600 px-2 py-1.5">
            <span>
              AUTO: <b className={settings.autoRun ? 'text-emerald-300' : 'text-slate-400'}>{settings.autoRun ? 'ON' : 'OFF'}</b>
              <span className="block text-[11px] text-slate-500">Job mới tự chạy</span>
            </span>
            <input type="checkbox" className="accent-blood-500" checked={settings.autoRun} onChange={(e) => setOpt({ autoRun: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between rounded-md border border-ink-600 px-2 py-1.5">
            <span>
              AUTO DL: <b className={settings.autoDl ? 'text-emerald-300' : 'text-slate-400'}>{settings.autoDl ? 'ON' : 'OFF'}</b>
              <span className="block text-[11px] text-slate-500">{settings.autoDl ? 'Ảnh mới tự áp vào cảnh' : 'Ảnh mới thành biến thể chờ chọn'}</span>
            </span>
            <input type="checkbox" className="accent-blood-500" checked={settings.autoDl} onChange={(e) => setOpt({ autoDl: e.target.checked })} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="panel-title">Tải xuống</div>
          <select className="input w-full" value={maxEdge} onChange={(e) => setMaxEdge(e.target.value)}>
            <option value="original">Độ phân giải gốc</option>
            <option value="1920">Cạnh dài 1920 px</option>
            <option value="1280">Cạnh dài 1280 px</option>
            <option value="720">Cạnh dài 720 px</option>
          </select>
          <AsyncButton
            className="btn-secondary w-full"
            onClick={async () => {
              const r = await window.api.invoke('images:exportZip', story.id, maxEdge === 'original' ? null : Number(maxEdge))
              if (r) toast(`Đã lưu ${r.files} ảnh (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`, 'info')
            }}
          >
            <Icon name="folder" className="h-4 w-4" /> Tải hết (ZIP)
          </AsyncButton>
        </div>
      </aside>

      <main className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-sm">
          {(['library', 'queue'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? 'bg-ink-600 text-slate-100' : 'text-slate-400 hover:bg-ink-700'}`}>
              {t === 'library' ? 'Thư viện' : `Hàng chờ (${counts.queued + counts.running})`}
            </button>
          ))}
          <span className="ml-2 text-xs text-slate-400">
            {counts.running} đang tạo · {counts.queued} chờ · {counts.done} xong · {counts.failed} lỗi · chi phí trong phiên {formatUsd(spentInQueue)}
          </span>
          <div className="flex-1" />
          {queue?.state.paused ? (
            <AsyncButton className="btn-primary text-xs" onClick={async () => useApp.setState({ queue: await window.api.invoke('queue:resume') })}>
              <Icon name="play" className="h-3.5 w-3.5" /> {counts.queued ? 'Bắt đầu / Tiếp tục' : 'Bật chạy'}
            </AsyncButton>
          ) : (
            <AsyncButton className="btn-secondary text-xs" onClick={async () => useApp.setState({ queue: await window.api.invoke('queue:pause') })}>
              <Icon name="pause" className="h-3.5 w-3.5" /> Tạm dừng
            </AsyncButton>
          )}
          <AsyncButton className="btn-ghost text-xs" disabled={counts.queued + counts.running === 0} onClick={async () => useApp.setState({ queue: await window.api.invoke('queue:cancelAll') })}>
            Huỷ tất cả
          </AsyncButton>
          <AsyncButton className="btn-ghost text-xs" onClick={async () => useApp.setState({ queue: await window.api.invoke('queue:clearFinished') })}>
            Dọn job đã xong
          </AsyncButton>
        </div>
        {queue?.state.budgetBlocked ? (
          <div className="border-b border-amber-900 bg-amber-950/50 px-4 py-2 text-xs text-amber-200">⛔ Hàng đợi dừng: {queue.state.budgetBlocked}</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'queue' ? (
            <div className="space-y-1.5">
              {[...jobs].reverse().map((j) => (
                <div key={j.id} className="panel flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-10 text-right font-mono text-xs text-slate-500">#{j.seq}</span>
                  <span className={`chip ${STATUS[j.status].cls}`}>{STATUS[j.status].label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-slate-200">{j.label}</div>
                    {j.error ? <div className="truncate text-[11px] text-amber-300" title={j.error}>{j.error}</div> : null}
                    {j.status === 'running' ? <ProgressBar value={j.progress} className="mt-1" /> : null}
                  </div>
                  <span className="w-16 text-right text-[11px] text-slate-500">{j.providerId}</span>
                  <span className="w-14 text-right text-[11px] text-slate-500">{j.actualCost > 0 ? formatUsd(j.actualCost) : ''}</span>
                  <span className="w-12 text-right text-[11px] text-slate-500">lần {j.attempts}</span>
                  {j.status === 'queued' || j.status === 'running' ? (
                    <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => void window.api.invoke('queue:cancel', j.id)}>
                      Huỷ
                    </button>
                  ) : j.status === 'failed' || j.status === 'cancelled' ? (
                    <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => void window.api.invoke('queue:retry', j.id)}>
                      Thử lại
                    </button>
                  ) : (
                    <span className="w-12" />
                  )}
                </div>
              ))}
              {jobs.length === 0 ? <p className="text-sm text-slate-500">Hàng chờ trống.</p> : null}
            </div>
          ) : mode === 'character' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">
              {chars
                .filter((c) => !filterChar || c.id === filterChar)
                .map((c) => {
                  const views = (['front', 'threeQuarter', 'profile', 'fullBody'] as const).map((v) => c.characterSheet[v])
                  const busy = jobs.some((j) => (j.payload as ScenePayload).characterId === c.id && (j.status === 'queued' || j.status === 'running'))
                  return (
                    <div key={c.id} className={`panel p-3 ${c.locked ? 'border-amber-700' : ''}`}>
                      <div className="mb-2 flex items-center gap-2">
                        <Avatar name={c.name} id={c.id} ring={c.locked} />
                        <b className="text-slate-100">{c.name}</b>
                        <span className="text-[11px] text-slate-500">{c.locked ? 'đã khoá' : 'chưa khoá'}</span>
                        {busy ? <span className="chip border-blood-500 text-blood-300">đang tạo</span> : null}
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {views.map((p, i) => (
                          <div key={i} className="aspect-square overflow-hidden rounded bg-ink-900">
                            {p ? <img src={charUrl(p) ?? ''} className="h-full w-full object-cover" alt="" /> : null}
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.expressionSheet.map((e) =>
                          e.imagePath ? <img key={e.expression} src={charUrl(e.imagePath) ?? ''} title={e.expression} className="h-10 w-10 rounded object-cover" alt="" /> : null
                        )}
                        {c.states.map((s) =>
                          s.referenceImage ? <img key={s.id} src={charUrl(s.referenceImage) ?? ''} title={s.name} className="h-10 w-7 rounded object-cover" alt="" /> : null
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <AsyncButton
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={c.locked}
                          title={c.locked ? 'Đã khoá – mở khoá ở màn Nhân vật để tạo lại' : ''}
                          onClick={() => window.api.invoke('images:generateCharacter', c.id, 'sheet', { regenerate: !!c.characterSheet.front, storyId: story.id, providerId })}
                        >
                          Sheet 4 góc · {imageEstimateLabel(mock, providerId, 4)}
                        </AsyncButton>
                        <AsyncButton
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={!c.characterSheet.front || c.expressionSheet.length === 0}
                          onClick={() => window.api.invoke('images:generateCharacter', c.id, 'expressions', { storyId: story.id, providerId })}
                        >
                          Biểu cảm ({c.expressionSheet.length})
                        </AsyncButton>
                        <AsyncButton
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={!c.characterSheet.front || c.states.length === 0}
                          onClick={() => window.api.invoke('images:generateCharacter', c.id, 'states', { storyId: story.id, providerId })}
                        >
                          Trạng thái ({c.states.length})
                        </AsyncButton>
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <button className="btn-ghost px-2 py-1" onClick={() => setSelected(new Set(scenes.map((s) => s.id)))}>
                  Chọn tất cả
                </button>
                <button className="btn-ghost px-2 py-1" onClick={() => setSelected(new Set(scenes.filter((s) => !s.media[aspect]).map((s) => s.id)))}>
                  Chọn cảnh thiếu ảnh {aspect}
                </button>
                <button className="btn-ghost px-2 py-1" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </button>
                <span className="text-slate-500">Đã chọn {sel.length}</span>
                <div className="flex-1" />
                <AsyncButton className="btn-primary text-xs" disabled={sel.length === 0} onClick={() => generate(sel.map((s) => s.id), true)}>
                  Tạo {sel.length} ảnh {aspect} · {imageEstimateLabel(mock, providerId, sel.length)}
                </AsyncButton>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
                {scenes.map((s) => {
                  const idx = story.sceneBank.indexOf(s) + 1
                  const m = s.media[aspect]
                  const j = latestJob(s.id)
                  const st = j && (j.status === 'queued' || j.status === 'running' || j.status === 'failed') ? STATUS[j.status] : null
                  const pending = s.variants.filter((v) => v.aspect === aspect && v.note.includes('chờ chọn')).length
                  return (
                    <div key={s.id} className={`panel overflow-hidden ${selected.has(s.id) ? 'ring-2 ring-blood-500' : ''}`}>
                      <div className={`relative bg-ink-900 ${aspect === '9:16' ? 'aspect-[9/16] max-h-80' : 'aspect-video'}`} onClick={() => toggle(s.id)}>
                        {m ? <img src={mediaUrl(m.path, m.createdAt)} className="h-full w-full object-cover" alt="" loading="lazy" /> : <div className="flex h-full items-center justify-center text-[11px] text-slate-600">chưa có ảnh {aspect}</div>}
                        <span className="absolute left-1 top-1 rounded bg-ink-950/80 px-1.5 text-xs font-bold text-slate-100">#{idx}</span>
                        <input type="checkbox" className="absolute right-1 top-1 accent-blood-500" checked={selected.has(s.id)} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} />
                        {st ? <span className={`chip absolute bottom-1 left-1 bg-ink-950/80 ${st.cls}`}>{st.label}{j?.status === 'running' ? ` ${Math.round(j.progress * 100)}%` : ''}</span> : null}
                        {m && m.provider === 'focus-crop' ? <span className="chip absolute bottom-1 right-1 bg-ink-950/80">cắt tự động</span> : null}
                      </div>
                      <div className="p-2">
                        <div className="flex items-center gap-1">
                          {s.cast.map((cm) => {
                            const c = chars.find((x) => x.id === cm.characterId)
                            return c ? <Avatar key={cm.characterId} name={c.name} id={c.id} size={18} ring={c.locked} /> : null
                          })}
                          <span className="ml-1 truncate text-[11px] text-slate-400">{s.description}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1">
                          <AsyncButton className="btn-secondary px-2 py-0.5 text-[11px]" onClick={() => generate([s.id], !!m)}>
                            {m ? 'Tạo lại' : 'Tạo'}
                          </AsyncButton>
                          {pending ? <span className="text-[11px] text-amber-300">{pending} ảnh mới chờ chọn (Storyboard)</span> : null}
                          {j?.status === 'failed' ? <span className="truncate text-[11px] text-red-300" title={j.error ?? ''}>{j.error}</span> : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {mode === 'video' ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
              Ảnh → Video (cảnh hero) <PhaseBadge phase={4} />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
