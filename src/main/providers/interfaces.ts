/**
 * INTERFACE các provider (adapter cắm-rút). GĐ1 chỉ có Mock; adapter thật thêm ở GĐ sau
 * mà KHÔNG sửa pipeline – pipeline chỉ biết các interface này.
 */
import type {
  AspectRatio,
  Delivery,
  ImageAspect,
  Job,
  JobType,
  Language,
  Release,
  Story,
  VoiceProfile
} from '../../shared/types'

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TtsRequest {
  /** Văn bản ĐÃ áp từ điển phát âm */
  text: string
  language: Language
  voice: VoiceProfile
  delivery: Delivery
  outputPath: string
  signal?: AbortSignal
}

export interface TtsResult {
  path: string
  duration: number
  characters: number
  cost: number
  provider: string
  model: string
}

export interface TtsProvider {
  readonly id: string
  readonly displayName: string
  readonly model: string
  readonly languages: Language[]
  /** false ⇒ UI cảnh báo nếu VoiceProfile chưa xác nhận giấy phép thương mại */
  readonly commercialLicenseKnown: boolean
  estimateCost(characters: number): number
  /** Chuyển delivery chung (tags/instructions) sang định dạng riêng của provider */
  toProviderPayload(text: string, delivery: Delivery, voice: VoiceProfile): Record<string, unknown>
  synthesize(req: TtsRequest): Promise<TtsResult>
}

// ---------------------------------------------------------------------------
// Ảnh
// ---------------------------------------------------------------------------

export interface ImageRequest {
  prompt: string
  negativePrompt: string
  aspect: ImageAspect
  outputPath: string
  referenceImagePaths: string[]
  seed?: number
  /** Thông tin hiển thị cho ảnh placeholder (Mock) */
  placeholder?: {
    /** Tiêu đề lớn (mặc định "CẢNH nn") */
    title?: string
    index: number
    shotType: string
    cameraAngle: string
    summary: string
    /** "Út Lan (sợ hãi) · Bà Sáu (lo âu)" – tên nhân vật + biểu cảm trong cảnh */
    castLabel?: string
    focusPoint: { x: number; y: number }
    palette: string[]
  }
  signal?: AbortSignal
}

export interface ImageResult {
  path: string
  width: number
  height: number
  cost: number
  provider: string
  model: string
}

export interface ImageProvider {
  readonly id: string
  readonly displayName: string
  readonly model: string
  estimateCost(count: number): number
  generate(req: ImageRequest): Promise<ImageResult>
}

// ---------------------------------------------------------------------------
// Video AI (image-to-video)
// ---------------------------------------------------------------------------

export interface VideoRequest {
  imagePath: string
  prompt: string
  aspect: AspectRatio
  durationSec: number
  outputPath: string
  signal?: AbortSignal
}

export interface VideoResult {
  path: string
  duration: number
  cost: number
  provider: string
  model: string
}

export interface VideoProvider {
  readonly id: string
  readonly displayName: string
  readonly model: string
  estimateCost(durationSec: number): number
  imageToVideo(req: VideoRequest): Promise<VideoResult>
}

// ---------------------------------------------------------------------------
// LLM (output luôn là JSON, validate bằng zod ở GĐ2)
// ---------------------------------------------------------------------------

export interface LlmJsonRequest<T> {
  /** Tên tác vụ (ghi log, chọn bộ sinh mock) */
  task: string
  system: string
  user: string
  /** Hàm validate (schema zod .parse + kiểm tra id) – ném lỗi nếu sai ⇒ adapter gửi lỗi lại cho LLM và thử lại */
  parse: (raw: unknown) => T
  /** Output giả lập cho MockLlm (vẫn đi qua parse như output thật) */
  mockResponse?: () => unknown
  /** Ảnh gửi kèm (LLM có khả năng nhìn) – base64 */
  images?: { mimeType: string; base64: string; label: string }[]
  temperature?: number
  maxRetries?: number
  signal?: AbortSignal
}

export interface LlmJsonResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
  cost: number
}

export interface LlmProvider {
  readonly id: string
  readonly model: string
  generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>
}

// ---------------------------------------------------------------------------
// Speech-to-text (Whisper)
// ---------------------------------------------------------------------------

export interface TranscriptWord {
  word: string
  start: number
  end: number
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
}

export interface Transcript {
  text: string
  language: string
  words: TranscriptWord[]
  segments: TranscriptSegment[]
  cost: number
}

export interface TranscribeOptions {
  signal?: AbortSignal
  /** Gợi ý chính tả cho Whisper (tên riêng, thuật ngữ) – tối đa ~200 từ */
  prompt?: string
  /** Văn bản kỳ vọng (kịch bản) – chỉ bộ chép lời Mock dùng để giả lập */
  expectedText?: string
  /** Văn bản kỳ vọng theo từng câu – Mock dùng để đặt mỗi câu vào đúng đoạn có tiếng khi số đoạn = số câu */
  expectedLines?: string[]
}

export interface Transcriber {
  readonly id: string
  readonly model: string
  estimateCost(durationSec: number): number
  transcribe(audioPath: string, language: Language, opts?: TranscribeOptions): Promise<Transcript>
}

// ---------------------------------------------------------------------------
// Hàng đợi job dùng chung (TTS / ảnh / video) – cài đặt ở main/queue/jobQueue.ts
// Payload phải tuần tự hoá được (JSON) để lưu xuống đĩa và khôi phục khi mở lại app;
// mỗi loại job có một handler đăng ký trước (register).
// ---------------------------------------------------------------------------

export interface JobContext {
  signal: AbortSignal
  progress: (p: number) => void
  job: Job
}

export type JobHandler<P = unknown, R = unknown> = (payload: P, ctx: JobContext) => Promise<{ result: R; cost: number }>

export interface EnqueueOptions {
  providerId: string
  estimatedCost: number
  /** Khoá cache = hash(input + model + params + reference) */
  cacheKey?: string | null
  storyId?: string | null
  label?: string
}

export interface QueueState {
  concurrency: number
  paused: boolean
  /** Lý do dừng do chạm ngân sách (null nếu không) */
  budgetBlocked: string | null
  counts: Record<Job['status'], number>
}

export interface JobQueue {
  register<P, R>(type: JobType, handler: JobHandler<P, R>): void
  enqueue<P>(type: JobType, payload: P, opts: EnqueueOptions): Job<P>
  /** Chờ job kết thúc (done / failed / cancelled) */
  wait(jobId: string): Promise<Job>
  setConcurrency(n: number): void
  setProviderLimit(providerId: string, n: number): void
  pause(): void
  resume(): void
  cancel(jobId: string): void
  cancelAll(): void
  retry(jobId: string): void
  clearFinished(): void
  list(): Job[]
  state(): QueueState
  onChange(listener: () => void): () => void
  /** Lưu hàng chờ xuống đĩa / khôi phục khi mở lại app */
  persist(): Promise<void>
  restore(): Promise<void>
}

// ---------------------------------------------------------------------------
// Exporter (GĐ6: .srt, FCPXML, CapCut template)
// ---------------------------------------------------------------------------

export type ExportFormat = 'srt' | 'fcpxml' | 'capcut'

export interface ExportResult {
  files: string[]
  warnings: string[]
}

export interface Exporter {
  readonly format: ExportFormat
  readonly displayName: string
  export(story: Story, release: Release, outputDir: string): Promise<ExportResult>
}
