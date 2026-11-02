/**
 * DATA MODEL – NGUỒN SỰ THẬT DUY NHẤT của Folklore Horror Studio.
 * - Thời gian luôn lưu bằng GIÂY (number).
 * - Đường dẫn media lưu TƯƠNG ĐỐI so với thư mục Story, dùng dấu "/" (vd: "bank/scene-01_16x9.png").
 * - File này chỉ chứa type, dùng chung cho main, preload, renderer và Remotion.
 */

// ============================================================================
// Kiểu cơ bản
// ============================================================================

export type Language = 'en' | 'vi'
export type Platform = 'youtube' | 'tiktok' | 'youtubeShorts'
export type AspectRatio = '16:9' | '9:16'
export type ImageAspect = AspectRatio | '1:1'
export type ShotType = 'wide' | 'medium' | 'closeUp' | 'overShoulder' | 'topDown' | 'insert'
export type MotionLevel = 'kenBurns' | 'parallax' | 'aiVideo'
export type KenBurnsType = 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'panUp' | 'panDown'
export type ParallaxType = 'dollyIn' | 'dollyOut' | 'truckLeft' | 'truckRight'
export type MotionType = KenBurnsType | ParallaxType | 'aiClip'
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
export type TransitionType = 'cut' | 'fade' | 'dipToBlack' | 'flash'
export type SubtitleStyleId = 'youtube' | 'tiktok'
export type ScriptSectionKind =
  | 'hook'
  | 'coldOpen'
  | 'context'
  | 'story'
  | 'folkloreExplainer'
  | 'cliffhanger'
  | 'outro'

/** Điểm quan trọng trong ảnh, toạ độ chuẩn hoá 0..1 (0,0 = góc trên trái). */
export interface FocusPoint {
  x: number
  y: number
}

export interface Approval {
  status: 'pending' | 'approved' | 'rejected'
  at?: string
  note?: string
}

// ============================================================================
// KÊNH & TRI THỨC (dùng xuyên các Story)
// ============================================================================

export interface MotionProfile {
  defaultLevel: MotionLevel
  /** Cường độ nền 0..1 */
  baseIntensity: number
  /** Cường độ cộng thêm theo cảm xúc của beat */
  intensityGain: number
  /** Ngưỡng beat "căng thẳng": zoom vào chậm, áp sát */
  tenseThreshold: number
  /** Ngưỡng cao trào: được dùng chuyển cảnh flash */
  climaxThreshold: number
  transitionWithinBeat: TransitionType
  transitionBetweenBeats: TransitionType
  transitionDurationSec: number
  flashAtClimax: boolean
  /** Tỷ lệ cảnh dùng parallax 2.5D (Mức 2), 0..1 */
  parallaxRatio: number
}

export interface SoundPalette {
  ambienceTags: string[]
  sfxTags: string[]
  stingerTags: string[]
  musicTags: string[]
  targetLufs: number
}

export interface SubtitleStyle {
  id: SubtitleStyleId
  fontFamily: string
  /** Cỡ chữ theo tỷ lệ chiều rộng khung hình */
  fontSizeRatio: number
  fontWeight: number
  color: string
  /** Màu từ đang được đọc (karaoke) */
  highlightColor: string
  /** Màu thuật ngữ tiếng Việt trong bản tiếng Anh */
  emphasisColor: string
  strokeColor: string
  strokeWidthRatio: number
  backgroundColor: string | null
  /** Vị trí tâm phụ đề theo chiều cao (0..1) */
  verticalPosition: number
  /** Vị trí tâm theo chiều ngang (0..1) – TikTok lệch trái để tránh cột nút bên phải */
  horizontalCenter: number
  maxWidthRatio: number
  maxCharsPerCue: number
  maxWordsPerCue: number
  italicGlossary: boolean
  wordHighlight: boolean
  uppercase: boolean
}

export interface PlatformDefaults {
  label: string
  aspectRatio: AspectRatio
  targetDurationSec: { min: number; max: number }
  heroRatio: number
  structure: ScriptSectionKind[]
  chapters: boolean
  partDurationSec: number | null
  /** Các section có nhân vật kênh (người kể) xuất hiện trên hình */
  narratorSections: ScriptSectionKind[]
}

export interface ChannelPreset {
  id: string
  name: string
  artStyle: string
  /** Không chữ trong ảnh, không torii, không kimono, không kiến trúc Nhật/Trung, không máu me… */
  negativePrompt: string
  palette: string[]
  /** Từ điển hình ảnh văn hoá: làng quê đồng bằng, sông nước, nhà sàn, bàn thờ, nhang khói… */
  culturalVisualBible: string[]
  motionProfile: MotionProfile
  soundPalette: SoundPalette
  defaultVoiceByLanguage: Record<Language, string>
  subtitleStyleByPlatform: Record<Platform, SubtitleStyle>
  platformDefaults: Record<Platform, PlatformDefaults>
}

export interface FolkloreEntry {
  id: string
  nameVi: string
  nameEn: string
  region: string
  summaryVi: string
  summaryEn: string
  /** Ngoại hình cố định của thực thể – giữ nhất quán qua mọi ảnh */
  visualDesign: string
  referenceImages: string[]
  /** Nguồn do người dùng nhập */
  sources: string[]
  /** true = truyền thuyết dân gian có ghi nhận; false = phần hư cấu của kênh */
  isDocumentedFolklore: boolean
}

export interface PronunciationEntry {
  id: string
  language: Language
  /** Dạng hiển thị trong kịch bản/phụ đề */
  term: string
  /** Chỉ dùng cho văn bản gửi TTS */
  ttsRespelling: string
  notes: string
  /** Nếu có: là thuật ngữ cần chú thích (thẻ chú thích lần đầu xuất hiện trong bản tiếng Anh) */
  glossEn?: string
}

/** Bảng biểu cảm: biểu cảm → ảnh tham chiếu (ảnh tạo ở GĐ3) */
export interface ExpressionSheetItem {
  expression: string
  prompt: string
  imagePath: string | null
}

/** 'channel' = nhân vật kênh (xuyên mọi Story, nhận diện thương hiệu); 'story' = nhân vật của một truyện */
export type CharacterScope = 'channel' | 'story'
export type CharacterRole = 'narrator' | 'character' | 'entity'
export type Gender = 'female' | 'male' | 'other' | 'unknown'

/**
 * Ảnh tham chiếu nhân vật (tạo bằng ImageProvider, dùng chung artStyle của kênh).
 * Đường dẫn tương đối trong thư mục nhân vật dùng chung: "<storiesRoot>/_characters/" (vd "char-lan/front_ab12.png").
 */
export interface CharacterSheet {
  front: string | null
  threeQuarter: string | null
  profile: string | null
  fullBody: string | null
}

/** Biến thể ngoại hình theo diễn biến: "ướt sũng", "bị thương nhẹ", "bị nhập"… */
export interface CharacterState {
  id: string
  name: string
  description: string
  referenceImage: string | null
}

export interface Character {
  id: string
  name: string
  role: CharacterRole
  scope: CharacterScope
  /** Bắt buộc khi scope = 'story' */
  storyId: string | null
  age: number | null
  gender: Gender
  /** Khuôn mặt, dáng người, kiểu tóc */
  appearance: string
  defaultOutfit: string
  /** Tính cách / vai trò trong truyện */
  description: string
  referenceImages: string[]
  characterSheet: CharacterSheet
  expressionSheet: ExpressionSheetItem[]
  states: CharacterState[]
  voiceProfileIdByLanguage: Partial<Record<Language, string>>
  /** Đã khoá ⇒ mọi ảnh sau dùng ảnh tham chiếu của nhân vật này (GĐ3) */
  locked: boolean
  approval: Approval
}

/** Chuỗi xử lý giọng: lọc tần thấp → nén → EQ ấm → reverb nhẹ */
export interface VoiceProcessChain {
  highpassHz: number
  compressor: { thresholdDb: number; ratio: number }
  warmthDb: number
  reverbAmount: number
}

export interface VoiceProfile {
  id: string
  name: string
  language: Language
  providerId: string
  providerVoiceId: string
  baseInstructions: string
  defaultTags: string[]
  speed: number
  providerSettings: Record<string, unknown>
  postProcessChain: VoiceProcessChain
  commercialLicenseConfirmed: boolean
}

export type SoundKind = 'ambience' | 'sfx' | 'stinger' | 'music'

export interface SoundAsset {
  id: string
  /** Đường dẫn tuyệt đối trong thư mục thư viện âm thanh của người dùng */
  path: string
  name: string
  kind: SoundKind
  tags: string[]
  durationSec: number
  /** Nội dung/tên giấy phép (vd "CC0", "Epidemic Sound – gói cá nhân", "Tự tạo") */
  license: string
  /** Người dùng đã xác nhận được phép dùng thương mại ⇒ mới được tự động đưa vào video */
  licenseConfirmed: boolean
  source: string
}

/** Kho tri thức dùng chung mọi Story (lưu ở library.json) */
export interface Library {
  channelPresets: ChannelPreset[]
  folklore: FolkloreEntry[]
  pronunciations: PronunciationEntry[]
  characters: Character[]
  voiceProfiles: VoiceProfile[]
  soundAssets: SoundAsset[]
}

// ============================================================================
// STORY (dùng chung cho mọi Release)
// ============================================================================

export interface Beat {
  id: string
  order: number
  summaryVi: string
  summaryEn: string
  /** 0..1 – điều khiển nhịp dựng, chuyển động, cảnh hero */
  emotionalIntensity: number
  mustShow: string[]
}

export interface Outline {
  beats: Beat[]
  approval: Approval
}

export interface MediaRef {
  /** Tương đối so với thư mục Story */
  path: string
  mediaType: 'image' | 'video'
  source: 'ai' | 'stock' | 'own'
  provider: string
  model: string
  cost: number
  createdAt: string
  width?: number
  height?: number
  /** Với video: thời lượng clip (giây) */
  durationSec?: number
}

export interface SceneVariant {
  id: string
  aspect: ImageAspect
  media: MediaRef
  note: string
}

/** Một nhân vật xuất hiện trong cảnh. Tối đa 2–3 nhân vật rõ mặt / cảnh để giữ đồng nhất. */
export interface CastMember {
  characterId: string
  stateId: string | null
  expression: string
  position: 'left' | 'center' | 'right' | 'background'
  action: string
}

export interface SceneBankItem {
  id: string
  beatId: string
  /** Mô tả tiếng Việt cho người duyệt */
  description: string
  shotType: ShotType
  cameraAngle: string
  cast: CastMember[]
  folkloreIds: string[]
  expression: string
  /** Phần prompt riêng của cảnh (tiếng Anh) – ghép với artStyle + culturalVisualBible lúc tạo ảnh */
  imagePrompt: string
  /** true = cần bản 9:16 vẽ riêng (không chỉ cắt dọc) */
  needsVerticalVersion: boolean
  media: Record<AspectRatio, MediaRef | null>
  focusPoint: FocusPoint
  depthMapPath: string | null
  heroClip: Record<AspectRatio, MediaRef | null>
  variants: SceneVariant[]
  approval: Approval
  /** GĐ3: kiểm tra đồng nhất nhân vật (tuỳ chọn) */
  consistency?: ConsistencyCheck | null
  /** GĐ4: lớp parallax 2.5D theo khung (tách từ depth map) */
  parallax?: Partial<Record<AspectRatio, ParallaxLayers>>
}

/** Ảnh tách 3 lớp theo độ sâu: [hậu cảnh, chủ thể, tiền cảnh] (PNG có alpha, tương đối thư mục Story) */
export interface ParallaxLayers {
  /** Ảnh gốc dùng để tách (để biết khi nào phải tách lại) */
  sourcePath: string
  depthPath: string
  layers: [string, string, string]
  /** 'model' = depth từ model ONNX; 'heuristic' = ước lượng (chưa có model) */
  depthSource: 'model' | 'heuristic'
  createdAt: string
}

export interface StoryBudget {
  limitUsd: number
}

export type StoryStatus = 'draft' | 'testing' | 'adapted' | 'archived'

export interface Story {
  id: string
  name: string
  channelPresetId: string
  folkloreIds: string[]
  /** Ý tưởng gốc (tiếng Việt) */
  premiseVi: string
  /** Ghi chú phân biệt truyền thuyết thật / phần hư cấu */
  fictionNoteVi: string
  outline: Outline
  characterIds: string[]
  sceneBank: SceneBankItem[]
  releaseIds: string[]
  status: StoryStatus
  budget: StoryBudget
  /** Sổ hiệu quả – người dùng nhập sau khi đăng (GĐ5) */
  performanceNotes: PerformanceNote[]
  /** Chi phí cấp Story (LLM dàn ý, nhân vật, ngân hàng cảnh, ảnh dùng chung) */
  costs: CostLedger
  createdAt: string
  updatedAt: string
}

// ============================================================================
// RELEASE (riêng từng bản phát hành)
// ============================================================================

export interface ScriptSection {
  id: string
  kind: ScriptSectionKind
  title: string
  titleVi?: string
}

export interface Delivery {
  /** Audio tag chung, vd: whispers, sighs, nervous – adapter tự chuyển sang định dạng provider */
  tags: string[]
  /** Chỉ dẫn diễn xuất tự do (OpenAI dùng trường instructions) */
  instructions: string
  /** Hệ số tốc độ: 1 = bình thường, 0.85 = chậm */
  pace: number
  pauseBeforeMs: number
  pauseAfterMs: number
}

export interface Take {
  id: string
  path: string
  provider: string
  model: string
  /** hash(input + model + params) – dùng làm cache */
  hash: string
  duration: number
  createdAt: string
}

export interface ScriptLine {
  id: string
  sectionId: string
  beatId: string
  /** Id nhân vật: người kể (nhân vật kênh) hoặc nhân vật truyện – câu thoại dùng giọng của nhân vật đó */
  speakerId: string
  text: string
  /** Chỉ có khi language khác 'vi' */
  translationVi?: string
  delivery: Delivery
  takes: Take[]
  selectedTakeId: string | null
  start: number | null
  end: number | null
  glossaryTermIds: string[]
  approval: Approval
  /** Mốc từng từ thật (giọng tự thu căn bằng Whisper) – phụ đề dùng thay cho mốc ước lượng */
  wordTimings?: { word: string; start: number; end: number }[] | null
  /** Độ khớp câu với bản chép lời (0..1) – thấp ⇒ cần nghe lại */
  alignConfidence?: number | null
}

export interface Script {
  sections: ScriptSection[]
  lines: ScriptLine[]
}

export interface VoiceTrack {
  mode: 'tts' | 'recorded'
  /** Bản mix cuối (giọng + ambience + SFX + nhạc, ducking, chuẩn loudness) – dùng để render */
  mixedPath: string | null
  processedPath: string | null
  duration: number
  /** Loudness đo được của bản mix (LUFS tích hợp) */
  mixLufs?: number | null
  /** Sound cue đã đổi sau lần mix cuối ⇒ cần "Mix lại" */
  mixStale?: boolean
  mixedAt?: string
}

export interface Motion {
  level: MotionLevel
  type: MotionType
  intensity: number
  easing: Easing
  focusPoint: FocusPoint
}

export interface Transition {
  type: TransitionType
  durationSec: number
}

export interface ReleaseScene {
  id: string
  sceneBankId: string
  start: number
  end: number
  lineIds: string[]
  mediaOverride: MediaRef | null
  motion: Motion
  transition: Transition
  isHero: boolean
}

export interface Chapter {
  id: string
  title: string
  titleVi?: string
  start: number
}

export interface SubtitleWord {
  text: string
  start: number
  end: number
  /** Thuật ngữ trong từ điển → in nghiêng/đổi màu */
  emphasis: boolean
}

export interface SubtitleCue {
  id: string
  start: number
  end: number
  text: string
  words: SubtitleWord[]
  glossaryTermIds: string[]
  styleId: SubtitleStyleId
}

export interface SoundCue {
  id: string
  /** 'silence' = khoảng lặng có chủ đích: tắt mọi âm nền trong đoạn này */
  kind: 'ambience' | 'sfx' | 'stinger' | 'music' | 'silence'
  assetId: string | null
  start: number
  end: number
  /** 0..1 (nhân với mức mặc định theo loại) */
  volume: number
  fadeIn: number
  fadeOut: number
  /** Lý do LLM/luật đặt cue này (hiển thị cho người duyệt) */
  reason?: string
}

export interface ChecklistItem {
  id: string
  labelVi: string
  done: boolean
  /** true = app tự kiểm tra (không tick tay được) */
  auto?: boolean
  /** Giải thích / việc cần làm */
  detail?: string
}

/** Ý tưởng thumbnail / ảnh bìa: chữ to trên ảnh + mô tả hình */
export interface ThumbnailConcept {
  text: string
  /** Dịch tiếng Việt của chữ (bản tiếng Anh) */
  textVi?: string
  visual: string
}

export interface YoutubePublishing {
  titleOptions: string[]
  titleOptionsVi: string[]
  /** chapters + glossary + ghi chú nguồn truyền thuyết */
  description: string
  descriptionVi: string
  tags: string[]
  thumbnailConcepts: ThumbnailConcept[]
  /** Câu móc mở đầu Shorts teaser + lời kêu gọi xem bản dài */
  shortsHook?: string
  shortsHookVi?: string
  shortsCta?: string
  shortsCtaVi?: string
}

export interface TiktokPublishing {
  captionVi: string
  hashtags: string[]
  coverConcepts: ThumbnailConcept[]
  partLabel: string
}

export interface ShortsTeaser {
  start: number
  end: number
  /** File MP4 (tương đối thư mục Story) */
  path: string | null
  hookText: string
  ctaText: string
  createdAt: string
}

export interface PublishingPackage {
  youtube?: YoutubePublishing
  tiktok?: TiktokPublishing
  aiDisclosureNeeded: boolean
  checklist: ChecklistItem[]
  /** Thumbnail / ảnh bìa đã tạo (có chữ) */
  thumbnails: MediaRef[]
  selectedThumbnail: string | null
  shorts?: ShortsTeaser | null
  generatedAt: string
}

export interface PerformanceNote {
  id: string
  releaseId: string
  date: string
  views: number
  avgWatchPercent: number
  likes: number
  comments: number
  shares: number
  notes: string
}

export interface CostEntry {
  provider: string
  kind: 'tts' | 'image' | 'video' | 'llm' | 'stt' | 'render'
  units: number
  cost: number
  timestamp: string
}

export interface CostLedger {
  estimated: number
  actual: number
  budgetLimit: number
  entries: CostEntry[]
}

// ---------------------------------------------------------------------------
// Trạng thái pipeline (lưu trong release.json để mở lại app vẫn tiếp tục được)
// ---------------------------------------------------------------------------

export type StepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'waitingApproval'
  | 'failed'
  | 'cancelled'

export interface StepState {
  status: StepStatus
  /** 0..1 */
  progress: number
  message?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export type RunMode = 'review' | 'fullAuto'

export interface PipelineState {
  mode: RunMode
  running: boolean
  currentStep: number | null
  steps: Record<number, StepState>
  updatedAt: string
  /** Duyệt có điều kiện (vd bước 16: xác nhận chi phí video AI) – 'declined' = người dùng từ chối */
  approvals?: Record<number, 'approved' | 'declined'>
}

export interface Release {
  id: string
  storyId: string
  title: string
  platform: Platform
  language: Language
  aspectRatio: AspectRatio
  /** Giây */
  targetDuration: number
  seriesGroupId: string | null
  partIndex: number
  partCount: number
  heroRatio: number
  script: Script
  voiceTrack: VoiceTrack | null
  scenes: ReleaseScene[]
  chapters: Chapter[]
  subtitles: SubtitleCue[]
  soundCues: SoundCue[]
  publishing: PublishingPackage | null
  costs: CostLedger
  pipelineState: PipelineState | null
  /** Lần render MP4 gần nhất – fingerprint dùng để phát hiện bản render đã cũ */
  lastRender?: RenderRecord | null
  /** Nguồn giọng: TTS từng câu (mặc định) hoặc file tự thu cả bài */
  voiceSource?: 'tts' | 'recorded'
  recording?: Recording | null
  createdAt: string
  updatedAt: string
}

/** File giọng tự thu (cả bài) + bản chép lời Whisper để căn mốc */
export interface Recording {
  /** Bản sao trong thư mục Release, tương đối so với thư mục Story */
  path: string
  originalName: string
  importedAt: string
  duration: number
  /** sha1 nội dung file – đổi file ⇒ phải chép lời lại */
  hash: string
  transcript: RecordingTranscript | null
  /** Tỉ lệ từ kịch bản khớp được */
  coverage: number | null
  extraWords: number | null
}

export interface RecordingTranscript {
  provider: string
  model: string
  language: string
  text: string
  words: { word: string; start: number; end: number }[]
  /** hash của file đã chép lời */
  forHash: string
  cost: number
  createdAt: string
}

export interface RenderRecord {
  /** Tương đối so với thư mục Story */
  path: string
  fingerprint: string
  renderedAt: string
}

// ============================================================================
// JOB (hàng đợi dùng chung TTS / ảnh / video)
// ============================================================================

export type JobType = 'tts' | 'image' | 'video' | 'llm' | 'stt' | 'render' | 'depthMap'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Job<P = unknown, R = unknown> {
  id: string
  type: JobType
  payload: P
  status: JobStatus
  attempts: number
  error: string | null
  result: R | null
  estimatedCost: number
  /** Provider dùng để giới hạn số luồng riêng (gemini, elevenlabs, mock…) */
  providerId: string
  storyId: string | null
  /** hash(input + model + params + reference) – không tạo trùng */
  cacheKey: string | null
  /** Mô tả ngắn hiển thị trong Film Studio */
  label: string
  /** Số thứ tự hiển thị trên thẻ */
  seq: number
  progress: number
  actualCost: number
  /** Thời điểm sớm nhất được chạy lại (backoff sau lỗi) */
  nextRunAt: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** Kết quả kiểm tra đồng nhất nhân vật bằng LLM nhìn ảnh (so ảnh cảnh với character sheet) */
export interface ConsistencyCheck {
  checkedAt: string
  ok: boolean
  /** Ví dụ: "Út Lan: sai màu áo (phải là áo bà ba xanh)" */
  issues: string[]
  characterIds: string[]
  provider: string
}
