/**
 * Định nghĩa các bước pipeline (đánh số theo đặc tả 1–23).
 * GĐ1: pipeline của Release chạy từ bước 6 (đảm bảo ảnh ngân hàng cảnh) tới bước 23.
 * Bước 1–5 (tạo Story, LLM dàn ý, duyệt dàn ý, đề xuất cảnh, ước tính chi phí) đã có sẵn trong dữ liệu mẫu.
 */
import type { PipelineState, RunMode, StepState } from './types'

export const PIPELINE_TOTAL_STEPS = 23

export type StepKey =
  | 'bankImages'
  | 'approveStoryboard'
  | 'adaptScript'
  | 'approveScript'
  | 'pronunciation'
  | 'tts'
  | 'assembleVoice'
  | 'approveVoice'
  | 'matchScenes'
  | 'framing'
  | 'heroScenes'
  | 'motion'
  | 'soundDesign'
  | 'subtitles'
  | 'approvePreview'
  | 'render'
  | 'publishPackage'
  | 'shorts'

export interface StepDef {
  no: number
  key: StepKey
  title: string
  /** ★ điểm duyệt – dừng lại chờ người dùng bấm "Tiếp tục" (bỏ qua khi Full Auto) */
  approval: boolean
  /** Ghi chú cho GĐ1 (vd: bước này dùng dữ liệu mẫu / sẽ làm ở GĐ nào) */
  phaseNote?: string
}

export const RELEASE_PIPELINE: StepDef[] = [
  { no: 6, key: 'bankImages', title: 'Tạo ảnh ngân hàng cảnh', approval: false, phaseNote: 'Mock: ảnh placeholder · API thật: Gemini' },
  { no: 7, key: 'approveStoryboard', title: 'Duyệt storyboard', approval: true },
  { no: 8, key: 'adaptScript', title: 'Chuyển thể kịch bản', approval: false, phaseNote: 'LLM chuyển thể theo nền tảng + ngôn ngữ' },
  { no: 9, key: 'approveScript', title: 'Duyệt kịch bản', approval: true },
  { no: 10, key: 'pronunciation', title: 'Áp từ điển phát âm', approval: false },
  { no: 11, key: 'tts', title: 'Tạo giọng từng câu', approval: false, phaseNote: 'Mock: giọng giả lập · API thật: ElevenLabs / OpenAI' },
  { no: 12, key: 'assembleVoice', title: 'Xử lý & ghép giọng', approval: false },
  { no: 13, key: 'approveVoice', title: 'Duyệt giọng', approval: true },
  { no: 14, key: 'matchScenes', title: 'Khớp cảnh theo beat', approval: false },
  { no: 15, key: 'framing', title: 'Khung hình (cắt dọc)', approval: false },
  { no: 16, key: 'heroScenes', title: 'Cảnh hero / Video AI', approval: false, phaseNote: 'Video AI có phí ⇒ báo giá, chờ Đồng ý / Bỏ qua' },
  { no: 17, key: 'motion', title: 'Gán chuyển động', approval: false },
  { no: 18, key: 'soundDesign', title: 'Sound design & mix', approval: false, phaseNote: 'Ambience, SFX, stinger, ducking, -14 LUFS' },
  { no: 19, key: 'subtitles', title: 'Phụ đề', approval: false },
  { no: 20, key: 'approvePreview', title: 'Xem trước & chỉnh timeline', approval: true },
  { no: 21, key: 'render', title: 'Render MP4', approval: false },
  { no: 22, key: 'publishPackage', title: 'Gói xuất bản', approval: false, phaseNote: 'Tiêu đề, mô tả, tags/hashtag, thumbnail, checklist' },
  { no: 23, key: 'shorts', title: 'Cắt Shorts teaser', approval: false, phaseNote: 'Chỉ bản YouTube: teaser 9:16 30–60s' }
]

export function getStepDef(no: number): StepDef | undefined {
  return RELEASE_PIPELINE.find((s) => s.no === no)
}

export function createInitialPipelineState(mode: RunMode): PipelineState {
  const steps: Record<number, StepState> = {}
  for (const def of RELEASE_PIPELINE) steps[def.no] = { status: 'pending', progress: 0 }
  return { mode, running: false, currentStep: null, steps, updatedAt: new Date().toISOString() }
}

/**
 * Đánh dấu các bước từ stepNo trở đi về "Chờ" (sau khi sửa kịch bản/giọng).
 * Trả về true nếu có thay đổi. Media đã tạo vẫn còn trong cache ⇒ chạy lại chỉ tạo phần thay đổi.
 */
export function resetStepsFrom(state: PipelineState | null, stepNo: number): boolean {
  if (!state) return false
  let changed = false
  for (const def of RELEASE_PIPELINE) {
    const st = state.steps[def.no]
    if (def.no >= stepNo && st && st.status !== 'pending') {
      state.steps[def.no] = { status: 'pending', progress: 0 }
      changed = true
    }
  }
  if (changed && state.currentStep != null && state.currentStep >= stepNo) state.currentStep = null
  // Quyết định duyệt có điều kiện của các bước bị đặt lại cũng hết hiệu lực
  if (state.approvals) for (const k of Object.keys(state.approvals)) if (Number(k) >= stepNo) delete state.approvals[Number(k)]
  return changed
}

export function isStepFinished(state: StepState | undefined): boolean {
  return !!state && (state.status === 'done' || state.status === 'skipped')
}

export function isPipelineComplete(state: PipelineState | null): boolean {
  if (!state) return false
  return RELEASE_PIPELINE.every((d) => isStepFinished(state.steps[d.no]))
}

/** Tiến độ tổng 0..1 (dùng cho danh sách Release ở Trang chủ) */
export function pipelineProgress(state: PipelineState | null): number {
  if (!state) return 0
  let sum = 0
  for (const d of RELEASE_PIPELINE) {
    const st = state.steps[d.no]
    if (isStepFinished(st)) sum += 1
    else if (st?.status === 'running') sum += st.progress
  }
  return sum / RELEASE_PIPELINE.length
}

export function stepStatusLabel(status: StepState['status']): string {
  switch (status) {
    case 'pending':
      return 'Chờ'
    case 'running':
      return 'Đang chạy'
    case 'done':
      return 'Xong'
    case 'skipped':
      return 'Bỏ qua'
    case 'waitingApproval':
      return 'Chờ duyệt'
    case 'failed':
      return 'Lỗi'
    case 'cancelled':
      return 'Đã huỷ'
  }
}
