import { useEffect, useMemo, useState } from 'react'
import { providersConfig } from '../../../shared/config'
import { estimateSpeechSeconds } from '../../../shared/logic/speech'
import { charactersForStory, resolveVoice } from '../../../shared/logic/voices'
import { RELEASE_PIPELINE } from '../../../shared/pipeline'
import type { Script, ScriptLine } from '../../../shared/types'
import { AsyncButton } from '../components/forms'
import { Empty, LangBadge, PlatformBadge } from '../components/ui'
import { playAudio } from '../lib/audio'
import { llmEstimateLabel } from '../lib/estimate'
import { formatTime, SECTION_LABEL } from '../lib/format'
import { useMediaUrl } from '../lib/preview'
import { useApp, useCurrentRelease, useCurrentStory, useMockMode, useReleases } from '../store/appStore'
import { LineEditor } from './script/LineEditor'

/** Script Editor: bản tiếng Anh 2 cột Anh | Việt, bản tiếng Việt 1 cột. Sửa → Lưu ⇒ pipeline chạy lại từ bước 10 (câu không đổi dùng cache). */
export function ScriptEditorScreen(): JSX.Element {
  const story = useCurrentStory()
  const release = useCurrentRelease()
  const releases = useReleases()
  const library = useApp((s) => s.library)
  const refresh = useApp((s) => s.refresh)
  const selectRelease = useApp((s) => s.selectRelease)
  const setScreen = useApp((s) => s.setScreen)
  const mock = useMockMode()
  const mediaUrl = useMediaUrl(story?.id)
  const [draft, setDraft] = useState<Script | null>(release?.script ?? null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDirty(false)
    setDraft(release?.script ?? null)
  }, [release?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) setDraft(release?.script ?? null)
  }, [release?.updatedAt, dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  const speakers = useMemo(() => (story && library ? charactersForStory(story.id, library.characters) : []), [story, library])
  if (!story || !release || !draft || !library) return <Empty>Chọn Story và bản phát hành ở thanh trên.</Empty>

  const bilingual = release.language !== 'vi'
  const beatOrder = new Map(story.outline.beats.map((b) => [b.id, b.order]))
  const est = (l: ScriptLine): number => {
    if (!dirty && l.start != null && l.end != null) return l.end - l.start
    const v = resolveVoice(l.speakerId, release.language, library, story.channelPresetId)
    return estimateSpeechSeconds(l.text, release.language, l.delivery.pace * (v?.speed ?? 1), providersConfig.tts.mock)
  }
  const lineTotal = (l: ScriptLine): number => est(l) + (l.delivery.pauseBeforeMs + l.delivery.pauseAfterMs) / 1000
  const total = draft.lines.reduce((s, l) => s + lineTotal(l), 0)
  const st = release.pipelineState
  const waiting9 = st?.steps[9]?.status === 'waitingApproval'
  const running = !!st?.running
  const series = release.seriesGroupId ? releases.filter((r) => r.seriesGroupId === release.seriesGroupId) : []
  const dialogCount = draft.lines.filter((l) => speakers.find((s) => s.id === l.speakerId)?.scope !== 'channel').length

  const update = (fn: (lines: ScriptLine[]) => ScriptLine[]): void => {
    setDraft({ ...draft, lines: fn(draft.lines) })
    setDirty(true)
  }
  const save = async (): Promise<void> => {
    await window.api.invoke('release:updateScript', story.id, release.id, draft)
    setDirty(false)
    await refresh()
  }

  if (draft.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-10">
        <div className="panel p-6">
          <h2 className="text-lg font-semibold text-slate-100">Bản phát hành chưa có kịch bản</h2>
          <p className="mt-2 text-sm text-slate-400">
            Kịch bản được LLM chuyển thể từ dàn ý ở <b>bước 8</b> của pipeline (theo ngôn ngữ, nền tảng, độ dài
            {release.seriesGroupId ? ', và tự chia phần' : ''}). Pipeline sẽ dừng ở ★7 Duyệt storyboard, rồi ★9 Duyệt kịch bản – lúc đó quay lại đây để sửa.
          </p>
          {story.outline.approval.status !== 'approved' ? (
            <p className="mt-3 text-sm text-amber-300">Dàn ý chưa được duyệt – hãy duyệt ở màn Story trước.</p>
          ) : null}
          <AsyncButton
            className="btn-primary mt-4"
            disabled={running || story.outline.approval.status !== 'approved'}
            onClick={async () => {
              await window.api.invoke('pipeline:start', story.id, release.id, 'review')
              setScreen('autoedit')
            }}
          >
            Chạy pipeline tới bước duyệt kịch bản · {llmEstimateLabel(mock, 8000, release.targetDuration * 60)}
          </AsyncButton>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[270px_minmax(0,1fr)]">
      <aside className="overflow-auto border-r border-ink-700 bg-ink-850 p-4">
        <div className="flex items-center gap-1.5">
          <LangBadge language={release.language} />
          <PlatformBadge platform={release.platform} />
          {release.seriesGroupId ? <span className="chip">Phần {release.partIndex}/{release.partCount}</span> : null}
        </div>
        <div className="mt-3 text-xs text-slate-400">
          Thời lượng: <b className={total > release.targetDuration * 1.2 ? 'text-amber-300' : 'text-slate-100'}>{formatTime(total)}</b> / mục tiêu {formatTime(release.targetDuration)}
        </div>
        <div className="text-xs text-slate-400">
          {draft.lines.length} câu · {dialogCount} câu thoại nhân vật
        </div>

        {series.length > 1 ? (
          <>
            <div className="panel-title mb-2 mt-5">Các phần của series</div>
            <ul className="space-y-1">
              {series.map((r) => {
                const sec = r.script.lines.reduce((s, l) => s + (l.end != null && l.start != null ? l.end - l.start : estimateSpeechSeconds(l.text, r.language, l.delivery.pace, providersConfig.tts.mock)) + (l.delivery.pauseBeforeMs + l.delivery.pauseAfterMs) / 1000, 0)
                return (
                  <li key={r.id}>
                    <button
                      className={`w-full rounded border px-2 py-1.5 text-left text-xs ${r.id === release.id ? 'border-blood-500 bg-blood-700/20 text-slate-100' : 'border-ink-600 text-slate-300 hover:bg-ink-700'}`}
                      onClick={() => {
                        if (!dirty) selectRelease(r.id)
                      }}
                      disabled={dirty}
                      title={dirty ? 'Lưu trước khi chuyển phần' : ''}
                    >
                      Phần {r.partIndex}/{r.partCount} · {r.script.lines.length} câu · ~{formatTime(sec)}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}

        <div className="panel-title mb-2 mt-5">Section</div>
        <ul className="space-y-1.5">
          {draft.sections.map((sec) => {
            const lines = draft.lines.filter((l) => l.sectionId === sec.id)
            return (
              <li key={sec.id} className="rounded border border-ink-600 px-2 py-1.5 text-xs">
                <div className="text-slate-200">{sec.title}</div>
                <div className="text-slate-500">
                  {SECTION_LABEL[sec.kind]} · {lines.length} câu · {formatTime(lines.reduce((s, l) => s + lineTotal(l), 0))}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="panel-title mb-2 mt-5">Beat</div>
        <ul className="space-y-1 text-xs">
          {story.outline.beats.map((b) => (
            <li key={b.id} className="text-slate-400">
              <b className="text-slate-200">{b.order}.</b> {b.summaryVi.slice(0, 70)}…
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-850 px-5 py-2">
          <AsyncButton className="btn-primary" disabled={!dirty || running} onClick={save}>
            Lưu kịch bản
          </AsyncButton>
          <button className="btn-secondary" disabled={!dirty} onClick={() => { setDraft(release.script); setDirty(false) }}>
            Hoàn tác
          </button>
          {waiting9 ? (
            <AsyncButton
              className="btn-primary"
              onClick={async () => {
                if (dirty) await save()
                await window.api.invoke('pipeline:continue', story.id, release.id)
                setScreen('autoedit')
              }}
            >
              ★ Duyệt kịch bản & tiếp tục
            </AsyncButton>
          ) : null}
          <div className="flex-1" />
          {dirty ? <span className="text-xs text-amber-300">Chưa lưu – sau khi lưu, pipeline chạy lại từ bước 10 (câu không đổi giữ giọng cũ)</span> : null}
          {release.partIndex === 1 ? (
            <AsyncButton
              className="btn-secondary text-xs"
              disabled={running}
              confirm={`Xoá kịch bản hiện tại và để LLM chuyển thể lại${release.seriesGroupId ? ' (các phần khác của series sẽ được ghi đè)' : ''}?`}
              onClick={async () => {
                await window.api.invoke('release:clearScript', story.id, release.id)
                await window.api.invoke('pipeline:start', story.id, release.id, 'review')
                setScreen('autoedit')
              }}
            >
              Chuyển thể lại (LLM) · {llmEstimateLabel(mock, 8000, release.targetDuration * 60)}
            </AsyncButton>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {running ? <div className="mb-3 text-xs text-amber-300">Pipeline đang chạy – chỉ xem, sửa sau khi tới điểm duyệt.</div> : null}
          <div className={`mb-2 grid gap-3 px-3 text-[11px] uppercase tracking-wide text-slate-500 ${bilingual ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <span>{bilingual ? 'English (bản phát hành)' : 'Tiếng Việt'}</span>
            {bilingual ? <span>Bản dịch tiếng Việt (để duyệt)</span> : null}
          </div>
          {draft.sections.map((sec) => (
            <section key={sec.id} className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-blood-300">
                {sec.title} {sec.titleVi && sec.titleVi !== sec.title ? <span className="font-normal text-slate-500">– {sec.titleVi}</span> : null}
              </h3>
              <div className="space-y-2">
                {draft.lines.map((l, idx) =>
                  l.sectionId !== sec.id ? null : (
                    <LineEditor
                      key={l.id}
                      line={l}
                      index={idx}
                      bilingual={bilingual}
                      speakers={speakers}
                      beatOrder={beatOrder}
                      estSec={est(l)}
                      dirty={dirty}
                      rewriteLabel={llmEstimateLabel(mock, 2500, 400)}
                      canPlay={l.takes.some((t) => t.id === l.selectedTakeId)}
                      onPlay={() => {
                        const t = l.takes.find((x) => x.id === l.selectedTakeId)
                        if (t) playAudio(mediaUrl(t.path, t.hash))
                      }}
                      onChange={(patch) => update((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...patch } : x)))}
                      onMove={(d) =>
                        update((ls) => {
                          const arr = [...ls]
                          const j = idx + d
                          if (j < 0 || j >= arr.length) return arr
                          ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
                          // Đổi chỗ sang section khác ⇒ câu nhận section của vị trí mới
                          arr[j] = { ...arr[j], sectionId: ls[j].sectionId }
                          arr[idx] = { ...arr[idx], sectionId: ls[idx].sectionId }
                          return arr
                        })
                      }
                      onInsert={() =>
                        update((ls) => {
                          const arr = [...ls]
                          arr.splice(idx + 1, 0, {
                            ...l,
                            id: `${release.id}-n${Date.now().toString(36)}`,
                            text: '…',
                            translationVi: bilingual ? '…' : undefined,
                            takes: [],
                            selectedTakeId: null,
                            start: null,
                            end: null,
                            glossaryTermIds: [],
                            approval: { status: 'pending' }
                          })
                          return arr
                        })
                      }
                      onDelete={() => update((ls) => ls.filter((x) => x.id !== l.id))}
                      onRewrite={async (instruction) => {
                        await window.api.invoke('release:rewriteLine', story.id, release.id, l.id, instruction)
                        await refresh()
                      }}
                    />
                  )
                )}
              </div>
            </section>
          ))}
          <p className="text-[11px] text-slate-500">
            Bước duyệt: {RELEASE_PIPELINE.filter((d) => d.approval).map((d) => `★${d.no} ${d.title}`).join(' · ')}
          </p>
        </div>
      </main>
    </div>
  )
}
