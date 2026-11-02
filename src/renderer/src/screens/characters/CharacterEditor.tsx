import type { Character, Gender, Language, VoiceProfile } from '../../../../shared/types'
import { Area, AsyncButton, Avatar, ListText, Num, Select, Text } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { playAudio } from '../../lib/audio'
import { imageEstimateLabel } from '../../lib/estimate'
import { useCharacterUrl } from '../../lib/preview'
import { useApp, useMockMode } from '../../store/appStore'

const SAMPLE: Record<Language, string> = {
  en: 'Come closer to the lamp… let me tell you what happened by the river.',
  vi: 'Lại gần ngọn đèn đi con… để bà kể chuyện ở bến sông.'
}

/** Thẻ nhân vật: ngoại hình, trang phục, trạng thái, biểu cảm, giọng theo ngôn ngữ (Nghe thử), khoá */
export function CharacterEditor({
  c,
  voices,
  onChange,
  onDelete,
  canListen,
  storyId
}: {
  c: Character
  voices: VoiceProfile[]
  onChange: (patch: Partial<Character>) => void
  onDelete?: () => void
  canListen: boolean
  /** Story để ghi chi phí ảnh (nhân vật kênh dùng Story đang chọn) */
  storyId: string | null
}): JSX.Element {
  return (
    <div className={`rounded-md border bg-ink-850 p-4 ${c.locked ? 'border-amber-700' : 'border-ink-600'}`}>
      <div className="mb-3 flex items-center gap-3">
        <Avatar name={c.name} id={c.id} size={36} ring={c.locked} />
        <div className="flex-1">
          <Text value={c.name} onChange={(v) => onChange({ name: v })} className="font-semibold" />
        </div>
        <Select
          value={c.role}
          onChange={(v) => onChange({ role: v })}
          className="w-36"
          options={[
            { value: 'narrator', label: 'Người kể' },
            { value: 'character', label: 'Nhân vật' },
            { value: 'entity', label: 'Thực thể (ma)' }
          ]}
        />
        <label className="flex items-center gap-1.5 text-xs text-amber-200" title="Khoá ⇒ mọi ảnh sau dùng ảnh tham chiếu của nhân vật này (GĐ3); đề xuất lại bằng LLM không thay nhân vật đã khoá">
          <input type="checkbox" className="accent-amber-500" checked={c.locked} onChange={(e) => onChange({ locked: e.target.checked, approval: e.target.checked ? { status: 'approved', at: new Date().toISOString() } : { status: 'pending' } })} />
          Khoá
        </label>
        {onDelete ? (
          <button className="btn-ghost px-1.5 py-1 text-red-300" disabled={c.locked} title="Xoá nhân vật" onClick={onDelete}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-[100px_140px_minmax(0,1fr)] gap-3">
        <Num label="Tuổi" value={c.age ?? 0} onChange={(v) => onChange({ age: v > 0 ? v : null })} min={0} className="w-full" />
        <Select
          label="Giới tính"
          value={c.gender}
          onChange={(v: Gender) => onChange({ gender: v })}
          options={[
            { value: 'female', label: 'Nữ' },
            { value: 'male', label: 'Nam' },
            { value: 'other', label: 'Khác' },
            { value: 'unknown', label: 'Không rõ' }
          ]}
        />
        <Text label="Vai trò / tính cách" value={c.description} onChange={(v) => onChange({ description: v })} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Area label="Ngoại hình (khuôn mặt, dáng người, kiểu tóc)" value={c.appearance} onChange={(v) => onChange({ appearance: v })} rows={2} />
        <Area label="Trang phục mặc định" value={c.defaultOutfit} onChange={(v) => onChange({ defaultOutfit: v })} rows={2} />
      </div>
      <div className="mt-3">
        <ListText
          label="Bảng biểu cảm"
          value={c.expressionSheet.map((e) => e.expression)}
          onChange={(arr) =>
            onChange({ expressionSheet: arr.map((e) => c.expressionSheet.find((x) => x.expression === e) ?? { expression: e, prompt: e, imagePath: null }) })
          }
          placeholder="bình thường, sợ hãi, quyết tâm"
        />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Trạng thái ngoại hình theo diễn biến</span>
          <button
            className="btn-ghost px-1.5 py-0.5 text-[11px]"
            onClick={() => onChange({ states: [...c.states, { id: `st-${Date.now().toString(36)}`, name: '', description: '', referenceImage: null }] })}
          >
            + Thêm trạng thái
          </button>
        </div>
        {c.states.length === 0 ? <div className="text-[11px] text-slate-600">(chưa có – ví dụ "ướt sũng", "bị thương nhẹ", "bị nhập")</div> : null}
        {c.states.map((s) => (
          <div key={s.id} className="mb-1 grid grid-cols-[160px_minmax(0,1fr)_auto] gap-2">
            <Text value={s.name} placeholder="tên" onChange={(v) => onChange({ states: c.states.map((x) => (x.id === s.id ? { ...x, name: v } : x)) })} />
            <Text value={s.description} placeholder="mô tả" onChange={(v) => onChange({ states: c.states.map((x) => (x.id === s.id ? { ...x, description: v } : x)) })} />
            <button className="btn-ghost px-1.5 text-red-300" onClick={() => onChange({ states: c.states.filter((x) => x.id !== s.id) })}>
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {(['vi', 'en'] as Language[]).map((lang) => {
          const vid = c.voiceProfileIdByLanguage[lang] ?? ''
          return (
            <div key={lang}>
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Giọng {lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}</span>
              <div className="flex gap-2">
                <select
                  className="input min-w-0 flex-1"
                  value={vid}
                  onChange={(e) => onChange({ voiceProfileIdByLanguage: { ...c.voiceProfileIdByLanguage, [lang]: e.target.value || undefined } })}
                >
                  <option value="">(giọng mặc định của kênh)</option>
                  {voices
                    .filter((v) => v.language === lang)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
                <AsyncButton
                  className="btn-ghost px-2 text-xs"
                  disabled={!vid || !canListen}
                  title={canListen ? 'Nghe thử' : 'Lưu trước khi nghe thử'}
                  onClick={async () => {
                    const r = await window.api.invoke('tts:preview', { text: SAMPLE[lang], voiceProfileId: vid })
                    playAudio(r.dataUrl)
                  }}
                >
                  <Icon name="play" className="h-3 w-3" />
                </AsyncButton>
              </div>
            </div>
          )
        })}
      </div>

      <CharacterImages c={c} storyId={storyId} dirty={!canListen} />
      <div className="mt-2 text-right font-mono text-[11px] text-slate-600">{c.id}</div>
    </div>
  )
}

/** Character sheet 4 góc + ảnh biểu cảm + ảnh trạng thái; tạo qua hàng đợi (Film Studio) */
function CharacterImages({ c, storyId, dirty }: { c: Character; storyId: string | null; dirty: boolean }): JSX.Element {
  const charUrl = useCharacterUrl()
  const mock = useMockMode()
  const queue = useApp((s) => s.queue)
  const toast = useApp((s) => s.toast)
  const busy = (queue?.jobs ?? []).filter((j) => (j.payload as { characterId?: string }).characterId === c.id && (j.status === 'queued' || j.status === 'running')).length
  const provider = mock ? 'mock' : 'gemini'
  const gen = (what: 'sheet' | 'expressions' | 'states', regenerate: boolean) => async (): Promise<void> => {
    const n = await window.api.invoke('images:generateCharacter', c.id, what, { regenerate, storyId })
    toast(`Đã đưa ${n} ảnh vào hàng chờ (Film Studio)`, 'info')
  }
  const tile = (src: string | null | undefined, label: string, tall = false): JSX.Element => (
    <div className="text-center">
      <div className={`overflow-hidden rounded border border-ink-600 bg-ink-900 ${tall ? 'h-28 w-[63px]' : 'h-20 w-20'}`}>
        {src ? <img src={charUrl(src) ?? ''} className="h-full w-full object-cover" alt="" /> : <div className="flex h-full items-center justify-center text-[10px] text-slate-600">chưa có</div>}
      </div>
      <div className="mt-0.5 max-w-[80px] truncate text-[10px] text-slate-500">{label}</div>
    </div>
  )
  return (
    <div className="mt-4 rounded-md border border-ink-600 bg-ink-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Character sheet & ảnh tham chiếu</span>
        {busy ? <span className="chip border-blood-500 text-blood-300">{busy} ảnh đang tạo</span> : null}
        {c.locked ? (
          <span className="text-[11px] text-amber-300">Đã khoá – mọi ảnh cảnh có {c.name} sẽ gửi kèm các ảnh này làm tham chiếu</span>
        ) : (
          <span className="text-[11px] text-slate-500">Duyệt xong thì tích "Khoá" để dùng làm tham chiếu cho mọi cảnh</span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {tile(c.characterSheet.front, 'chính diện')}
        {tile(c.characterSheet.threeQuarter, '3/4')}
        {tile(c.characterSheet.profile, 'nghiêng')}
        {tile(c.characterSheet.fullBody, 'toàn thân', true)}
        <span className="mx-1 h-16 w-px bg-ink-600" />
        {c.expressionSheet.map((e) => tile(e.imagePath, e.expression))}
        {c.states.map((s) => tile(s.referenceImage, s.name || 'trạng thái', true))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <AsyncButton className="btn-secondary px-2 py-1 text-xs" disabled={dirty || c.locked} title={c.locked ? 'Mở khoá để tạo lại' : dirty ? 'Lưu trước' : ''} onClick={gen('sheet', !!c.characterSheet.front)}>
          {c.characterSheet.front ? 'Tạo lại' : 'Tạo'} character sheet · {imageEstimateLabel(mock, provider, 4)}
        </AsyncButton>
        <AsyncButton className="btn-secondary px-2 py-1 text-xs" disabled={dirty || !c.characterSheet.front || c.expressionSheet.length === 0} onClick={gen('expressions', c.expressionSheet.every((e) => e.imagePath))}>
          Ảnh biểu cảm ({c.expressionSheet.length}) · {imageEstimateLabel(mock, provider, c.expressionSheet.length)}
        </AsyncButton>
        <AsyncButton className="btn-secondary px-2 py-1 text-xs" disabled={dirty || !c.characterSheet.front || c.states.length === 0} onClick={gen('states', c.states.every((s) => s.referenceImage))}>
          Ảnh trạng thái ({c.states.length}) · {imageEstimateLabel(mock, provider, c.states.length)}
        </AsyncButton>
      </div>
    </div>
  )
}
