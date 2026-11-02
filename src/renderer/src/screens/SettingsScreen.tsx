import { useEffect, useState } from 'react'
import type { PublicSettings } from '../../../shared/ipc'
import { Field, Panel, PhaseBadge } from '../components/ui'
import { useApp } from '../store/appStore'
import { DepthModelPanel, SoundLibraryPanel } from './settings/SoundLibraryPanel'

const PROVIDERS: { id: string; label: string; phase: number }[] = [
  { id: 'openai', label: 'OpenAI (LLM, TTS, Whisper)', phase: 0 },
  { id: 'elevenlabs', label: 'ElevenLabs (TTS)', phase: 0 },
  { id: 'gemini', label: 'Google Gemini (ảnh – Nano Banana)', phase: 0 }
]

export function SettingsScreen(): JSX.Element {
  const appInfo = useApp((s) => s.appInfo)
  const runAction = useApp((s) => s.runAction)
  const toast = useApp((s) => s.toast)
  const reloadAll = useApp((s) => s.reloadAll)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [budget, setBudget] = useState('')
  const [perf, setPerf] = useState({ views: '', watch: '' })

  useEffect(() => {
    void window.api.invoke('settings:get').then((s) => {
      setSettings(s)
      setBudget(String(s.monthlyBudgetUsd))
      setPerf({ views: String(s.perfMinViews), watch: String(s.perfMinAvgWatch) })
    })
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <Panel title="Dữ liệu">
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-slate-500">Thư mục dữ liệu:</span> <span className="font-mono text-slate-200">{appInfo?.dataRoot}</span>
          </div>
          <div>
            <span className="text-slate-500">Thư mục Story:</span> <span className="font-mono text-slate-200">{appInfo?.storiesRoot}</span>
          </div>
          <div>
            <span className="text-slate-500">File log:</span> <span className="font-mono text-slate-400">{appInfo?.logFile}</span>
          </div>
          <div className="pt-2">
            <button
              className="btn-secondary"
              onClick={() =>
                void runAction(async () => {
                  await window.api.invoke('story:resetSample')
                  toast('Đã khôi phục dữ liệu mẫu', 'info')
                })
              }
            >
              Khôi phục dữ liệu mẫu
            </button>
            <span className="ml-2 text-xs text-slate-500">Ghi đè story.json/release.json mẫu, giữ media đã tạo làm cache.</span>
          </div>
        </div>
      </Panel>

      <Panel title="Chế độ & ngân sách">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Chế độ Mock">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                className="mt-1 accent-blood-500"
                checked={settings?.mockMode ?? true}
                onChange={(e) => {
                  const mockMode = e.target.checked
                  void runAction(async () => {
                    setSettings(await window.api.invoke('settings:update', { mockMode }))
                    await reloadAll()
                    toast(mockMode ? 'Đã bật Chế độ Mock – không gọi API, không tốn phí' : 'Đã tắt Mock – LLM/TTS gọi API thật (có tính phí)', 'info')
                  })
                }}
              />
              <span>
                {settings?.mockMode ?? true ? 'Bật – LLM và giọng đều giả lập, không tốn phí' : 'Tắt – LLM dùng OpenAI, giọng theo provider của từng VoiceProfile'}
                <span className="block text-[11px] text-slate-500">Giọng có provider "mock" luôn chạy offline.</span>
              </span>
            </label>
          </Field>
          <Field label="Ngân sách tháng (USD)">
            <div className="flex gap-2">
              <input className="input w-32" value={budget} onChange={(e) => setBudget(e.target.value)} />
              <button
                className="btn-secondary"
                onClick={() =>
                  void runAction(async () => {
                    setSettings(await window.api.invoke('settings:update', { monthlyBudgetUsd: Number(budget) }))
                    toast('Đã lưu ngân sách', 'info')
                  })
                }
              >
                Lưu
              </button>
            </div>
          </Field>
        </div>
      </Panel>

      <Panel title="Ngưỡng gợi ý chuyển thể (Sổ hiệu quả)">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Lượt xem tối thiểu (bản TikTok)">
            <input className="input w-36" value={perf.views} onChange={(e) => setPerf({ ...perf, views: e.target.value })} />
          </Field>
          <Field label="% xem trung bình tối thiểu">
            <input className="input w-24" value={perf.watch} onChange={(e) => setPerf({ ...perf, watch: e.target.value })} />
          </Field>
          <button
            className="btn-secondary"
            onClick={() =>
              void runAction(async () => {
                const v = Number(perf.views)
                const w = Number(perf.watch)
                if (!Number.isFinite(v) || !Number.isFinite(w)) throw new Error('Ngưỡng phải là số')
                setSettings(await window.api.invoke('settings:update', { perfMinViews: v, perfMinAvgWatch: w }))
                toast('Đã lưu ngưỡng', 'info')
              })
            }
          >
            Lưu
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Khi bản TikTok của một Story đạt cả hai ngưỡng (theo số liệu bạn tự nhập), màn Story sẽ gợi ý "Chuyển thể sang YouTube tiếng Anh".
        </p>
      </Panel>

      <Panel title="API key (mã hoá bằng Windows safeStorage, không gửi sang giao diện)">
        {!settings?.encryptionAvailable ? (
          <p className="mb-3 text-xs text-amber-300">Hệ điều hành không hỗ trợ mã hoá – không thể lưu key.</p>
        ) : null}
        <div className="space-y-3">
          {PROVIDERS.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <span className="w-56 text-sm text-slate-300">{p.label}</span>
              <input
                type="password"
                className="input flex-1"
                placeholder={settings?.apiKeyStatus[p.id] ? '•••••••• (đã lưu – nhập để thay)' : 'Dán API key'}
                value={keys[p.id] ?? ''}
                onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
              />
              <button
                className="btn-secondary"
                disabled={!settings?.encryptionAvailable}
                onClick={() =>
                  void runAction(async () => {
                    setSettings(await window.api.invoke('settings:setApiKey', p.id, keys[p.id] ?? ''))
                    setKeys({ ...keys, [p.id]: '' })
                    toast('Đã lưu key', 'info')
                  })
                }
              >
                Lưu
              </button>
              {p.phase > 0 ? <PhaseBadge phase={p.phase} /> : (
                <span className={`w-20 text-[11px] ${settings?.apiKeyStatus[p.id] ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {settings?.apiKeyStatus[p.id] ? '✓ đã có key' : 'chưa có key'}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Để trống rồi bấm Lưu để xoá key.</p>
      </Panel>

      <SoundLibraryPanel />

      <DepthModelPanel />
    </div>
  )
}
