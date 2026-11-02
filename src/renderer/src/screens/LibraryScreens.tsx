import type { FolkloreEntry, Language, PronunciationEntry } from '../../../shared/types'
import { Area, AsyncButton, Text } from '../components/forms'
import { Icon } from '../components/Icon'
import { Empty, Panel } from '../components/ui'
import { playAudio } from '../lib/audio'
import { useLibraryDraft } from '../lib/useLibraryDraft'
import { useApp } from '../store/appStore'
export { ChannelScreen } from './characters/CharactersScreen'

const uid = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Thư viện dân gian: FolkloreEntry + từ điển phát âm theo ngôn ngữ (có Nghe thử) */
export function FolkloreScreen(): JSX.Element {
  const { draft, dirty, setDraft, reset, save } = useLibraryDraft()
  const runAction = useApp((s) => s.runAction)
  if (!draft) return <Empty>Đang tải…</Empty>
  const channel = draft.channelPresets[0]

  const setFolk = (id: string, patch: Partial<FolkloreEntry>): void =>
    setDraft((l) => ({ ...l, folklore: l.folklore.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  const setPron = (id: string, patch: Partial<PronunciationEntry>): void =>
    setDraft((l) => ({ ...l, pronunciations: l.pronunciations.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))

  const listen = (lang: Language, text: string, applyDictionary: boolean): void => {
    const voiceProfileId = channel?.defaultVoiceByLanguage[lang]
    if (!voiceProfileId) return
    void runAction(async () => {
      const r = await window.api.invoke('tts:preview', { text, voiceProfileId, applyDictionary })
      playAudio(r.dataUrl)
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {dirty ? (
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-md border border-amber-700 bg-amber-950/90 px-4 py-2 text-sm text-amber-100">
          Có thay đổi chưa lưu.
          <div className="flex-1" />
          <button className="btn-secondary" onClick={reset}>
            Huỷ
          </button>
          <AsyncButton className="btn-primary" onClick={() => save(['folklore', 'pronunciations'])}>
            Lưu thư viện
          </AsyncButton>
        </div>
      ) : null}

      <Panel
        title="Truyền thuyết (FolkloreEntry)"
        actions={
          <button
            className="btn-secondary text-xs"
            onClick={() =>
              setDraft((l) => ({
                ...l,
                folklore: [
                  ...l.folklore,
                  { id: uid('folk'), nameVi: 'Truyền thuyết mới', nameEn: '', region: '', summaryVi: '', summaryEn: '', visualDesign: '', referenceImages: [], sources: [], isDocumentedFolklore: true }
                ]
              }))
            }
          >
            + Thêm truyền thuyết
          </button>
        }
      >
        <div className="space-y-4">
          {draft.folklore.map((f) => (
            <div key={f.id} className="rounded-md border border-ink-600 bg-ink-850 p-4">
              <div className="grid grid-cols-3 gap-3">
                <Text label="Tên tiếng Việt" value={f.nameVi} onChange={(v) => setFolk(f.id, { nameVi: v })} />
                <Text label="Tên tiếng Anh" value={f.nameEn} onChange={(v) => setFolk(f.id, { nameEn: v })} />
                <Text label="Vùng" value={f.region} onChange={(v) => setFolk(f.id, { region: v })} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Area label="Tóm tắt (VI)" value={f.summaryVi} onChange={(v) => setFolk(f.id, { summaryVi: v })} rows={3} />
                <Area label="Tóm tắt (EN)" value={f.summaryEn} onChange={(v) => setFolk(f.id, { summaryEn: v })} rows={3} />
              </div>
              <div className="mt-3">
                <Area label="Thiết kế hình ảnh cố định của thực thể" value={f.visualDesign} onChange={(v) => setFolk(f.id, { visualDesign: v })} rows={2} />
              </div>
              <div className="mt-3">
                <Area label="Nguồn tư liệu (mỗi dòng một nguồn)" value={f.sources.join('\n')} onChange={(v) => setFolk(f.id, { sources: v.split('\n') })} rows={2} />
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2 text-slate-300">
                  <input type="checkbox" className="accent-blood-500" checked={f.isDocumentedFolklore} onChange={(e) => setFolk(f.id, { isDocumentedFolklore: e.target.checked })} />
                  Truyền thuyết dân gian có ghi nhận (bỏ chọn = hư cấu của kênh)
                </label>
                <div className="flex-1" />
                <button className="btn-ghost text-xs text-red-300" onClick={() => setDraft((l) => ({ ...l, folklore: l.folklore.filter((x) => x.id !== f.id) }))}>
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {(['en', 'vi'] as Language[]).map((lang) => (
        <Panel
          key={lang}
          title={`Từ điển phát âm – ${lang === 'en' ? 'tiếng Anh' : 'tiếng Việt'}`}
          actions={
            <button
              className="btn-secondary text-xs"
              onClick={() =>
                setDraft((l) => ({ ...l, pronunciations: [...l.pronunciations, { id: uid(`pr-${lang}`), language: lang, term: '', ttsRespelling: '', notes: '' }] }))
              }
            >
              + Thêm thuật ngữ
            </button>
          }
        >
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-2">Thuật ngữ (hiển thị)</th>
                <th className="pr-2">Cách đọc gửi TTS</th>
                <th className="pr-2">Chú thích glossary (EN, để trống = không có thẻ)</th>
                <th className="pr-2">Ghi chú</th>
                <th className="w-48" />
              </tr>
            </thead>
            <tbody>
              {draft.pronunciations
                .filter((p) => p.language === lang)
                .map((p) => (
                  <tr key={p.id} className="border-t border-ink-700 align-top">
                    <td className="py-1.5 pr-2">
                      <Text value={p.term} onChange={(v) => setPron(p.id, { term: v })} className="italic text-amber-200" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Text value={p.ttsRespelling} onChange={(v) => setPron(p.id, { ttsRespelling: v })} className="font-mono" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Text value={p.glossEn ?? ''} onChange={(v) => setPron(p.id, { glossEn: v || undefined })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Text value={p.notes} onChange={(v) => setPron(p.id, { notes: v })} />
                    </td>
                    <td className="py-1.5 text-right">
                      <button className="btn-ghost px-1.5 py-0.5 text-[11px]" title="Nghe TTS đọc nguyên văn" disabled={!p.term} onClick={() => listen(lang, p.term, false)}>
                        <Icon name="play" className="h-3 w-3" /> Gốc
                      </button>
                      <button
                        className="btn-ghost px-1.5 py-0.5 text-[11px]"
                        title={dirty ? 'Lưu trước để nghe cách đọc mới' : 'Nghe sau khi áp từ điển'}
                        disabled={!p.term || dirty}
                        onClick={() => listen(lang, p.term, true)}
                      >
                        <Icon name="play" className="h-3 w-3" /> Đã sửa
                      </button>
                      <button className="btn-ghost px-1.5 py-0.5 text-red-300" onClick={() => setDraft((l) => ({ ...l, pronunciations: l.pronunciations.filter((x) => x.id !== p.id) }))}>
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">
            Nghe thử dùng giọng mặc định của kênh cho {lang === 'en' ? 'tiếng Anh' : 'tiếng Việt'}. Cách đọc chỉ áp vào văn bản gửi TTS – phụ đề giữ nguyên thuật ngữ.
          </p>
        </Panel>
      ))}
    </div>
  )
}
