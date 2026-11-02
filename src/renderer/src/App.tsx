import { useEffect } from 'react'
import { Icon } from './components/Icon'
import { LogPanel } from './components/LogPanel'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { AutoEditScreen } from './screens/AutoEditScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ChannelScreen, FolkloreScreen } from './screens/LibraryScreens'
import { FilmStudioScreen } from './screens/FilmStudioScreen'
import { StoryboardScreen } from './screens/StoryboardScreen'
import { VoiceStudioScreen } from './screens/VoiceStudioScreen'
import { PublishScreen } from './screens/PublishScreen'
import { CostsScreen } from './screens/CostsScreen'
import { ScriptEditorScreen } from './screens/ScriptEditorScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StoryScreen } from './screens/StoryScreen'
import { useApp, type ScreenId } from './store/appStore'

const SCREENS: Record<ScreenId, () => JSX.Element> = {
  home: HomeScreen,
  story: StoryScreen,
  folklore: FolkloreScreen,
  channel: ChannelScreen,
  script: ScriptEditorScreen,
  voice: VoiceStudioScreen,
  film: FilmStudioScreen,
  storyboard: StoryboardScreen,
  autoedit: AutoEditScreen,
  publish: PublishScreen,
  costs: CostsScreen,
  settings: SettingsScreen
}

export function App(): JSX.Element {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const fatalError = useApp((s) => s.fatalError)
  const screen = useApp((s) => s.screen)
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  useEffect(() => {
    void init()
  }, [init])

  const Screen = SCREENS[screen]

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="min-h-0 flex-1 overflow-auto">
            {!ready ? (
              <div className="flex h-full items-center justify-center text-slate-500">Đang tải…</div>
            ) : fatalError ? (
              <div className="p-8 text-red-400">Không tải được dữ liệu: {fatalError}</div>
            ) : (
              <Screen />
            )}
          </div>
          <LogPanel />
        </div>
      </div>
      <StatusBar />

      <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex gap-2 rounded-lg border p-3 text-sm shadow-xl ${
              t.kind === 'error' ? 'border-red-800 bg-red-950/95 text-red-100' : 'border-ink-500 bg-ink-800/95 text-slate-100'
            }`}
          >
            <Icon name={t.kind === 'error' ? 'warn' : 'check'} className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-white">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
