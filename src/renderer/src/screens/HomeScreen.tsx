import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { NewStoryModal } from '../components/NewStoryModal'
import { LangBadge, Panel, PlatformBadge, ProgressBar } from '../components/ui'
import { formatUsd } from '../lib/format'
import { useApp } from '../store/appStore'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp',
  testing: 'Đang thử (TikTok)',
  adapted: 'Đã chuyển thể',
  archived: 'Lưu trữ'
}

export function HomeScreen(): JSX.Element {
  const stories = useApp((s) => s.stories)
  const selectStory = useApp((s) => s.selectStory)
  const selectRelease = useApp((s) => s.selectRelease)
  const setScreen = useApp((s) => s.setScreen)
  const [monthCost, setMonthCost] = useState(0)
  const [budget, setBudget] = useState(0)
  // Chi phí thật của tháng hiện tại từ sổ chi phí (ledger), tải lại khi danh sách Story đổi
  useEffect(() => {
    const m = new Date()
    const month = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
    void window.api.invoke('costs:report', month).then((r) => setMonthCost(r.total), () => undefined)
    void window.api.invoke('settings:get').then((s) => setBudget(s.monthlyBudgetUsd), () => undefined)
  }, [stories])
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="panel p-4">
          <div className="panel-title">Story</div>
          <div className="mt-1 text-3xl font-semibold text-slate-100">{stories.length}</div>
        </div>
        <div className="panel p-4">
          <div className="panel-title">Bản phát hành</div>
          <div className="mt-1 text-3xl font-semibold text-slate-100">{stories.reduce((n, s) => n + s.releases.length, 0)}</div>
        </div>
        <div className="panel p-4">
          <div className="panel-title">Chi phí tháng này</div>
          <div className="mt-1 text-3xl font-semibold text-slate-100">{formatUsd(monthCost)}</div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Ngân sách tháng {budget > 0 ? formatUsd(budget) : 'không giới hạn'}</span>
            <button className="text-blood-300 hover:underline" onClick={() => setScreen('costs')}>
              Xem sổ chi phí →
            </button>
          </div>
        </div>
      </div>

      <Panel
        title="Danh sách Story"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Tạo Story mới
          </button>
        }
      >
        <div className="space-y-3">
          {stories.map((s) => (
            <div key={s.id} className="rounded-lg border border-ink-600 bg-ink-850 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <button
                    className="text-lg font-semibold text-slate-100 hover:text-blood-300"
                    onClick={() => {
                      void selectStory(s.id).then(() => setScreen('story'))
                    }}
                  >
                    {s.name}
                  </button>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="chip">{STATUS_LABEL[s.status]}</span>
                    <span>Cập nhật {new Date(s.updatedAt).toLocaleString('vi-VN')}</span>
                    <span>
                      · Chi phí {formatUsd(s.costActual)} / ngân sách {formatUsd(s.budgetLimit)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {s.releases.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      void selectStory(s.id).then(() => {
                        selectRelease(r.id)
                        setScreen('autoedit')
                      })
                    }}
                    className="rounded-md border border-ink-600 bg-ink-800 p-3 text-left hover:border-blood-600"
                  >
                    <div className="flex items-center gap-1.5">
                      <LangBadge language={r.language} />
                      <PlatformBadge platform={r.platform} />
                      <span className="chip">{r.aspectRatio}</span>
                      {r.running ? <span className="text-[11px] text-blood-300">● đang chạy</span> : null}
                      {r.waitingApproval ? <span className="text-[11px] text-amber-300">★ chờ duyệt</span> : null}
                    </div>
                    <div className="mt-1.5 truncate text-sm text-slate-200">{r.title}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={r.progress} className="flex-1" />
                      <span className="w-9 text-right text-[11px] text-slate-400">{Math.round(r.progress * 100)}%</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{r.currentStepLabel}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {stories.length === 0 ? <div className="text-sm text-slate-500">Chưa có Story nào.</div> : null}
        </div>
      </Panel>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon name="warn" className="h-4 w-4 text-amber-400" />
        Ảnh vẫn là placeholder (ảnh thật ở GĐ3) – video chỉ để kiểm tra quy trình, chưa dùng để đăng.
      </div>
      {creating ? <NewStoryModal onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
