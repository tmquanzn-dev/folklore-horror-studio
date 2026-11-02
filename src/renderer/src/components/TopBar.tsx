import { useApp, useReleases } from '../store/appStore'
import { PLATFORM_LABEL } from '../lib/format'
import { LangBadge, PlatformBadge } from './ui'

const TITLES: Record<string, string> = {
  home: 'Trang chủ',
  story: 'Story',
  folklore: 'Thư viện dân gian',
  channel: 'Nhân vật & Giọng',
  script: 'Script Editor',
  voice: 'Voice Studio',
  film: 'Film Studio',
  storyboard: 'Storyboard',
  autoedit: 'AutoEdit',
  publish: 'Xuất bản',
  costs: 'Sổ chi phí',
  settings: 'Cài đặt'
}

/** Thanh trên: bộ chọn Story + Release đang làm việc (Script/Voice/AutoEdit/Xuất bản dùng Release này) */
export function TopBar(): JSX.Element {
  const screen = useApp((s) => s.screen)
  const stories = useApp((s) => s.stories)
  const currentStoryId = useApp((s) => s.currentStoryId)
  const currentReleaseId = useApp((s) => s.currentReleaseId)
  const releases = useReleases()
  const selectStory = useApp((s) => s.selectStory)
  const selectRelease = useApp((s) => s.selectRelease)
  const current = releases.find((r) => r.id === currentReleaseId)

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-850 px-5">
      <h1 className="min-w-[150px] text-base font-semibold text-slate-100">{TITLES[screen]}</h1>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Story</span>
        <select
          className="input min-w-[220px]"
          value={currentStoryId ?? ''}
          onChange={(e) => void selectStory(e.target.value || null)}
        >
          {stories.length === 0 ? <option value="">(chưa có Story)</option> : null}
          {stories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Bản phát hành</span>
        <select
          className="input min-w-[300px]"
          value={currentReleaseId ?? ''}
          onChange={(e) => selectRelease(e.target.value || null)}
        >
          {releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.language.toUpperCase()} · {PLATFORM_LABEL[r.platform]} · {r.aspectRatio} — {r.title}
            </option>
          ))}
        </select>
        {current ? (
          <div className="flex items-center gap-1">
            <LangBadge language={current.language} />
            <PlatformBadge platform={current.platform} />
            <span className="chip">{current.aspectRatio}</span>
          </div>
        ) : null}
      </div>
    </header>
  )
}
