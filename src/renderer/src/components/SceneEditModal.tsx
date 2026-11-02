import { useState } from 'react'
import type { CastMember, Character, SceneBankItem, ShotType } from '../../../shared/types'
import { SHOT_LABEL } from '../lib/format'
import { Area, AsyncButton, Avatar, Modal, Select, Text } from './forms'
import { Icon } from './Icon'

const POSITIONS: { value: CastMember['position']; label: string }[] = [
  { value: 'left', label: 'Trái' },
  { value: 'center', label: 'Giữa' },
  { value: 'right', label: 'Phải' },
  { value: 'background', label: 'Hậu cảnh' }
]

/** Sửa cast của cảnh: nhân vật, trạng thái ngoại hình, biểu cảm, vị trí, hành động (tối đa 3 người rõ mặt) */
export function CastEditor({ cast, characters, onChange }: { cast: CastMember[]; characters: Character[]; onChange: (c: CastMember[]) => void }): JSX.Element {
  const set = (i: number, patch: Partial<CastMember>): void => onChange(cast.map((m, k) => (k === i ? { ...m, ...patch } : m)))
  const faces = cast.filter((m) => characters.find((c) => c.id === m.characterId)?.role !== 'entity' && m.position !== 'background').length
  return (
    <div className="space-y-2">
      {cast.map((m, i) => {
        const c = characters.find((x) => x.id === m.characterId)
        return (
          <div key={i} className="grid grid-cols-[24px_1.2fr_1fr_1fr_110px_1.4fr_28px] items-center gap-2">
            {c ? <Avatar name={c.name} id={c.id} size={22} ring={c.locked} /> : <span />}
            <select className="input text-xs" value={m.characterId} onChange={(e) => set(i, { characterId: e.target.value, stateId: null })}>
              {characters.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.scope === 'channel' ? ' (kênh)' : ''}
                </option>
              ))}
            </select>
            <select className="input text-xs" value={m.stateId ?? ''} onChange={(e) => set(i, { stateId: e.target.value || null })}>
              <option value="">(trạng thái thường)</option>
              {c?.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input className="input text-xs" list={`expr-${m.characterId}`} placeholder="biểu cảm" value={m.expression} onChange={(e) => set(i, { expression: e.target.value })} />
            <datalist id={`expr-${m.characterId}`}>
              {c?.expressionSheet.map((e) => <option key={e.expression} value={e.expression} />)}
            </datalist>
            <select className="input text-xs" value={m.position} onChange={(e) => set(i, { position: e.target.value as CastMember['position'] })}>
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input className="input text-xs" placeholder="hành động" value={m.action} onChange={(e) => set(i, { action: e.target.value })} />
            <button className="btn-ghost px-1 text-red-300" onClick={() => onChange(cast.filter((_, k) => k !== i))}>
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-3">
        <button
          className="btn-ghost px-2 py-1 text-xs"
          disabled={characters.length === 0}
          onClick={() => onChange([...cast, { characterId: characters[0].id, stateId: null, expression: '', position: 'center', action: '' }])}
        >
          + Thêm nhân vật vào cảnh
        </button>
        <span className={`text-[11px] ${faces > 3 ? 'text-red-300' : 'text-slate-500'}`}>
          {faces}/3 người rõ mặt (thực thể và hậu cảnh không tính) · nhân vật có viền vàng = đã khoá, gửi ảnh tham chiếu
        </span>
      </div>
    </div>
  )
}

/** Hộp thoại sửa cảnh (phím E ở Storyboard): prompt, mô tả, shot, góc máy, cast */
export function SceneEditModal({
  scene,
  characters,
  onSave,
  onClose
}: {
  scene: SceneBankItem
  characters: Character[]
  onSave: (patch: Partial<SceneBankItem>) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [d, setD] = useState({
    description: scene.description,
    imagePrompt: scene.imagePrompt,
    shotType: scene.shotType,
    cameraAngle: scene.cameraAngle,
    needsVerticalVersion: scene.needsVerticalVersion,
    cast: scene.cast
  })
  return (
    <Modal title={`Sửa cảnh ${scene.id}`} onClose={onClose} wide>
      <div className="space-y-3">
        <Area label="Mô tả (tiếng Việt, cho người duyệt)" value={d.description} onChange={(v) => setD({ ...d, description: v })} rows={2} />
        <Area label="Prompt hành động/bố cục (tiếng Anh – phong cách & bible kênh tự ghép thêm)" value={d.imagePrompt} onChange={(v) => setD({ ...d, imagePrompt: v })} rows={3} />
        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Cỡ cảnh"
            value={d.shotType}
            onChange={(v: ShotType) => setD({ ...d, shotType: v })}
            options={(Object.keys(SHOT_LABEL) as ShotType[]).map((k) => ({ value: k, label: SHOT_LABEL[k] }))}
          />
          <Text label="Góc máy" value={d.cameraAngle} onChange={(v) => setD({ ...d, cameraAngle: v })} />
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="accent-blood-500" checked={d.needsVerticalVersion} onChange={(e) => setD({ ...d, needsVerticalVersion: e.target.checked })} />
            Cần bản 9:16 vẽ riêng
          </label>
        </div>
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Nhân vật trong cảnh (cast)</span>
          <CastEditor cast={d.cast} characters={characters} onChange={(cast) => setD({ ...d, cast })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Huỷ
          </button>
          <AsyncButton
            className="btn-primary"
            onClick={async () => {
              await onSave(d)
              onClose()
            }}
          >
            Lưu cảnh
          </AsyncButton>
        </div>
        <p className="text-[11px] text-slate-500">Lưu xong, bấm R (Storyboard) hoặc "Tạo lại" (Film Studio) để vẽ lại ảnh theo nội dung mới.</p>
      </div>
    </Modal>
  )
}
