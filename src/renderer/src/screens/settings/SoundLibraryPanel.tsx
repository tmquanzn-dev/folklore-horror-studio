import { useEffect, useState } from 'react'
import type { SoundAsset, SoundKind } from '../../../../shared/types'
import { AsyncButton } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/ui'
import { playAudio } from '../../lib/audio'
import { useApp } from '../../store/appStore'

const KINDS: { value: SoundKind; label: string }[] = [
  { value: 'ambience', label: 'Ambience' },
  { value: 'sfx', label: 'SFX' },
  { value: 'stinger', label: 'Stinger' },
  { value: 'music', label: 'Nhạc' }
]

/** Thư viện âm thanh: chỉ âm thanh đã xác nhận giấy phép mới được tự động đưa vào video */
export function SoundLibraryPanel(): JSX.Element {
  const reloadAll = useApp((s) => s.reloadAll)
  const toast = useApp((s) => s.toast)
  const [info, setInfo] = useState<{ dir: string; assets: SoundAsset[] } | null>(null)
  const [draft, setDraft] = useState<SoundAsset[]>([])
  const [dirty, setDirty] = useState(false)
  const [filter, setFilter] = useState('')

  const load = (r: { dir: string; assets: SoundAsset[] } | null): void => {
    if (!r) return
    setInfo(r)
    setDraft(r.assets)
    setDirty(false)
  }
  useEffect(() => {
    void window.api.invoke('sound:info').then(load)
  }, [])

  const set = (id: string, patch: Partial<SoundAsset>): void => {
    setDraft((d) => d.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    setDirty(true)
  }
  const shown = draft.filter((a) => !filter || `${a.name} ${a.tags.join(' ')} ${a.kind}`.toLowerCase().includes(filter.toLowerCase()))
  const confirmed = draft.filter((a) => a.licenseConfirmed).length

  return (
    <Panel
      title={`Thư viện âm thanh – ${draft.length} file, ${confirmed} đã xác nhận giấy phép`}
      actions={
        dirty ? (
          <AsyncButton
            className="btn-primary text-xs"
            onClick={async () => {
              await window.api.invoke('library:update', { soundAssets: draft })
              setDirty(false)
              await reloadAll()
              toast('Đã lưu thư viện âm thanh', 'info')
            }}
          >
            Lưu thay đổi
          </AsyncButton>
        ) : null
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Thư mục:</span>
        <span className="font-mono text-xs text-slate-300">{info?.dir}</span>
        <AsyncButton className="btn-secondary px-2 py-1 text-xs" onClick={async () => load(await window.api.invoke('sound:chooseFolder'))}>
          <Icon name="folder" className="h-3.5 w-3.5" /> Chọn thư mục
        </AsyncButton>
        <AsyncButton className="btn-secondary px-2 py-1 text-xs" disabled={dirty} onClick={async () => load(await window.api.invoke('sound:rescan'))}>
          Quét lại
        </AsyncButton>
        <AsyncButton
          className="btn-secondary px-2 py-1 text-xs"
          disabled={dirty}
          onClick={async () => {
            load(await window.api.invoke('sound:generateStarter'))
            await reloadAll()
          }}
        >
          Tạo bộ âm thanh mẫu (tự tổng hợp, toàn quyền dùng)
        </AsyncButton>
        <input className="input ml-auto w-48 py-1 text-xs" placeholder="Lọc theo tên / tag" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="mb-2 text-[11px] text-slate-500">
        Đặt file <span className="font-mono">license.txt</span> trong từng thư mục để ghi giấy phép (dòng đầu được đọc). Chỉ âm thanh tích "Đã xác nhận" mới được sound design tự động dùng.
      </p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ink-800 text-left text-[11px] uppercase text-slate-500">
            <tr>
              <th className="py-1">Tên</th>
              <th>Loại</th>
              <th>Tag</th>
              <th>Thời lượng</th>
              <th>Giấy phép</th>
              <th>Đã xác nhận</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className="border-t border-ink-700">
                <td className="max-w-[220px] truncate py-1 text-slate-200" title={a.path}>
                  {a.name}
                </td>
                <td>
                  <select className="input py-0.5 text-xs" value={a.kind} onChange={(e) => set(a.id, { kind: e.target.value as SoundKind })}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="input w-44 py-0.5 text-xs" value={a.tags.join(', ')} onChange={(e) => set(a.id, { tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                </td>
                <td className="text-slate-400">{a.durationSec.toFixed(1)}s</td>
                <td>
                  <input className="input w-48 py-0.5 text-xs" value={a.license} placeholder="vd CC0, gói Epidemic…" onChange={(e) => set(a.id, { license: e.target.value })} />
                </td>
                <td className="text-center">
                  <input type="checkbox" className="accent-blood-500" checked={a.licenseConfirmed} onChange={(e) => set(a.id, { licenseConfirmed: e.target.checked })} />
                </td>
                <td className="text-right">
                  <AsyncButton className="btn-ghost px-1.5 py-0.5" disabled={dirty} onClick={async () => playAudio(await window.api.invoke('sound:preview', a.id))}>
                    <Icon name="play" className="h-3 w-3" />
                  </AsyncButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {draft.length === 0 ? <p className="py-3 text-sm text-slate-500">Chưa có âm thanh. Chọn thư mục hoặc tạo bộ âm thanh mẫu.</p> : null}
      </div>
    </Panel>
  )
}

/** Model ước lượng độ sâu cho parallax 2.5D (chạy local) */
export function DepthModelPanel(): JSX.Element {
  const [st, setSt] = useState<{ hasModel: boolean; path: string; url: string } | null>(null)
  useEffect(() => {
    void window.api.invoke('models:depthStatus').then(setSt)
  }, [])
  return (
    <Panel title="Model depth cho parallax 2.5D (chạy local, onnxruntime)">
      <div className="space-y-2 text-sm">
        <div>
          Trạng thái:{' '}
          {st?.hasModel ? <b className="text-emerald-300">✓ đã có model</b> : <b className="text-amber-300">chưa có – parallax đang dùng depth ước lượng (kém chính xác)</b>}
        </div>
        <div className="font-mono text-[11px] text-slate-500">{st?.path}</div>
        <AsyncButton className="btn-secondary" disabled={st?.hasModel} onClick={async () => setSt(await window.api.invoke('models:downloadDepth'))}>
          Tải model (~27 MB, Depth Anything V2 Small)
        </AsyncButton>
        <p className="text-[11px] text-slate-500">Nguồn: {st?.url}. Đổi model: sửa mục "depth" trong src/config/providers.json. Tiến độ tải hiện trong Nhật ký.</p>
      </div>
    </Panel>
  )
}
