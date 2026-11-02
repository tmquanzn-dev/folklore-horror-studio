/**
 * Store Zustand của renderer. Dữ liệu gốc luôn ở main (đĩa); renderer chỉ giữ bản sao để hiển thị
 * và tải lại khi main báo 'data:changed'. Tiến độ pipeline cập nhật trực tiếp qua 'pipeline:progress'.
 */
import { create } from 'zustand'
import type { AppInfo, LogEntry, PipelineProgressEvent, QueueSnapshot, StoryBundle, StorySummary } from '../../../shared/ipc'
import type { Library, Release, RunMode, Story } from '../../../shared/types'
import { errorMessage } from '../lib/format'

export type ScreenId =
  | 'home'
  | 'story'
  | 'folklore'
  | 'channel'
  | 'script'
  | 'voice'
  | 'film'
  | 'storyboard'
  | 'autoedit'
  | 'publish'
  | 'costs'
  | 'settings'

interface Toast {
  id: number
  kind: 'error' | 'info'
  message: string
}

interface AppState {
  ready: boolean
  fatalError: string | null
  appInfo: AppInfo | null
  library: Library | null
  stories: StorySummary[]
  screen: ScreenId
  currentStoryId: string | null
  currentReleaseId: string | null
  bundle: StoryBundle | null
  logs: LogEntry[]
  logOpen: boolean
  selectedSceneId: string | null
  /** Sound cue đang chọn trên timeline (bảng phải hiện thuộc tính cue thay vì cảnh) */
  selectedCueId: string | null
  toasts: Toast[]
  /** Trạng thái hàng đợi job (Film Studio) – cập nhật qua sự kiện queue:changed */
  queue: QueueSnapshot | null

  init: () => Promise<void>
  setScreen: (s: ScreenId) => void
  selectStory: (id: string | null) => Promise<void>
  selectRelease: (id: string | null) => void
  refresh: () => Promise<void>
  /** Tải lại AppInfo + thư viện + danh sách Story (sau khi đổi cài đặt / tạo Story) */
  reloadAll: () => Promise<void>
  selectScene: (id: string | null) => void
  selectCue: (id: string | null) => void
  toggleLog: (open?: boolean) => void
  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  runAction: (fn: () => Promise<unknown>) => Promise<void>
  startPipeline: (mode: RunMode) => Promise<void>
  continuePipeline: () => Promise<void>
  cancelPipeline: () => Promise<void>
  resetPipelineFrom: (stepNo: number) => Promise<void>
}

let initialized = false
let toastId = 1

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  fatalError: null,
  appInfo: null,
  library: null,
  stories: [],
  screen: 'home',
  currentStoryId: null,
  currentReleaseId: null,
  bundle: null,
  logs: [],
  logOpen: false,
  selectedSceneId: null,
  selectedCueId: null,
  toasts: [],
  queue: null,

  init: async () => {
    if (initialized) return
    initialized = true
    try {
      const api = window.api
      api.on('log:entry', (e) => set((s) => ({ logs: [...s.logs.slice(-499), e] })))
      api.on('pipeline:progress', (e: PipelineProgressEvent) => {
        const b = get().bundle
        if (!b || b.story.id !== e.storyId) return
        set({
          bundle: {
            ...b,
            releases: b.releases.map((r) => (r.id === e.releaseId ? { ...r, pipelineState: e.state } : r))
          }
        })
      })
      api.on('queue:changed', (queue) => set({ queue }))
      void api.invoke('queue:get').then((queue) => set({ queue }))
      api.on('data:changed', (e) => {
        void api.invoke('stories:list').then((stories) => set({ stories }))
        if (e.storyId === get().currentStoryId) void get().refresh()
      })

      const [appInfo, library, stories, logs] = await Promise.all([
        api.invoke('app:getInfo'),
        api.invoke('library:get'),
        api.invoke('stories:list'),
        api.invoke('log:history')
      ])
      set({ appInfo, library, stories, logs, ready: true })
      // Tự chọn Story đầu tiên + Release đầu tiên để vào việc ngay
      if (stories.length > 0) await get().selectStory(stories[0].id)
    } catch (err) {
      set({ fatalError: errorMessage(err), ready: true })
    }
  },

  setScreen: (screen) => set({ screen }),

  selectStory: async (id) => {
    if (!id) {
      set({ currentStoryId: null, currentReleaseId: null, bundle: null })
      return
    }
    const bundle = await window.api.invoke('story:get', id)
    const keep = bundle.releases.some((r) => r.id === get().currentReleaseId)
    set({
      currentStoryId: id,
      bundle,
      currentReleaseId: keep ? get().currentReleaseId : (bundle.releases[0]?.id ?? null),
      selectedSceneId: null
    })
  },

  selectRelease: (id) => set({ currentReleaseId: id, selectedSceneId: null }),

  refresh: async () => {
    const id = get().currentStoryId
    if (!id) return
    try {
      const [bundle, library] = await Promise.all([window.api.invoke('story:get', id), window.api.invoke('library:get')])
      set({ bundle, library })
    } catch (err) {
      get().toast(errorMessage(err))
    }
  },

  reloadAll: async () => {
    const [appInfo, library, stories] = await Promise.all([
      window.api.invoke('app:getInfo'),
      window.api.invoke('library:get'),
      window.api.invoke('stories:list')
    ])
    set({ appInfo, library, stories })
    await get().refresh()
  },

  selectScene: (id) => set({ selectedSceneId: id, selectedCueId: null }),
  selectCue: (id) => set({ selectedCueId: id, selectedSceneId: null }),
  toggleLog: (open) => set((s) => ({ logOpen: open ?? !s.logOpen })),

  toast: (message, kind = 'error') => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), 8000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  runAction: async (fn) => {
    try {
      await fn()
    } catch (err) {
      get().toast(errorMessage(err))
    }
  },

  startPipeline: async (mode) => {
    const { currentStoryId: s, currentReleaseId: r, runAction } = get()
    if (s && r) await runAction(() => window.api.invoke('pipeline:start', s, r, mode))
  },
  continuePipeline: async () => {
    const { currentStoryId: s, currentReleaseId: r, runAction } = get()
    if (s && r) await runAction(() => window.api.invoke('pipeline:continue', s, r))
  },
  cancelPipeline: async () => {
    const { currentStoryId: s, currentReleaseId: r, runAction } = get()
    if (s && r) await runAction(() => window.api.invoke('pipeline:cancel', s, r))
  },
  resetPipelineFrom: async (stepNo) => {
    const { currentStoryId: s, currentReleaseId: r, runAction } = get()
    if (s && r) await runAction(() => window.api.invoke('pipeline:resetFrom', s, r, stepNo))
  }
}))

// Cho kiểm thử UI tự động (main gọi qua executeJavaScript); store không chứa bí mật nào
;(window as unknown as { __fhsStore: typeof useApp }).__fhsStore = useApp

// Zustand v5: selector phải trả về giá trị ổn định – KHÔNG trả về `[]` mới mỗi lần (gây vòng lặp render vô hạn)
const NO_RELEASES: Release[] = []

export function useReleases(): Release[] {
  return useApp((s) => s.bundle?.releases ?? NO_RELEASES)
}

export function useMockMode(): boolean {
  return useApp((s) => s.appInfo?.mockMode ?? true)
}

export function useCurrentStory(): Story | null {
  return useApp((s) => s.bundle?.story ?? null)
}

export function useCurrentRelease(): Release | null {
  return useApp((s) => s.bundle?.releases.find((r) => r.id === s.currentReleaseId) ?? null)
}
