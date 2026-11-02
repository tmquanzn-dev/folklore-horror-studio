/**
 * PIPELINE RUNNER – chạy tuần tự các bước của một Release, lưu trạng thái sau mỗi bước.
 * - Điểm duyệt ★: chế độ "Duyệt từng bước" dừng lại (waitingApproval) ⇒ bấm "Tiếp tục" để đi tiếp.
 *   Chế độ "Full Auto" tự bỏ qua điểm duyệt (chỉ để tạo bản nháp).
 * - Bước lỗi: bấm "Bắt đầu" lần nữa sẽ chạy lại ĐÚNG bước lỗi (các bước xong được giữ nguyên).
 * - Huỷ: AbortController truyền xuống từng bước (ffmpeg, queue TTS, render).
 */
import path from 'node:path'
import {
  createInitialPipelineState,
  isPipelineComplete,
  isStepFinished,
  RELEASE_PIPELINE,
  type StepDef
} from '../../shared/pipeline'
import type { PipelineState, Release, RunMode } from '../../shared/types'
import { isAbortError, toVietnameseError } from '../errors'
import { logger } from '../logger'
import type { PipelineDeps, StepContext } from './context'
import { STEP_HANDLERS } from './steps'

const key = (storyId: string, releaseId: string): string => `${storyId}/${releaseId}`

export class PipelineRunner {
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>()

  constructor(private readonly deps: PipelineDeps) {}

  isRunning(storyId: string, releaseId: string): boolean {
    return this.active.has(key(storyId, releaseId))
  }

  /** Chờ lượt chạy hiện tại kết thúc (dùng cho test) */
  async waitIdle(storyId: string, releaseId: string): Promise<void> {
    await this.active.get(key(storyId, releaseId))?.done
  }

  async start(storyId: string, releaseId: string, mode: RunMode): Promise<void> {
    if (this.isRunning(storyId, releaseId)) throw new Error('Pipeline của Release này đang chạy')
    const release = await this.deps.repo.loadRelease(storyId, releaseId)
    let state = release.pipelineState
    // Đã xong toàn bộ ⇒ chạy lại từ đầu (cache giúp không tạo lại media trùng)
    if (!state || isPipelineComplete(state)) state = createInitialPipelineState(mode)
    state.mode = mode
    // Bước bị huỷ/lỗi ⇒ đưa về pending để chạy lại
    for (const def of RELEASE_PIPELINE) {
      const st = state.steps[def.no]
      if (st && (st.status === 'failed' || st.status === 'cancelled' || st.status === 'running')) {
        state.steps[def.no] = { status: 'pending', progress: 0 }
      }
    }
    release.pipelineState = state
    await this.persist(release, true)
    logger.info(`Bắt đầu pipeline (${mode === 'review' ? 'Duyệt từng bước' : 'Full Auto – bản nháp'})`, release.id)
    this.launch(storyId, releaseId)
  }

  async continue(storyId: string, releaseId: string, decision: 'approved' | 'declined' = 'approved'): Promise<void> {
    if (this.isRunning(storyId, releaseId)) throw new Error('Pipeline đang chạy')
    const release = await this.deps.repo.loadRelease(storyId, releaseId)
    const state = release.pipelineState
    const waiting = state && RELEASE_PIPELINE.find((d) => state.steps[d.no]?.status === 'waitingApproval')
    if (!state || !waiting) throw new Error('Không có bước nào đang chờ duyệt')
    const now = new Date().toISOString()
    if (!waiting.approval) {
      // Duyệt có điều kiện (vd báo giá video AI): ghi quyết định rồi chạy lại chính bước đó
      state.approvals = { ...(state.approvals ?? {}), [waiting.no]: decision }
      state.steps[waiting.no] = { status: 'pending', progress: 0, message: decision === 'approved' ? 'Đã đồng ý' : 'Đã bỏ qua' }
      await this.persist(release, true)
      logger.info(`★ Bước ${waiting.no}: ${decision === 'approved' ? 'Đồng ý' : 'Bỏ qua'} (${waiting.title})`, release.id)
      this.launch(storyId, releaseId)
      return
    }
    state.steps[waiting.no] = { status: 'done', progress: 1, message: 'Đã duyệt', finishedAt: now }
    this.markApproved(release, waiting, now)
    await this.persist(release, true)
    logger.info(`★ Đã duyệt bước ${waiting.no}: ${waiting.title}`, release.id)
    this.launch(storyId, releaseId)
  }

  cancel(storyId: string, releaseId: string): void {
    this.active.get(key(storyId, releaseId))?.abort.abort()
  }

  async resetFrom(storyId: string, releaseId: string, stepNo: number): Promise<void> {
    if (this.isRunning(storyId, releaseId)) throw new Error('Hãy huỷ pipeline trước khi chạy lại từ một bước')
    const release = await this.deps.repo.loadRelease(storyId, releaseId)
    const state = release.pipelineState ?? createInitialPipelineState('review')
    for (const def of RELEASE_PIPELINE) {
      if (def.no >= stepNo) state.steps[def.no] = { status: 'pending', progress: 0 }
    }
    state.currentStep = null
    state.running = false
    release.pipelineState = state
    await this.persist(release, true)
    logger.info(`Đặt lại pipeline từ bước ${stepNo}`, release.id)
  }

  /** Ghi nhận duyệt lên dữ liệu tương ứng (kịch bản, giọng, storyboard) */
  private markApproved(release: Release, def: StepDef, at: string): void {
    if (def.key === 'approveScript' || def.key === 'approveVoice') {
      for (const l of release.script.lines) l.approval = { status: 'approved', at }
    }
  }

  private launch(storyId: string, releaseId: string): void {
    const abort = new AbortController()
    const done = this.loop(storyId, releaseId, abort.signal).finally(() => {
      this.active.delete(key(storyId, releaseId))
    })
    this.active.set(key(storyId, releaseId), { abort, done })
  }

  private async persist(release: Release, force = false): Promise<void> {
    if (release.pipelineState) release.pipelineState.updatedAt = new Date().toISOString()
    await this.deps.repo.saveRelease(release)
    if (release.pipelineState) this.deps.emitProgress(release.storyId, release.id, release.pipelineState, force)
    this.deps.emitDataChanged(release.storyId)
  }

  private async loop(storyId: string, releaseId: string, signal: AbortSignal): Promise<void> {
    const { repo } = this.deps
    let release = await repo.loadRelease(storyId, releaseId)
    const state = (): PipelineState => release.pipelineState as PipelineState

    try {
      state().running = true
      for (const def of RELEASE_PIPELINE) {
        const st = state().steps[def.no]
        if (isStepFinished(st)) continue

        if (def.approval) {
          if (state().mode === 'fullAuto') {
            state().steps[def.no] = {
              status: 'skipped',
              progress: 1,
              message: 'Tự duyệt (Full Auto – bản nháp)',
              finishedAt: new Date().toISOString()
            }
            await this.persist(release)
            continue
          }
          state().steps[def.no] = { status: 'waitingApproval', progress: 0, message: 'Chờ bạn duyệt rồi bấm "Tiếp tục"' }
          state().currentStep = def.no
          state().running = false
          await this.persist(release, true)
          logger.info(`★ Dừng ở bước ${def.no}: ${def.title} – chờ duyệt`, release.id)
          return
        }

        const handler = STEP_HANDLERS[def.key]
        if (!handler) throw new Error(`Thiếu handler cho bước ${def.no}`)

        const startedAt = new Date().toISOString()
        state().currentStep = def.no
        state().steps[def.no] = { status: 'running', progress: 0, startedAt, message: 'Đang chạy…' }
        await this.persist(release, true)
        logger.info(`▶ Bước ${def.no}: ${def.title}`, release.id)

        const story = await repo.loadStory(storyId)
        const library = await repo.loadLibrary()
        const ctx: StepContext = {
          deps: this.deps,
          story,
          release,
          library,
          signal,
          storyDir: repo.storyDir(storyId),
          releaseDir: repo.releaseDir(storyId, releaseId),
          progress: (p, message) => {
            const cur = state().steps[def.no]
            cur.progress = Math.max(0, Math.min(1, p))
            if (message) cur.message = message
            this.deps.emitProgress(storyId, releaseId, state())
          },
          log: (message, level = 'info') => logger[level](message, release.id),
          saveStory: async () => {
            await repo.saveStory(story)
            this.deps.emitDataChanged(storyId)
          },
          mode: state().mode,
          approval: state().approvals?.[def.no]
        }

        try {
          const result = await handler(ctx)
          if (result.status === 'waitingApproval') {
            state().steps[def.no] = { status: 'waitingApproval', progress: 0, message: result.message, startedAt }
            state().currentStep = def.no
            state().running = false
            await this.persist(release, true)
            logger.info(`★ Bước ${def.no} chờ quyết định: ${result.message ?? ''}`, release.id)
            return
          }
          state().steps[def.no] = {
            status: result.status,
            progress: 1,
            message: result.message,
            startedAt,
            finishedAt: new Date().toISOString()
          }
          logger.info(`✓ Bước ${def.no}: ${result.message ?? 'xong'}`, release.id)
          await this.persist(release, true)
        } catch (err) {
          const aborted = isAbortError(err) || signal.aborted
          const message = toVietnameseError(err)
          state().steps[def.no] = {
            status: aborted ? 'cancelled' : 'failed',
            progress: state().steps[def.no]?.progress ?? 0,
            startedAt,
            finishedAt: new Date().toISOString(),
            error: message,
            message: aborted ? 'Đã huỷ' : 'Lỗi – bấm "Bắt đầu" để chạy lại bước này'
          }
          state().running = false
          if (aborted) logger.warn(`■ Đã huỷ ở bước ${def.no}`, release.id)
          else {
            logger.error(`✗ Bước ${def.no} lỗi: ${message}`, release.id)
            if (err instanceof Error && err.stack) logger.error(err.stack, release.id)
          }
          await this.persist(release, true)
          return
        }
        // Đọc lại từ đĩa để luôn đồng bộ (bước có thể đã sửa story)
        release = await repo.loadRelease(storyId, releaseId)
      }

      state().running = false
      state().currentStep = null
      await this.persist(release, true)
      const exportsDir = path.join(repo.releaseDir(storyId, releaseId), 'exports')
      logger.info(`Hoàn tất pipeline. Video nằm trong: ${exportsDir}`, release.id)
    } catch (err) {
      // Lỗi ngoài bước (đọc/ghi file…)
      logger.error(`Pipeline dừng do lỗi: ${toVietnameseError(err)}`, releaseId)
      try {
        release = await repo.loadRelease(storyId, releaseId)
        if (release.pipelineState) {
          release.pipelineState.running = false
          await this.persist(release, true)
        }
      } catch {
        // bỏ qua
      }
    }
  }
}
