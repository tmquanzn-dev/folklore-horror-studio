/**
 * Sổ hiệu quả: người dùng tự nhập số liệu sau khi đăng (app KHÔNG đọc API nền tảng).
 * Bản TikTok đạt ngưỡng ⇒ gợi ý "Chuyển thể sang YouTube tiếng Anh".
 */
import { useEffect, useState } from 'react'
import { adaptSuggestion, engagementRate } from '../../../../shared/logic/business'
import type { PublicSettings } from '../../../../shared/ipc'
import type { Release, Story } from '../../../../shared/types'
import { Area, AsyncButton, Num, Select } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/ui'
import { useApp } from '../../store/appStore'

const today = (): string => new Date().toISOString().slice(0, 10)

export function PerformancePanel({ story, releases, onAdapt }: { story: Story; releases: Release[]; onAdapt: () => void }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [adding, setAdding] = useState(false)
  const empty = { releaseId: releases[0]?.id ?? '', date: today(), views: 0, avgWatchPercent: 0, likes: 0, comments: 0, shares: 0, notes: '' }
  const [draft, setDraft] = useState(empty)

  useEffect(() => {
    void window.api.invoke('settings:get').then(setSettings)
  }, [])

  const t = { minViews: settings?.perfMinViews ?? 10000, minAvgWatchPercent: settings?.perfMinAvgWatch ?? 40 }
  const sug = adaptSuggestion(story.performanceNotes, releases, t)
  const relById = new Map(releases.map((r) => [r.id, r]))

  return (
    <Panel
      title="Sổ hiệu quả"
      actions={
        <button className="btn-secondary text-xs" disabled={releases.length === 0} onClick={() => (setDraft(empty), setAdding(!adding))}>
          {adding ? 'Đóng' : '+ Ghi số liệu'}
        </button>
      }
    >
      {sug.qualifies ? (
        <div className="mb-4 flex items-center gap-3 rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
          <Icon name="star" className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <b>Truyện này đang hút khách!</b> {sug.reason}. Gợi ý chuyển thể sang YouTube tiếng Anh (dài hơn, kiếm tiền tốt hơn).
          </div>
          <button className="btn-primary text-xs" onClick={onAdapt}>
            Chuyển thể sang YouTube tiếng Anh
          </button>
        </div>
      ) : (
        <p className="mb-3 text-xs text-slate-500">
          {sug.reason}. Ngưỡng gợi ý chuyển thể: ≥ {t.minViews.toLocaleString('vi-VN')} lượt xem và ≥ {t.minAvgWatchPercent}% xem trung bình (đổi ở Cài đặt).
        </p>
      )}

      {adding ? (
        <div className="mb-4 space-y-3 rounded-md border border-ink-600 bg-ink-850 p-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <Select
                label="Bản phát hành"
                value={draft.releaseId}
                onChange={(v) => setDraft({ ...draft, releaseId: v })}
                options={releases.map((r) => ({ value: r.id, label: `${r.platform === 'tiktok' ? 'TikTok' : 'YouTube'} ${r.language.toUpperCase()} – ${r.title}` }))}
              />
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Ngày</span>
              <input type="date" className="input w-full" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <Num label="Lượt xem" value={draft.views} onChange={(v) => setDraft({ ...draft, views: v })} min={0} className="w-full" />
            <Num label="% xem trung bình" value={draft.avgWatchPercent} onChange={(v) => setDraft({ ...draft, avgWatchPercent: v })} min={0} max={100} className="w-full" />
            <Num label="Thích" value={draft.likes} onChange={(v) => setDraft({ ...draft, likes: v })} min={0} className="w-full" />
            <Num label="Bình luận" value={draft.comments} onChange={(v) => setDraft({ ...draft, comments: v })} min={0} className="w-full" />
            <Num label="Chia sẻ" value={draft.shares} onChange={(v) => setDraft({ ...draft, shares: v })} min={0} className="w-full" />
          </div>
          <Area label="Ghi chú (bình luận nổi bật, giờ đăng, thumbnail…)" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} rows={2} />
          <div className="flex justify-end">
            <AsyncButton
              className="btn-primary"
              disabled={!draft.releaseId}
              onClick={async () => {
                await window.api.invoke('performance:add', story.id, draft)
                setAdding(false)
                await refresh()
              }}
            >
              Lưu số liệu
            </AsyncButton>
          </div>
        </div>
      ) : null}

      {story.performanceNotes.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có số liệu. Sau khi đăng vài ngày, ghi lại lượt xem và % xem trung bình từ trang phân tích của nền tảng.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1">Ngày</th>
              <th>Bản phát hành</th>
              <th className="text-right">Lượt xem</th>
              <th className="text-right">% xem TB</th>
              <th className="text-right">Tương tác</th>
              <th className="pl-3">Ghi chú</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {story.performanceNotes.map((n) => {
              const r = relById.get(n.releaseId)
              return (
                <tr key={n.id} className="border-t border-ink-700 text-slate-300">
                  <td className="py-1.5">{n.date}</td>
                  <td className="max-w-[220px] truncate">{r ? `${r.platform === 'tiktok' ? 'TikTok' : 'YouTube'} ${r.language.toUpperCase()} – ${r.title}` : n.releaseId}</td>
                  <td className="text-right">{n.views.toLocaleString('vi-VN')}</td>
                  <td className={`text-right ${n.avgWatchPercent >= t.minAvgWatchPercent ? 'text-emerald-300' : ''}`}>{n.avgWatchPercent}%</td>
                  <td className="text-right" title={`${n.likes} thích · ${n.comments} bình luận · ${n.shares} chia sẻ`}>
                    {engagementRate(n)}%
                  </td>
                  <td className="max-w-[240px] truncate pl-3 text-xs text-slate-500">{n.notes}</td>
                  <td className="text-right">
                    <AsyncButton className="btn-ghost px-1 py-0.5 text-xs" confirm="Xoá dòng số liệu này?" onClick={async () => {
                      await window.api.invoke('performance:delete', story.id, n.id)
                      await refresh()
                    }}>
                      <Icon name="x" className="h-3.5 w-3.5" />
                    </AsyncButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
