import { useState } from 'react'
import { useApp } from '../store/appStore'
import { Area, AsyncButton, Modal, Num, Select, Text } from './forms'

/** Bước 1 pipeline Story: chọn kênh, truyền thuyết, nhập ý tưởng tiếng Việt, đặt ngân sách */
export function NewStoryModal({ onClose }: { onClose: () => void }): JSX.Element {
  const library = useApp((s) => s.library)
  const reloadAll = useApp((s) => s.reloadAll)
  const selectStory = useApp((s) => s.selectStory)
  const setScreen = useApp((s) => s.setScreen)
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState(library?.channelPresets[0]?.id ?? '')
  const [folkloreIds, setFolkloreIds] = useState<string[]>(library?.folklore[0] ? [library.folklore[0].id] : [])
  const [premise, setPremise] = useState('')
  const [budget, setBudget] = useState(5)

  const toggle = (id: string): void => setFolkloreIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  return (
    <Modal title="Tạo Story mới" onClose={onClose} wide>
      <div className="space-y-4">
        <Text label="Tên Story" value={name} onChange={setName} placeholder="Ví dụ: Bùa yêu ở xóm chợ" />
        <Select
          label="Kênh"
          value={channelId}
          onChange={setChannelId}
          options={(library?.channelPresets ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Truyền thuyết</span>
          <div className="flex flex-wrap gap-2">
            {(library?.folklore ?? []).map((f) => (
              <label key={f.id} className={`chip cursor-pointer ${folkloreIds.includes(f.id) ? 'border-blood-500 text-slate-100' : ''}`}>
                <input type="checkbox" className="accent-blood-500" checked={folkloreIds.includes(f.id)} onChange={() => toggle(f.id)} />
                {f.nameVi}
              </label>
            ))}
            <span className="text-[11px] text-slate-500">Thêm truyền thuyết ở màn Thư viện dân gian.</span>
          </div>
        </div>
        <Area
          label="Ý tưởng gốc (tiếng Việt)"
          value={premise}
          onChange={setPremise}
          rows={4}
          placeholder="Ai, ở đâu (làng hư cấu), chuyện gì xảy ra, nỗi sợ chính là gì…"
        />
        <Num label="Ngân sách Story (USD, 0 = không giới hạn)" value={budget} onChange={setBudget} step={1} min={0} />
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Huỷ
          </button>
          <AsyncButton
            className="btn-primary"
            disabled={!name.trim() || premise.trim().length < 20 || folkloreIds.length === 0}
            onClick={async () => {
              const story = await window.api.invoke('story:create', { name, channelPresetId: channelId, folkloreIds, premiseVi: premise, budgetUsd: budget })
              await reloadAll()
              await selectStory(story.id)
              setScreen('story')
              onClose()
            }}
          >
            Tạo Story
          </AsyncButton>
        </div>
        <p className="text-[11px] text-slate-500">Bước tiếp theo ở màn Story: LLM tạo dàn ý → bạn duyệt → đề xuất nhân vật → đề xuất ngân hàng cảnh → thêm bản phát hành.</p>
      </div>
    </Modal>
  )
}
