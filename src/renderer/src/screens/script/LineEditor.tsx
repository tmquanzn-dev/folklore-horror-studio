import { useState } from 'react'
import { providersConfig } from '../../../../shared/config'
import type { Character, ScriptLine } from '../../../../shared/types'
import { Area, AsyncButton, Avatar, ListText, Num } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { formatTime } from '../../lib/format'

const ALLOWED_TAGS = providersConfig.tts.elevenlabs.audioTags ?? []

export interface LineEditorProps {
  line: ScriptLine
  index: number
  bilingual: boolean
  speakers: Character[]
  beatOrder: Map<string, number>
  estSec: number
  canPlay: boolean
  onChange: (patch: Partial<ScriptLine>) => void
  onMove: (d: number) => void
  onInsert: () => void
  onDelete: () => void
  onPlay: () => void
  onRewrite: (instruction: string) => Promise<void>
  rewriteLabel: string
  dirty: boolean
}

export function LineEditor(p: LineEditorProps): JSX.Element {
  const [rewriting, setRewriting] = useState(false)
  const [instruction, setInstruction] = useState('')
  const { line } = p
  const speaker = p.speakers.find((s) => s.id === line.speakerId)
  const isDialogue = speaker?.scope !== 'channel'
  const setDelivery = (patch: Partial<ScriptLine['delivery']>): void => p.onChange({ delivery: { ...line.delivery, ...patch } })

  return (
    <div className={`panel p-3 ${isDialogue ? 'border-l-4 border-l-teal-600' : ''}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="w-6 text-right font-mono">{p.index + 1}</span>
        {speaker ? <Avatar name={speaker.name} id={speaker.id} size={20} /> : null}
        <select className="input py-0.5 text-xs" value={line.speakerId} onChange={(e) => p.onChange({ speakerId: e.target.value })}>
          {p.speakers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.scope === 'channel' ? ' (người kể)' : ''}
            </option>
          ))}
        </select>
        <span className="chip">beat {p.beatOrder.get(line.beatId) ?? '?'}</span>
        <span className="chip">~{p.estSec.toFixed(1)}s</span>
        {line.start != null ? <span>@ {formatTime(line.start)}</span> : null}
        {line.approval.status === 'approved' ? <span className="text-emerald-400">✓ đã duyệt</span> : null}
        <div className="flex-1" />
        <button className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={!p.canPlay} title={p.canPlay ? 'Nghe take đã chọn' : 'Chưa có take'} onClick={p.onPlay}>
          <Icon name="play" className="h-3 w-3" /> Nghe
        </button>
        <button className="btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => setRewriting((v) => !v)}>
          Viết lại (LLM)
        </button>
        <button className="btn-ghost px-1.5 py-0.5" title="Lên" onClick={() => p.onMove(-1)}>↑</button>
        <button className="btn-ghost px-1.5 py-0.5" title="Xuống" onClick={() => p.onMove(1)}>↓</button>
        <button className="btn-ghost px-1.5 py-0.5" title="Chèn câu bên dưới" onClick={p.onInsert}>+</button>
        <button className="btn-ghost px-1.5 py-0.5 text-red-300" title="Xoá câu" onClick={p.onDelete}>
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className={`grid gap-3 ${p.bilingual ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Area value={line.text} onChange={(v) => p.onChange({ text: v })} rows={2} className="text-[15px] text-slate-100" />
        {p.bilingual ? (
          <Area value={line.translationVi ?? ''} onChange={(v) => p.onChange({ translationVi: v })} rows={2} className="text-slate-400" placeholder="Bản dịch tiếng Việt" />
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto_auto] items-end gap-2">
        <ListText label={`Tag (${ALLOWED_TAGS.slice(0, 5).join(', ')}…)`} value={line.delivery.tags} onChange={(v) => setDelivery({ tags: v })} />
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Chỉ dẫn diễn xuất</span>
          <input className="input w-full" value={line.delivery.instructions} onChange={(e) => setDelivery({ instructions: e.target.value })} />
        </div>
        <Num label="Nhịp ×" value={line.delivery.pace} onChange={(v) => setDelivery({ pace: v })} step={0.05} min={0.6} max={1.3} className="w-20" />
        <Num label="Lặng trước ms" value={line.delivery.pauseBeforeMs} onChange={(v) => setDelivery({ pauseBeforeMs: v })} step={50} min={0} className="w-24" />
        <Num label="Lặng sau ms" value={line.delivery.pauseAfterMs} onChange={(v) => setDelivery({ pauseAfterMs: v })} step={50} min={0} className="w-24" />
      </div>
      {line.delivery.tags.some((t) => !ALLOWED_TAGS.includes(t)) ? (
        <div className="mt-1 text-[11px] text-amber-300">Tag không có trong danh sách hợp lệ sẽ bị ElevenLabs bỏ qua.</div>
      ) : null}

      {rewriting ? (
        <div className="mt-2 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Chỉ dẫn, vd: ngắn hơn, đáng sợ hơn, bớt giải thích…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <AsyncButton
            className="btn-primary text-xs"
            disabled={p.dirty}
            title={p.dirty ? 'Lưu kịch bản trước khi viết lại' : ''}
            onClick={async () => {
              await p.onRewrite(instruction)
              setRewriting(false)
              setInstruction('')
            }}
          >
            Viết lại · {p.rewriteLabel}
          </AsyncButton>
        </div>
      ) : null}
    </div>
  )
}
