/**
 * Sổ chi phí: tổng hợp mọi khoản chi (LLM, TTS, ảnh, video) từ ledger của Story/Release theo tháng.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostReport } from '../../../shared/logic/business'
import { AsyncButton } from '../components/forms'
import { Icon } from '../components/Icon'
import { Empty, Panel } from '../components/ui'
import { formatUsd } from '../lib/format'
import { useApp } from '../store/appStore'

const KIND_LABEL: Record<string, string> = { llm: 'LLM (kịch bản)', tts: 'Giọng đọc', image: 'Ảnh', video: 'Video AI', stt: 'Nhận dạng giọng', render: 'Render' }

function monthOptions(n = 12): string[] {
  const d = new Date()
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
  })
}

function Bars({ items }: { items: { label: string; total: number; budget?: number }[] }): JSX.Element {
  const max = Math.max(0.0001, ...items.map((i) => Math.max(i.total, i.budget ?? 0)))
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const over = i.budget && i.budget > 0 && i.total > i.budget
        return (
          <li key={i.label} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate text-slate-300">{i.label}</span>
              <span className={over ? 'text-red-400' : 'text-slate-200'}>
                {formatUsd(i.total)}
                {i.budget ? <span className="text-slate-500"> / {formatUsd(i.budget)}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-600">
              <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-blood-500'}`} style={{ width: `${(i.total / max) * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function CostsScreen(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const months = useMemo(() => monthOptions(), [])
  const [month, setMonth] = useState(months[0])
  const [report, setReport] = useState<CostReport | null>(null)
  const [budget, setBudget] = useState(0)

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([window.api.invoke('costs:report', month), window.api.invoke('settings:get')])
      setReport(r)
      setBudget(s.monthlyBudgetUsd)
    } catch (e) {
      toast(String(e))
    }
  }, [month, toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex items-center gap-3">
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              Tháng {m.slice(5)}/{m.slice(0, 4)}
            </option>
          ))}
          <option value="all">Toàn bộ</option>
        </select>
        <button className="btn-ghost text-xs" onClick={() => void load()}>
          <Icon name="refresh" className="h-4 w-4" /> Làm mới
        </button>
        <div className="flex-1" />
        <AsyncButton
          className="btn-secondary text-xs"
          onClick={async () => {
            const p = await window.api.invoke('costs:exportCsv', month)
            if (p) toast(`Đã xuất ${p}`, 'info')
          }}
        >
          <Icon name="folder" className="h-4 w-4" /> Xuất CSV
        </AsyncButton>
      </div>

      {!report ? (
        <Empty>Đang tải…</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="panel p-4">
              <div className="panel-title">Tổng chi {month === 'all' ? '' : 'tháng'}</div>
              <div className={`mt-1 text-3xl font-semibold ${month !== 'all' && budget > 0 && report.total > budget ? 'text-red-400' : 'text-slate-100'}`}>{formatUsd(report.total)}</div>
              {month !== 'all' ? <div className="text-[11px] text-slate-500">Ngân sách tháng {budget > 0 ? formatUsd(budget) : 'không giới hạn'}</div> : null}
            </div>
            <div className="panel p-4">
              <div className="panel-title">Số khoản chi</div>
              <div className="mt-1 text-3xl font-semibold text-slate-100">{report.rows.length}</div>
            </div>
            <div className="panel p-4">
              <div className="panel-title">Story tốn nhất</div>
              <div className="mt-1 truncate text-lg font-semibold text-slate-100">{report.byStory[0]?.storyName ?? '—'}</div>
              <div className="text-[11px] text-slate-500">{report.byStory[0] ? formatUsd(report.byStory[0].total) : ''}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-5">
            <Panel title="Theo Story (so với ngân sách Story)">
              {report.byStory.length ? <Bars items={report.byStory.map((s) => ({ label: s.storyName, total: s.total, budget: s.budget }))} /> : <p className="text-sm text-slate-500">Không có.</p>}
            </Panel>
            <Panel title="Theo nhà cung cấp">
              {report.byProvider.length ? <Bars items={report.byProvider.map((s) => ({ label: s.provider, total: s.total }))} /> : <p className="text-sm text-slate-500">Không có.</p>}
            </Panel>
            <Panel title="Theo loại">
              {report.byKind.length ? <Bars items={report.byKind.map((s) => ({ label: KIND_LABEL[s.kind] ?? s.kind, total: s.total }))} /> : <p className="text-sm text-slate-500">Không có.</p>}
            </Panel>
          </div>

          <Panel title="Chi tiết">
            {report.rows.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa có khoản chi nào trong kỳ này. Chế độ Mock không tốn phí.</p>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-ink-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1">Thời điểm</th>
                      <th>Story</th>
                      <th>Bản phát hành</th>
                      <th>Loại</th>
                      <th>Nhà cung cấp</th>
                      <th className="text-right">Số lượng</th>
                      <th className="text-right">Chi phí</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.rows]
                      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                      .map((r, i) => (
                        <tr key={i} className="border-t border-ink-700 text-slate-300">
                          <td className="py-1 text-xs">{new Date(r.timestamp).toLocaleString('vi-VN')}</td>
                          <td className="max-w-[160px] truncate">{r.storyName}</td>
                          <td className="max-w-[200px] truncate text-xs">{r.releaseTitle ?? '(Story)'}</td>
                          <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                          <td className="text-xs">{r.provider}</td>
                          <td className="text-right">{r.units}</td>
                          <td className="text-right">{formatUsd(r.cost)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
