/**
 * IPC CÓ KIỂU giữa renderer ⇄ main.
 * - IpcInvokeMap: các lệnh renderer gọi (ipcRenderer.invoke) và kiểu kết quả.
 * - IpcEventMap: các sự kiện main đẩy về renderer (webContents.send).
 * Thêm lệnh mới: khai báo ở đây → TypeScript buộc main (handler) và preload (api) phải khớp.
 */
import type { CostReport } from './logic/business'
import type {
  PerformanceNote,
  PublishingPackage,
  MotionLevel,
  ReleaseScene,
  SoundAsset,
  SoundCue,
  Approval,
  CastMember,
  Job,
  JobStatus,
  ShotType,
  Beat,
  ChannelPreset,
  Character,
  Easing,
  FolkloreEntry,
  PronunciationEntry,
  SceneBankItem,
  Script,
  VoiceProfile,
  Library,
  Language,
  MotionType,
  PipelineState,
  Platform,
  AspectRatio,
  Release,
  RunMode,
  Story,
  StoryStatus,
  TransitionType
} from './types'

export interface AppInfo {
  version: string
  /** Gốc URL của media server nội bộ */
  mediaBaseUrl: string
  dataRoot: string
  storiesRoot: string
  logFile: string | null
  mockMode: boolean
}

export interface ReleaseSummary {
  id: string
  title: string
  platform: Platform
  language: Language
  aspectRatio: AspectRatio
  progress: number
  running: boolean
  waitingApproval: boolean
  currentStepLabel: string
}

export interface StorySummary {
  id: string
  name: string
  status: StoryStatus
  updatedAt: string
  costActual: number
  budgetLimit: number
  releases: ReleaseSummary[]
}

export interface StoryBundle {
  story: Story
  releases: Release[]
}

export interface ScenePatch {
  motion?: { level?: MotionLevel; type?: MotionType; intensity?: number; easing?: Easing }
  transition?: { type?: TransitionType; durationSec?: number }
  isHero?: boolean
}

export interface ExportFile {
  name: string
  absPath: string
  sizeBytes: number
  modifiedAt: string
}

export interface LogEntry {
  id: number
  time: string
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
}

export interface PublicSettings {
  dataRoot: string
  mockMode: boolean
  monthlyBudgetUsd: number
  renderPresetId: string
  apiKeyStatus: Record<string, boolean>
  encryptionAvailable: boolean
  perfMinViews: number
  perfMinAvgWatch: number
}

export interface NewStoryInput {
  name: string
  channelPresetId: string
  folkloreIds: string[]
  premiseVi: string
  budgetUsd: number
}

export interface StoryPatch {
  name?: string
  premiseVi?: string
  fictionNoteVi?: string
  budgetUsd?: number
  status?: StoryStatus
  beats?: Beat[]
  sceneBank?: SceneBankItem[]
}

export interface NewReleaseInput {
  platform: Platform
  language: Language
  /** Cho bản không chia phần (YouTube) */
  targetDurationSec: number
  /** Cho TikTok/Shorts: số phần dự kiến (LLM viết đủ dài, rồi chia theo thời lượng thực) */
  plannedParts: number
}

export interface LibraryPatch {
  folklore?: FolkloreEntry[]
  pronunciations?: PronunciationEntry[]
  voiceProfiles?: VoiceProfile[]
  characters?: Character[]
  channelPresets?: ChannelPreset[]
  soundAssets?: SoundAsset[]
}

export interface TtsPreviewInput {
  text: string
  voiceProfileId: string
  /** Mặc định true: áp từ điển phát âm trước khi gửi TTS */
  applyDictionary?: boolean
}

export interface TtsPreviewResult {
  dataUrl: string
  sentText: string
  cost: number
  provider: string
}

export interface FilmSettings {
  concurrency: number
  autoRun: boolean
  autoDl: boolean
}

export interface QueueSnapshot {
  state: { concurrency: number; paused: boolean; budgetBlocked: string | null; counts: Record<JobStatus, number> }
  jobs: Job[]
  settings: FilmSettings
}

export interface ScenePatch2 {
  imagePrompt?: string
  description?: string
  focusPoint?: { x: number; y: number }
  cast?: CastMember[]
  approval?: Approval
  shotType?: ShotType
  cameraAngle?: string
  needsVerticalVersion?: boolean
}

export interface PipelineProgressEvent {
  storyId: string
  releaseId: string
  state: PipelineState
}

export interface IpcInvokeMap {
  'app:getInfo': { args: []; result: AppInfo }
  'library:get': { args: []; result: Library }
  'stories:list': { args: []; result: StorySummary[] }
  'story:get': { args: [storyId: string]; result: StoryBundle }
  'story:resetSample': { args: []; result: void }
  'story:create': { args: [input: NewStoryInput]; result: Story }
  'story:update': { args: [storyId: string, patch: StoryPatch]; result: Story }
  'story:generateOutline': { args: [storyId: string]; result: Story }
  'story:approveOutline': { args: [storyId: string]; result: Story }
  'story:proposeCast': { args: [storyId: string]; result: Story }
  'story:proposeSceneBank': { args: [storyId: string]; result: Story }
  'library:update': { args: [patch: LibraryPatch]; result: Library }
  'release:create': { args: [storyId: string, input: NewReleaseInput]; result: Release }
  'release:updateScript': { args: [storyId: string, releaseId: string, script: Script]; result: Release }
  'release:rewriteLine': { args: [storyId: string, releaseId: string, lineId: string, instruction: string]; result: Release }
  'release:clearScript': { args: [storyId: string, releaseId: string]; result: Release }
  'voice:regenerateLine': { args: [storyId: string, releaseId: string, lineId: string]; result: Release }
  'voice:selectTake': { args: [storyId: string, releaseId: string, lineId: string, takeId: string]; result: Release }
  'voice:peaks': { args: [storyId: string, relPath: string, buckets: number]; result: number[] }
  'voice:processPreview': {
    args: [storyId: string, releaseId: string, lineId: string]
    result: { rawPath: string; processedPath: string }
  }
  'tts:preview': { args: [input: TtsPreviewInput]; result: TtsPreviewResult }
  'queue:get': { args: []; result: QueueSnapshot }
  'queue:setOptions': { args: [patch: Partial<FilmSettings>]; result: QueueSnapshot }
  'queue:pause': { args: []; result: QueueSnapshot }
  'queue:resume': { args: []; result: QueueSnapshot }
  'queue:cancel': { args: [jobId: string]; result: QueueSnapshot }
  'queue:cancelAll': { args: []; result: QueueSnapshot }
  'queue:retry': { args: [jobId: string]; result: QueueSnapshot }
  'queue:clearFinished': { args: []; result: QueueSnapshot }
  'images:generateScenes': {
    args: [storyId: string, sceneIds: string[], aspect: AspectRatio, opts: { providerId?: string; regenerate?: boolean }]
    result: number
  }
  'images:generateCharacter': {
    args: [characterId: string, what: 'sheet' | 'expressions' | 'states', opts: { regenerate?: boolean; storyId?: string | null; providerId?: string }]
    result: number
  }
  'images:exportZip': { args: [storyId: string, maxEdge: number | null]; result: { path: string; files: number; bytes: number } | null }
  'scene:update': { args: [storyId: string, sceneId: string, patch: ScenePatch2]; result: Story }
  'scene:applyVariant': { args: [storyId: string, sceneId: string, variantId: string]; result: Story }
  'scene:checkConsistency': { args: [storyId: string, sceneIds: string[]]; result: Story }
  'scene:computeParallax': { args: [storyId: string, sceneId: string, aspect: AspectRatio]; result: Story }
  'scene:generateHeroClip': { args: [storyId: string, sceneId: string, aspect: AspectRatio]; result: { jobs: number; cost: number } }
  'release:update': { args: [storyId: string, releaseId: string, patch: { heroRatio?: number }]; result: Release }
  'release:updateScenes': { args: [storyId: string, releaseId: string, scenes: ReleaseScene[]]; result: Release }
  'release:updateSoundCues': { args: [storyId: string, releaseId: string, cues: SoundCue[]]; result: Release }
  'audio:remix': { args: [storyId: string, releaseId: string]; result: Release }
  'audio:redesign': { args: [storyId: string, releaseId: string]; result: Release }
  'sound:info': { args: []; result: { dir: string; assets: SoundAsset[] } }
  'sound:chooseFolder': { args: []; result: { dir: string; assets: SoundAsset[] } | null }
  'sound:rescan': { args: []; result: { dir: string; assets: SoundAsset[] } }
  'sound:generateStarter': { args: []; result: { dir: string; assets: SoundAsset[] } }
  'sound:preview': { args: [assetId: string]; result: string }
  'models:depthStatus': { args: []; result: { hasModel: boolean; path: string; url: string } }
  'models:downloadDepth': { args: []; result: { hasModel: boolean; path: string; url: string } }
  'publish:generate': { args: [storyId: string, releaseId: string]; result: Release }
  'publish:update': { args: [storyId: string, releaseId: string, pkg: PublishingPackage]; result: Release }
  'publish:refreshChecklist': { args: [storyId: string, releaseId: string]; result: Release }
  'publish:quickThumbnail': { args: [storyId: string, releaseId: string, opts: { sceneBankId?: string; text?: string }]; result: Release }
  'publish:aiThumbnail': { args: [storyId: string, releaseId: string, conceptIndex: number]; result: { cost: number } }
  'publish:cutShorts': { args: [storyId: string, releaseId: string]; result: Release }
  'performance:add': { args: [storyId: string, note: Omit<PerformanceNote, 'id'>]; result: Story }
  'performance:delete': { args: [storyId: string, noteId: string]; result: Story }
  'costs:report': { args: [month: string]; result: CostReport }
  'costs:exportCsv': { args: [month: string]; result: string | null }
  'release:updateScene': {
    args: [storyId: string, releaseId: string, sceneId: string, patch: ScenePatch]
    result: Release
  }
  'pipeline:start': { args: [storyId: string, releaseId: string, mode: RunMode]; result: void }
  'pipeline:continue': { args: [storyId: string, releaseId: string, decision?: 'approved' | 'declined']; result: void }
  'pipeline:cancel': { args: [storyId: string, releaseId: string]; result: void }
  'pipeline:resetFrom': { args: [storyId: string, releaseId: string, stepNo: number]; result: void }
  'exports:list': { args: [storyId: string, releaseId: string]; result: ExportFile[] }
  'exports:openFolder': { args: [storyId: string, releaseId: string]; result: void }
  'exports:openFile': { args: [storyId: string, releaseId: string, fileName: string]; result: void }
  'log:history': { args: []; result: LogEntry[] }
  'settings:get': { args: []; result: PublicSettings }
  'settings:update': {
    args: [patch: { monthlyBudgetUsd?: number; renderPresetId?: string; mockMode?: boolean; perfMinViews?: number; perfMinAvgWatch?: number }]
    result: PublicSettings
  }
  'settings:setApiKey': { args: [providerId: string, apiKey: string]; result: PublicSettings }
}

export type IpcChannel = keyof IpcInvokeMap

/** Danh sách kênh preload cho phép – `satisfies Record` buộc phải liệt kê ĐỦ mọi kênh trong IpcInvokeMap */
const CHANNEL_FLAGS = {
  'app:getInfo': 1,
  'library:get': 1,
  'stories:list': 1,
  'story:get': 1,
  'story:resetSample': 1,
  'story:create': 1,
  'story:update': 1,
  'story:generateOutline': 1,
  'story:approveOutline': 1,
  'story:proposeCast': 1,
  'story:proposeSceneBank': 1,
  'library:update': 1,
  'release:create': 1,
  'release:updateScene': 1,
  'release:updateScript': 1,
  'release:rewriteLine': 1,
  'release:clearScript': 1,
  'voice:regenerateLine': 1,
  'voice:selectTake': 1,
  'voice:peaks': 1,
  'voice:processPreview': 1,
  'tts:preview': 1,
  'queue:get': 1,
  'queue:setOptions': 1,
  'queue:pause': 1,
  'queue:resume': 1,
  'queue:cancel': 1,
  'queue:cancelAll': 1,
  'queue:retry': 1,
  'queue:clearFinished': 1,
  'images:generateScenes': 1,
  'images:generateCharacter': 1,
  'images:exportZip': 1,
  'scene:update': 1,
  'scene:applyVariant': 1,
  'scene:checkConsistency': 1,
  'scene:computeParallax': 1,
  'scene:generateHeroClip': 1,
  'release:update': 1,
  'release:updateScenes': 1,
  'release:updateSoundCues': 1,
  'audio:remix': 1,
  'audio:redesign': 1,
  'sound:info': 1,
  'sound:chooseFolder': 1,
  'sound:rescan': 1,
  'sound:generateStarter': 1,
  'sound:preview': 1,
  'models:depthStatus': 1,
  'models:downloadDepth': 1,
  'publish:generate': 1,
  'publish:update': 1,
  'publish:refreshChecklist': 1,
  'publish:quickThumbnail': 1,
  'publish:aiThumbnail': 1,
  'publish:cutShorts': 1,
  'performance:add': 1,
  'performance:delete': 1,
  'costs:report': 1,
  'costs:exportCsv': 1,
  'pipeline:start': 1,
  'pipeline:continue': 1,
  'pipeline:cancel': 1,
  'pipeline:resetFrom': 1,
  'exports:list': 1,
  'exports:openFolder': 1,
  'exports:openFile': 1,
  'log:history': 1,
  'settings:get': 1,
  'settings:update': 1,
  'settings:setApiKey': 1
} satisfies Record<IpcChannel, 1>

export const INVOKE_CHANNELS = Object.keys(CHANNEL_FLAGS) as IpcChannel[]
export type IpcArgs<C extends IpcChannel> = IpcInvokeMap[C]['args']
export type IpcResult<C extends IpcChannel> = IpcInvokeMap[C]['result']

export interface IpcEventMap {
  'pipeline:progress': PipelineProgressEvent
  'data:changed': { storyId: string }
  'log:entry': LogEntry
  'queue:changed': QueueSnapshot
}

export type IpcEventChannel = keyof IpcEventMap

/** API mà preload phơi ra cho renderer qua window.api */
export interface FhsApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>
  on<E extends IpcEventChannel>(channel: E, listener: (payload: IpcEventMap[E]) => void): () => void
}
