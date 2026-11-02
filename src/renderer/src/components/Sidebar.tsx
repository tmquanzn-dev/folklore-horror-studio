import { useApp, type ScreenId } from '../store/appStore'
import { Icon } from './Icon'

const ITEMS: { id: ScreenId; label: string; icon: string }[] = [
  { id: 'home', label: 'Trang chủ', icon: 'home' },
  { id: 'story', label: 'Story', icon: 'story' },
  { id: 'folklore', label: 'Thư viện dân gian', icon: 'folklore' },
  { id: 'channel', label: 'Nhân vật & Giọng', icon: 'channel' },
  { id: 'script', label: 'Script Editor', icon: 'script' },
  { id: 'voice', label: 'Voice Studio', icon: 'voice' },
  { id: 'film', label: 'Film Studio', icon: 'film' },
  { id: 'storyboard', label: 'Storyboard', icon: 'storyboard' },
  { id: 'autoedit', label: 'AutoEdit', icon: 'autoedit' },
  { id: 'publish', label: 'Xuất bản', icon: 'publish' },
  { id: 'costs', label: 'Sổ chi phí', icon: 'clock' }
]

export function Sidebar(): JSX.Element {
  const screen = useApp((s) => s.screen)
  const setScreen = useApp((s) => s.setScreen)

  const btn = (id: ScreenId, label: string, icon: string): JSX.Element => (
    <button
      key={id}
      title={label}
      onClick={() => setScreen(id)}
      className={`group relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
        screen === id ? 'bg-blood-600/30 text-blood-300' : 'text-slate-400 hover:bg-ink-700 hover:text-slate-200'
      }`}
    >
      {screen === id ? <span className="absolute left-[-10px] h-6 w-1 rounded-r bg-blood-500" /> : null}
      <Icon name={icon} />
      <span className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded bg-ink-950 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg group-hover:opacity-100">
        {label}
      </span>
    </button>
  )

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-ink-700 bg-ink-950 py-3">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blood-600 to-night-600 text-lg font-black text-white">
        ma
      </div>
      {ITEMS.map((i) => btn(i.id, i.label, i.icon))}
      <div className="flex-1" />
      {btn('settings', 'Cài đặt', 'settings')}
    </nav>
  )
}
