import { useMemo, useState } from 'react'
import { pipelineProgress } from '../../../shared/pipeline'
import { charactersForStory } from '../../../shared/logic/voices'
import { Area, AsyncButton, Avatar, Num, Text } from '../components/forms'
import { Empty, LangBadge, Panel, PhaseBadge, PlatformBadge, ProgressBar } from '../components/ui'
import { llmEstimateLabel } from '../lib/estimate'
import { formatUsd, SHOT_LABEL } from '../lib/format'
import { useMediaUrl } from '../lib/preview'
import { castConfirm, sceneBankConfirm } from '../lib/impactText'
import { useApp, useCurrentStory, useMockMode, useReleases } from '../store/appStore'
import { AddReleaseModal } from './story/AddReleaseModal'
import { OutlineEditor } from './story/OutlineEditor'
import { PerformancePanel } from './story/PerformancePanel'

export function StoryScreen(): JSX.Element {
  const story = useCurrentStory()
  const releases = useReleases()
  const library = useApp((s) => s.library)
  const selectRelease = useApp((s) => s.selectRelease)
  const setScreen = useApp((s) => s.setScreen)
  const refresh = useApp((s) => s.refresh)
  const mock = useMockMode()
  const mediaUrl = useMediaUrl(story?.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', premiseVi: '', fictionNoteVi: '', budgetUsd: 0 })
  const [adding, setAdding] = useState<false | true | 'ytEn'>(false)
  const [filterChar, setFilterChar] = useState<string | null>(null)

  const chars = useMemo(() => (story && library ? charactersForStory(story.id, library.characters) : []), [story, library])
  if (!story) return <Empty>Chưa chọn Story.</Empty>

  const charById = new Map(chars.map((c) => [c.id, c]))
  const folklore = library?.folklore.filter((f) => story.folkloreIds.includes(f.id)) ?? []
  const beatOrder = new Map(story.outline.beats.map((b) => [b.id, b.order]))
  const spent = (story.costs?.actual ?? 0) + releases.reduce((s, r) => s + r.costs.actual, 0)
  const approved = story.outline.approval.status === 'approved'
  const storyChars = chars.filter((c) => c.scope === 'story')
  const bank = filterChar ? story.sceneBank.filter((s) => s.cast.some((m) => m.characterId === filterChar)) : story.sceneBank

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="panel p-5">
        {editing ? (
          <div className="space-y-3">
            <Text label="Tên Story" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <Area label="Ý tưởng gốc" value={draft.premiseVi} onChange={(v) => setDraft({ ...draft, premiseVi: v })} rows={3} />
            <Area label="Ghi chú thật / hư cấu" value={draft.fictionNoteVi} onChange={(v) => setDraft({ ...draft, fictionNoteVi: v })} rows={2} />
            <Num label="Ngân sách (USD, 0 = không giới hạn)" value={draft.budgetUsd} onChange={(v) => setDraft({ ...draft, budgetUsd: v })} min={0} />
            <div className="flex gap-2">
              <AsyncButton
                className="btn-primary"
                onClick={async () => {
                  await window.api.invoke('story:update', story.id, draft)
                  setEditing(false)
                  await refresh()
                }}
              >
                Lưu
              </AsyncButton>
              <button className="btn-secondary" onClick={() => setEditing(false)}>
                Huỷ
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-2xl font-semibold text-slate-100">{story.name}</h1>
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  setDraft({ name: story.name, premiseVi: story.premiseVi, fictionNoteVi: story.fictionNoteVi, budgetUsd: story.budget.limitUsd })
                  setEditing(true)
                }}
              >
                Sửa
              </button>
            </div>
            <p className="mt-2 text-slate-300">{story.premiseVi}</p>
            {story.fictionNoteVi ? (
              <div className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                <b>Thật / hư cấu:</b> {story.fictionNoteVi}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {folklore.map((f) => (
                <span key={f.id} className="chip">
                  {f.nameVi} {f.isDocumentedFolklore ? '· dân gian có ghi nhận' : '· hư cấu'}
                </span>
              ))}
              <span>
                Đã chi <b className={story.budget.limitUsd > 0 && spent > story.budget.limitUsd * 0.8 ? 'text-amber-300' : 'text-slate-200'}>{formatUsd(spent)}</b> /
                ngân sách {story.budget.limitUsd > 0 ? formatUsd(story.budget.limitUsd) : 'không giới hạn'}
              </span>
              {mock ? <span className="chip border-night-500 text-night-400">Chế độ Mock</span> : null}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_400px] gap-5">
        <OutlineEditor story={story} />

        <div className="space-y-5">
          <Panel
            title={`Nhân vật (${chars.length})`}
            actions={
              <AsyncButton
                className="btn-secondary text-xs"
                disabled={!approved}
                title={approved ? '' : 'Duyệt dàn ý trước'}
                confirm={castConfirm(story, storyChars, releases)}
                onClick={async () => {
                  await window.api.invoke('story:proposeCast', story.id)
                  await useApp.getState().reloadAll()
                }}
              >
                Đề xuất nhân vật (LLM) · {llmEstimateLabel(mock, 4000, 5000)}
              </AsyncButton>
            }
          >
            <ul className="space-y-2">
              {chars.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <Avatar name={c.name} id={c.id} size={28} ring={c.locked} />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200">
                      {c.name}{' '}
                      <span className="text-[11px] text-slate-500">
                        · {c.scope === 'channel' ? 'nhân vật kênh' : c.role === 'entity' ? 'thực thể' : 'nhân vật truyện'}
                        {c.age ? ` · ${c.age} tuổi` : ''}
                        {c.locked ? ' · đã khoá' : ''}
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{c.appearance}</div>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn-ghost mt-2 text-xs" onClick={() => setScreen('channel')}>
              Sửa nhân vật, trạng thái, giọng → màn Nhân vật
            </button>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              Character sheet, bảng biểu cảm, khoá bằng ảnh <PhaseBadge phase={3} />
            </div>
          </Panel>

          <Panel
            title="Bản phát hành"
            actions={
              <button className="btn-secondary text-xs" onClick={() => setAdding(true)}>
                + Thêm bản phát hành
              </button>
            }
          >
            <div className="space-y-2">
              {releases.map((r) => (
                <button
                  key={r.id}
                  className={`w-full rounded-md border border-ink-600 bg-ink-850 p-3 text-left hover:border-blood-600 ${r.partIndex > 1 ? 'ml-4 w-[calc(100%-1rem)]' : ''}`}
                  onClick={() => {
                    selectRelease(r.id)
                    setScreen('autoedit')
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <LangBadge language={r.language} />
                    <PlatformBadge platform={r.platform} />
                    <span className="chip">{r.aspectRatio}</span>
                    {r.seriesGroupId ? <span className="chip">Phần {r.partIndex}/{r.partCount}</span> : <span className="chip">~{Math.round(r.targetDuration / 60)} phút</span>}
                    {r.script.lines.length === 0 ? <span className="text-[11px] text-amber-300">chưa chuyển thể</span> : null}
                  </div>
                  <div className="mt-1 text-sm text-slate-200">{r.title}</div>
                  <ProgressBar value={pipelineProgress(r.pipelineState)} className="mt-2" />
                </button>
              ))}
              {releases.length === 0 ? <p className="text-sm text-slate-500">Chưa có bản phát hành.</p> : null}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
              Ghi số liệu ở "Sổ hiệu quả" bên dưới – bản TikTok đạt ngưỡng sẽ có gợi ý chuyển thể sang YouTube tiếng Anh.
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        title={`Ngân hàng cảnh – ${story.sceneBank.length} cảnh (dùng chung cho mọi Release)`}
        actions={
          <>
            <select className="input py-1 text-xs" value={filterChar ?? ''} onChange={(e) => setFilterChar(e.target.value || null)}>
              <option value="">Lọc: tất cả nhân vật</option>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <AsyncButton
              className="btn-secondary text-xs"
              disabled={!approved}
              title={approved ? '' : 'Duyệt dàn ý trước'}
              confirm={sceneBankConfirm(story, releases)}
              onClick={async () => {
                await window.api.invoke('story:proposeSceneBank', story.id)
                await refresh()
              }}
            >
              Đề xuất ngân hàng cảnh (LLM) · {llmEstimateLabel(mock, 6000, 9000)}
            </AsyncButton>
          </>
        }
      >
        {bank.length === 0 ? (
          <p className="text-sm text-slate-500">{story.sceneBank.length ? 'Không có cảnh nào có nhân vật này.' : 'Chưa có cảnh. Duyệt dàn ý rồi bấm "Đề xuất ngân hàng cảnh".'}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {bank.map((s) => {
              const m = s.media['16:9']
              const i = story.sceneBank.indexOf(s)
              return (
                <div key={s.id} className="overflow-hidden rounded-md border border-ink-600 bg-ink-850">
                  <div className="relative aspect-video bg-ink-900">
                    {m ? <img src={mediaUrl(m.path, m.createdAt)} className="h-full w-full object-cover" alt="" loading="lazy" /> : null}
                    {!m ? <div className="flex h-full items-center justify-center text-[11px] text-slate-600">Chưa có ảnh – chạy bước 6</div> : null}
                    <span
                      className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300"
                      style={{ left: `${s.focusPoint.x * 100}%`, top: `${s.focusPoint.y * 100}%` }}
                      title="focusPoint"
                    />
                    <div className="absolute bottom-1 left-1 flex -space-x-1.5">
                      {s.cast.map((cm) => {
                        const c = charById.get(cm.characterId)
                        return c ? <Avatar key={cm.characterId} name={c.name} id={c.id} size={22} /> : null
                      })}
                    </div>
                    {s.media['9:16'] ? <span className="chip absolute right-1 top-1 bg-ink-900/80">9:16 ✓</span> : null}
                  </div>
                  <div className="p-2">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <b className="text-slate-200">#{i + 1}</b> · beat {beatOrder.get(s.beatId)} · {SHOT_LABEL[s.shotType]}
                      {s.needsVerticalVersion ? <span className="text-night-400"> · cần 9:16 riêng</span> : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-300">{s.description}</div>
                    {s.cast.length ? (
                      <div className="mt-1 truncate text-[10px] text-teal-300">
                        {s.cast
                          .map((cm) => {
                            const c = charById.get(cm.characterId)
                            const st = c?.states.find((x) => x.id === cm.stateId)
                            return `${c?.name ?? cm.characterId}${cm.expression ? ` (${cm.expression})` : ''}${st ? ` [${st.name}]` : ''}`
                          })
                          .join(' · ')}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <PerformancePanel story={story} releases={releases} onAdapt={() => setAdding('ytEn')} />

      {adding ? (
        <AddReleaseModal storyId={story.id} preset={adding === 'ytEn' ? { platform: 'youtube', language: 'en' } : undefined} onClose={() => setAdding(false)} />
      ) : null}
    </div>
  )
}
