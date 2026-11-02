/**
 * Phụ thuộc và ngữ cảnh của pipeline. Pipeline KHÔNG import Electron ⇒ chạy được trong smoke test.
 */
import type { Library, PipelineState, Release, Story } from '../../shared/types'
import type { ProviderRegistry } from '../providers/registry'
import type { ImageService } from '../services/imageService'
import type { MotionService } from '../services/motionService'
import type { SoundService } from '../services/soundService'
import type { PublishService } from '../services/publishService'
import type { RecordingService } from '../services/recordingService'
import type { PuppetService } from '../services/puppetService'
import type { RunMode } from '../../shared/types'
import type { VideoRenderer } from '../render/protocol'
import type { StoryRepository } from '../storage/storyRepo'

export interface PipelineDeps {
  repo: StoryRepository
  /** LLM / TTS / ảnh – chọn theo chế độ Mock và VoiceProfile */
  providers: ProviderRegistry
  /** Tạo ảnh qua hàng đợi job */
  images: ImageService
  /** Parallax 2.5D + video AI cảnh hero */
  motion: MotionService
  /** Sound design + mix */
  sound: SoundService
  /** Gói xuất bản, thumbnail, Shorts teaser */
  publish: PublishService
  /** Giọng tự thu + chép lời / căn mốc */
  recording: RecordingService
  /** GĐ7: rối 2D – hình miệng, rối Mock */
  puppet: PuppetService
  renderer: VideoRenderer
  /** Đường dẫn tuyệt đối tới src/remotion/index.ts */
  remotionEntry: string
  /** Gốc URL media server */
  mediaBaseUrl: string
  /** Hệ số render (0.5 = nháp, 1 = 1080p, 2 = 4K) */
  getRenderScale: () => number
  emitProgress: (storyId: string, releaseId: string, state: PipelineState, force?: boolean) => void
  emitDataChanged: (storyId: string) => void
}

export interface StepContext {
  deps: PipelineDeps
  story: Story
  release: Release
  library: Library
  signal: AbortSignal
  storyDir: string
  releaseDir: string
  /** p: 0..1 */
  progress: (p: number, message?: string) => void
  log: (message: string, level?: 'info' | 'warn' | 'error') => void
  saveStory: () => Promise<void>
  mode: RunMode
  /** Quyết định của người dùng cho bước duyệt có điều kiện (vd báo giá video AI) */
  approval?: 'approved' | 'declined'
}

export interface StepResult {
  /** 'waitingApproval' = dừng chờ người dùng quyết định (Đồng ý / Bỏ qua) rồi chạy lại bước này */
  status: 'done' | 'skipped' | 'waitingApproval'
  message?: string
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
}
