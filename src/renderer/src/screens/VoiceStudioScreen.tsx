import { useEffect, useMemo, useState } from 'react'
import { charactersForStory, resolveVoice } from '../../../shared/logic/voices'
import type { Delivery, Library, ScriptLine, VoiceProfile } from '../../../shared/types'
import { AsyncButton, Avatar, ListText } from '../components/forms'
import { Icon } from '../components/Icon'
import { Waveform } from '../components/Waveform'
import { Empty, LangBadge, PlatformBadge } from '../components/ui'
import { playAudio } from '../lib/audio'
import { ttsEstimateLabel } from '../lib/estimate'
import { formatTime } from '../lib/format'
import { useMediaUrl } from '../lib/preview'
import { PROCESS_PRESETS, presetIdOf } from '../lib/voicePresets'
import { RecordingPanel } from './voice/RecordingPanel'
import { useApp, useCurrentRelease, useCurrentStory, useMockMode } from '../store/appStore'

export function VoiceStudioScreen(): JSX.Element {
  const story = useCurrentStory()
  const release = useCurrentRelease()
  const library = useApp((s) => s.library)
  const reloadAll = useApp((s) => s.reloadAll)
  const refresh = useApp((s) => s.refresh)
  const setScreen = useApp((s) => s.setScreen)
  const mock = useMockMode()
  const mediaUrl = useMediaUrl(story?.id)
  const [edits, setEdits] = useState<Record<string, Delivery>>({})

  useEffect(() => setEdits({}), [release?.id])

  const speakers = useMemo(() => {
    if (!story || !release || !library) return []
    const used = new Set(release.script.lines.map((l) => l.speakerId))
    return charactersForStory(story.id, library.characters).filter((c) => used.has(c.id))
  }, [story, release, library])

  if (!story || !release || !library) return <Empty>Chọn Story và bản phát hành ở thanh trên.</Empty>
  if (release.script.lines.length === 0) return <Empty>Bản phát hành chưa có kịch bản – chuyển thể ở Script Editor / AutoEdit trước.</Empty>

  const lang = release.language
  const voiceOf = (l: ScriptLine): VoiceProfile | null => resolveVoice(l.speakerId, lang, library, story.channelPresetId)
  const st = release.pipelineState
  const running = !!st?.running
  const waiting13 = st?.steps[13]?.status === 'waitingApproval'
  const withTake = release.script.lines.filter((l) => l.takes.some((t) => t.id === l.selectedTakeId)).length
  const usedVoices = [...new Map(release.script.lines.map((l) => voiceOf(l)).filter((v): v is VoiceProfile => !!v).map((v) => [v.id, v])).values()]
  const unlicensed = usedVoices.filter((v) => v.providerId !== 'mock' && !v.commercialLicenseConfirmed)
  const langVoices = library.voiceProfiles.filter((v) => v.language === lang)

  const saveLib = async (patch: Partial<Library>): Promise<void> => {
    await window.api.invoke('library:update', patch)
    await reloadAll()
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-4 overflow-auto border-r border-ink-700 bg-ink-850 p-4">
        <div className="flex items-center gap-1.5">
          <LangBadge language={lang} />
          <PlatformBadge platform={release.platform} />
          <span className="text-xs text-slate-400">{release.title}</span>
        </div>
        <RecordingPanel release={release} />
        <div className="panel-title">Giọng theo người nói ({lang.toUpperCase()})</div>
        {speakers.map((c) => {
          const v = resolveVoice(c.id, lang, library, story.channelPresetId)
          const sample = release.script.lines.find((l) => l.speakerId === c.id)?.text ?? c.name
          return (
            <div key={c.id} className="rounded-md border border-ink-600 bg-ink-800 p-3 text-sm">
              <div className="flex items-center gap-2">
                <Avatar name={c.name} id={c.id} size={26} />
                <span className="text-slate-100">{c.name}</span>
                <span className="text-[11px] text-slate-500">{c.scope === 'channel' ? 'người kể' : c.role === 'entity' ? 'thực thể' : 'nhân vật'}</span>
              </div>
              <select
                className="input mt-2 w-full text-xs"
                value={c.voiceProfileIdByLanguage[lang] ?? ''}
                onChange={(e) => {
                  const characters = library.characters.map((x) =>
                    x.id === c.id ? { ...x, voiceProfileIdByLanguage: { ...x.voiceProfileIdByLanguage, [lang]: e.target.value || undefined } } : x
                  )
                  void useApp.getState().runAction(() => saveLib({ characters }))
                }}
              >
                <option value="">(giọng mặc định của kênh)</option>
                {langVoices.map((vp) => (
                  <option key={vp.id} value={vp.id}>
                    {vp.name} · {vp.providerId}
                  </option>
                ))}
              </select>
              {v ? (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="input flex-1 py-1 text-xs"
                      value={presetIdOf(v.postProcessChain)}
                      onChange={(e) => {
                        const p = PROCESS_PRESETS.find((x) => x.id === e.target.value)
                        if (!p) return
                        const voiceProfiles = library.voiceProfiles.map((x) => (x.id === v.id ? { ...x, postProcessChain: p.chain } : x))
                        void useApp.getState().runAction(() => saveLib({ voiceProfiles }))
                      }}
                    >
                      {PROCESS_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          Xử lý: {p.label}
                        </option>
                      ))}
                      {presetIdOf(v.postProcessChain) === 'custom' ? <option value="custom">Xử lý: tuỳ chỉnh</option> : null}
                    </select>
                    <AsyncButton
                      className="btn-ghost px-2 py-1 text-xs"
                      title={`Nghe thử: "${sample.slice(0, 60)}"`}
                      onClick={async () => {
                        const r = await window.api.invoke('tts:preview', { text: sample, voiceProfileId: v.id })
                        playAudio(r.dataUrl)
                      }}
                    >
                      <Icon name="play" className="h-3 w-3" /> Nghe thử
                    </AsyncButton>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      className="accent-blood-500"
                      checked={v.commercialLicenseConfirmed}
                      onChange={(e) => {
                        const voiceProfiles = library.voiceProfiles.map((x) => (x.id === v.id ? { ...x, commercialLicenseConfirmed: e.target.checked } : x))
                        void useApp.getState().runAction(() => saveLib({ voiceProfiles }))
                      }}
                    />
                    Đã xác nhận giấy phép thương mại ({v.providerId})
                  </label>
                </>
              ) : (
                <div className="mt-2 text-[11px] text-red-300">Chưa có giọng {lang.toUpperCase()} – chọn ở trên hoặc tạo ở màn Nhân vật → Giọng.</div>
              )}
            </div>
          )
        })}
        <button className="btn-ghost text-xs" onClick={() => setScreen('channel')}>
          Tạo / sửa hồ sơ giọng (provider, voice id, chỉ dẫn) → màn Nhân vật
        </button>
      </aside>

      <main className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-850 px-5 py-2 text-sm">
          <span className="text-slate-300">
            {release.voiceSource === 'recorded' ? 'Nguồn giọng: tự thu · ' : ''}
            {withTake}/{release.script.lines.length} câu đã có giọng TTS
            {release.voiceTrack ? ` · voice track ${formatTime(release.voiceTrack.duration)}` : ''}
          </span>
          {withTake < release.script.lines.length && !running && release.voiceSource !== 'recorded' ? (
            <AsyncButton
              className="btn-secondary text-xs"
              onClick={async () => {
                await window.api.invoke('pipeline:start', story.id, release.id, 'review')
                setScreen('autoedit')
              }}
            >
              Chạy pipeline để tạo giọng còn thiếu
            </AsyncButton>
          ) : null}
          {waiting13 ? (
            <AsyncButton
              className="btn-primary text-xs"
              onClick={async () => {
                await window.api.invoke('pipeline:continue', story.id, release.id)
                setScreen('autoedit')
              }}
            >
              ★ Duyệt giọng & tiếp tục
            </AsyncButton>
          ) : null}
          <div className="flex-1" />
          {running ? <span className="text-xs text-amber-300">Pipeline đang chạy – chỉ nghe, chưa sửa được</span> : null}
        </div>
        {unlicensed.length ? (
          <div className="border-b border-amber-900 bg-amber-950/40 px-5 py-2 text-xs text-amber-200">
            ⚠ Chưa xác nhận giấy phép thương mại: {unlicensed.map((v) => v.name).join(', ')}. Kiểm tra điều khoản provider trước khi đăng.
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-5">
          <div className="text-[11px] text-slate-500">Mỗi câu: tag · nhịp × · lặng trước (ms) · lặng sau (ms) – sửa rồi bấm "Lưu & tạo lại".</div>
          {release.script.lines.map((l, i) => {
            const speaker = library.characters.find((c) => c.id === l.speakerId)
            const take = l.takes.find((t) => t.id === l.selectedTakeId) ?? null
            const v = voiceOf(l)
            const d = edits[l.id] ?? l.delivery
            const changed = !!edits[l.id] && JSON.stringify(edits[l.id]) !== JSON.stringify(l.delivery)
            const setD = (patch: Partial<Delivery>): void => setEdits({ ...edits, [l.id]: { ...d, ...patch } })
            return (
              <div key={l.id} className="panel flex gap-3 p-3">
                <div className="w-6 pt-1 text-right font-mono text-[11px] text-slate-500">{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    {speaker ? <Avatar name={speaker.name} id={speaker.id} size={18} /> : null}
                    <span className="text-slate-300">{speaker?.name ?? l.speakerId}</span>
                    <span>· {v?.name ?? 'chưa có giọng'}</span>
                    {l.start != null ? <span>· @ {formatTime(l.start)}</span> : null}
                    {l.alignConfidence != null ? (
                      <span className={l.alignConfidence < 0.6 ? 'font-semibold text-red-400' : 'text-emerald-400'} title="Độ khớp với file tự thu">
                        · khớp {Math.round(l.alignConfidence * 100)}%
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-100">{l.text}</p>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_80px_90px_90px] items-end gap-2">
                    <ListText value={d.tags} onChange={(tags) => setD({ tags })} placeholder="tag: whispers, sighs…" />
                    <input type="number" className="input" step={0.05} min={0.6} max={1.3} value={d.pace} title="Nhịp" onChange={(e) => setD({ pace: Number(e.target.value) })} />
                    <input type="number" className="input" step={50} min={0} value={d.pauseBeforeMs} title="Lặng trước (ms)" onChange={(e) => setD({ pauseBeforeMs: Number(e.target.value) })} />
                    <input type="number" className="input" step={50} min={0} value={d.pauseAfterMs} title="Lặng sau (ms)" onChange={(e) => setD({ pauseAfterMs: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex w-[330px] shrink-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Waveform storyId={story.id} relPath={take?.path ?? null} />
                    <span className="text-[11px] text-slate-400">{take ? `${take.duration.toFixed(1)}s` : ''}</span>
                  </div>
                  <select
                    className="input py-1 text-xs"
                    value={l.selectedTakeId ?? ''}
                    disabled={running || l.takes.length < 2}
                    onChange={(e) =>
                      void useApp.getState().runAction(async () => {
                        await window.api.invoke('voice:selectTake', story.id, release.id, l.id, e.target.value)
                        await refresh()
                      })
                    }
                  >
                    {l.takes.length === 0 ? <option value="">(chưa có take)</option> : null}
                    {l.takes.map((t, k) => (
                      <option key={t.id} value={t.id}>
                        Take {k + 1} · {t.provider} · {t.duration.toFixed(1)}s · {new Date(t.createdAt).toLocaleTimeString('vi-VN')}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-1">
                    <button className="btn-ghost px-2 py-0.5 text-[11px]" disabled={!take} onClick={() => take && playAudio(mediaUrl(take.path, take.hash))}>
                      <Icon name="play" className="h-3 w-3" /> Gốc
                    </button>
                    <AsyncButton
                      className="btn-ghost px-2 py-0.5 text-[11px]"
                      disabled={!take}
                      onClick={async () => {
                        const r = await window.api.invoke('voice:processPreview', story.id, release.id, l.id)
                        playAudio(mediaUrl(r.processedPath))
                      }}
                    >
                      <Icon name="play" className="h-3 w-3" /> Sau xử lý
                    </AsyncButton>
                    <AsyncButton
                      className={changed ? 'btn-primary px-2 py-0.5 text-[11px]' : 'btn-secondary px-2 py-0.5 text-[11px]'}
                      disabled={running}
                      onClick={async () => {
                        if (changed) {
                          const script = { ...release.script, lines: release.script.lines.map((x) => (x.id === l.id ? { ...x, delivery: d } : x)) }
                          await window.api.invoke('release:updateScript', story.id, release.id, script)
                        }
                        const updated = await window.api.invoke('voice:regenerateLine', story.id, release.id, l.id)
                        setEdits((e) => {
                          const n = { ...e }
                          delete n[l.id]
                          return n
                        })
                        await refresh()
                        const nl = updated.script.lines.find((x) => x.id === l.id)
                        const nt = nl?.takes.find((t) => t.id === nl.selectedTakeId)
                        if (nt) playAudio(mediaUrl(nt.path, nt.hash))
                      }}
                    >
                      {changed ? 'Lưu & tạo lại' : 'Tạo lại'} · {ttsEstimateLabel(mock, v?.providerId ?? 'mock', l.text.length)}
                    </AsyncButton>
                  </div>
                </div>
              </div>
            )
          })}
          <p className="text-[11px] text-slate-500">
            Đổi take / tạo lại câu ⇒ các bước từ 12 (ghép giọng) trở đi chuyển về "Chờ"; bấm Bắt đầu ở AutoEdit để ghép lại – câu khác dùng cache.
          </p>
        </div>
      </main>
    </div>
  )
}
