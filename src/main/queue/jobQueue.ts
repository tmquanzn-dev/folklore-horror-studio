/**
 * HÀNG ĐỢI JOB dùng chung TTS / ảnh / video.
 * - Số luồng chung 1–20, chỉnh được khi đang chạy; giới hạn riêng từng provider.
 * - Retry exponential backoff + jitter; lỗi 429/503 tôn trọng Retry-After.
 * - Huỷ (AbortController), tạm dừng / tiếp tục.
 * - Dừng cả hàng đợi khi chạm ngân sách (job giữ nguyên trạng thái "chờ").
 * - Cache theo cacheKey: job trùng đang chờ/chạy ⇒ dùng chung; đã xong ⇒ trả kết quả ngay, không tạo lại.
 * - Lưu hàng chờ + cache xuống đĩa, khôi phục khi mở lại app (khôi phục ở trạng thái TẠM DỪNG để tránh tốn phí bất ngờ).
 * Không dùng worker thread: job gọi API là I/O, chạy song song bằng Promise trong main process.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { backoffDelay, isRetryableStatus } from '../providers/http'
import type { EnqueueOptions, JobHandler, JobQueue, QueueState } from '../providers/interfaces'
import type { Job, JobStatus, JobType } from '../../shared/types'

export interface QueueOptions {
  concurrency: number
  maxConcurrency: number
  providerLimits?: Record<string, number>
  maxAttempts: number
  backoffBaseMs: number
  backoffMaxMs: number
  /** File lưu hàng chờ (bỏ trống = không lưu) */
  persistPath?: string
  /** Kiểm tra ngân sách trước khi chạy job; ok=false ⇒ dừng hàng đợi */
  budget?: (job: Job, queue: JobQueueImpl) => Promise<{ ok: boolean; reason?: string }>
  /** Ghi chi phí thực tế vào CostLedger */
  onCost?: (job: Job, cost: number) => Promise<void> | void
  random?: () => number
  now?: () => number
  /** Giới hạn số job đã xong giữ trong danh sách */
  keepFinished?: number
  maxCacheEntries?: number
}

const TERMINAL: JobStatus[] = ['done', 'failed', 'cancelled']

/** Lỗi có nên thử lại không: HTTP 408/409/425/429/5xx, lỗi mạng/timeout; lỗi khác (sai key, sai input) thì không */
export function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (typeof status === 'number') return isRetryableStatus(status)
  const msg = err instanceof Error ? err.message : String(err)
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|socket hang up/i.test(msg)
}

export function retryAfterOf(err: unknown): number | null {
  const v = (err as { retryAfterMs?: number } | null)?.retryAfterMs
  return typeof v === 'number' && v >= 0 ? v : null
}

interface PersistShape {
  version: 1
  paused: boolean
  concurrency: number
  seq: number
  jobs: Job[]
  cache: [string, unknown][]
}

export class JobQueueImpl implements JobQueue {
  private jobs = new Map<string, Job>()
  private handlers = new Map<JobType, JobHandler<unknown, unknown>>()
  private controllers = new Map<string, AbortController>()
  private providerRunning = new Map<string, number>()
  private providerLimits = new Map<string, number>()
  private cache = new Map<string, unknown>()
  private listeners = new Set<() => void>()
  private waiters = new Map<string, ((j: Job) => void)[]>()
  private starting = 0
  private paused = false
  private budgetBlocked: string | null = null
  private concurrency: number
  private seq = 0
  private timer: NodeJS.Timeout | null = null
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private readonly opts: QueueOptions) {
    this.concurrency = this.clampConcurrency(opts.concurrency)
    for (const [k, v] of Object.entries(opts.providerLimits ?? {})) this.providerLimits.set(k, Math.max(1, v))
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now()
  }

  private clampConcurrency(n: number): number {
    return Math.min(this.opts.maxConcurrency, Math.max(1, Math.round(n) || 1))
  }

  register<P, R>(type: JobType, handler: JobHandler<P, R>): void {
    this.handlers.set(type, handler as JobHandler<unknown, unknown>)
  }

  // ------------------------------------------------------------------ thêm job

  enqueue<P>(type: JobType, payload: P, o: EnqueueOptions): Job<P> {
    if (!this.handlers.has(type)) throw new Error(`Chưa đăng ký handler cho job "${type}"`)
    const key = o.cacheKey ?? null
    if (key) {
      // Job trùng đang chờ/chạy ⇒ dùng chung
      for (const j of this.jobs.values()) {
        if (j.cacheKey === key && (j.status === 'queued' || j.status === 'running')) return j as Job<P>
      }
    }
    const now = new Date(this.now()).toISOString()
    const job: Job<P> = {
      id: randomUUID(),
      type,
      payload,
      status: 'queued',
      attempts: 0,
      error: null,
      result: null,
      estimatedCost: o.estimatedCost,
      providerId: o.providerId,
      storyId: o.storyId ?? null,
      cacheKey: key,
      label: o.label ?? type,
      seq: ++this.seq,
      progress: 0,
      actualCost: 0,
      nextRunAt: 0,
      createdAt: now,
      startedAt: null,
      finishedAt: null
    }
    // Đã có kết quả trong cache ⇒ xong ngay, không tốn phí
    if (key && this.cache.has(key)) {
      job.status = 'done'
      job.result = this.cache.get(key) ?? null
      job.progress = 1
      job.startedAt = now
      job.finishedAt = now
      job.error = null
      this.jobs.set(job.id, job)
      this.changed()
      return job
    }
    this.jobs.set(job.id, job)
    this.changed()
    this.pump()
    return job
  }

  wait(jobId: string): Promise<Job> {
    const job = this.jobs.get(jobId)
    if (!job) return Promise.reject(new Error(`Không tìm thấy job ${jobId}`))
    if (TERMINAL.includes(job.status)) return Promise.resolve(job)
    return new Promise((resolve) => {
      const list = this.waiters.get(jobId) ?? []
      list.push(resolve)
      this.waiters.set(jobId, list)
    })
  }

  // ------------------------------------------------------------------ điều khiển

  setConcurrency(n: number): void {
    this.concurrency = this.clampConcurrency(n)
    this.changed()
    this.pump()
  }

  setProviderLimit(providerId: string, n: number): void {
    this.providerLimits.set(providerId, Math.max(1, Math.round(n)))
    this.pump()
  }

  pause(): void {
    this.paused = true
    this.changed()
  }

  resume(): void {
    this.paused = false
    this.budgetBlocked = null
    this.changed()
    this.pump()
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || TERMINAL.includes(job.status)) return
    if (job.status === 'running') {
      // Handler nhận abort; job chuyển "cancelled" khi handler dừng
      this.controllers.get(jobId)?.abort()
      job.error = 'Đã huỷ'
      return
    }
    this.finish(job, 'cancelled', 'Đã huỷ')
  }

  cancelAll(): void {
    for (const j of [...this.jobs.values()]) this.cancel(j.id)
  }

  retry(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return
    Object.assign(job, { status: 'queued', attempts: 0, error: null, progress: 0, nextRunAt: 0, finishedAt: null })
    this.changed()
    this.pump()
  }

  clearFinished(): void {
    for (const [id, j] of this.jobs) if (TERMINAL.includes(j.status)) this.jobs.delete(id)
    this.changed()
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.seq - b.seq)
  }

  state(): QueueState {
    const counts: Record<JobStatus, number> = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
    for (const j of this.jobs.values()) counts[j.status]++
    return { concurrency: this.concurrency, paused: this.paused, budgetBlocked: this.budgetBlocked, counts }
  }

  /** Tổng chi phí ước tính của các job đang chạy của một Story (chưa ghi vào sổ) */
  inFlightCost(storyId: string | null): number {
    let s = 0
    for (const j of this.jobs.values()) if (j.status === 'running' && j.storyId === storyId) s += j.estimatedCost
    return s
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ------------------------------------------------------------------ vòng chạy

  private runningCount(): number {
    let n = this.starting
    for (const j of this.jobs.values()) if (j.status === 'running') n++
    return n
  }

  private providerCapacity(providerId: string): boolean {
    const limit = this.providerLimits.get(providerId) ?? Number.POSITIVE_INFINITY
    return (this.providerRunning.get(providerId) ?? 0) < limit
  }

  private pump(): void {
    if (this.paused) return
    const now = this.now()
    let earliest = Number.POSITIVE_INFINITY
    for (const job of this.list()) {
      if (this.runningCount() >= this.concurrency) break
      if (job.status !== 'queued') continue
      if (job.nextRunAt > now) {
        earliest = Math.min(earliest, job.nextRunAt)
        continue
      }
      if (!this.providerCapacity(job.providerId)) continue
      void this.start(job)
    }
    // Có job đang chờ hết thời gian backoff ⇒ hẹn giờ chạy lại vòng
    if (earliest !== Number.POSITIVE_INFINITY && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, Math.max(1, earliest - now))
    }
  }

  private async start(job: Job): Promise<void> {
    // Giữ chỗ ngay (đồng bộ) để vòng pump không khởi động quá số luồng trong lúc chờ kiểm tra ngân sách
    this.starting++
    this.providerRunning.set(job.providerId, (this.providerRunning.get(job.providerId) ?? 0) + 1)
    let reserved = true
    const release = (): void => {
      if (!reserved) return
      reserved = false
      this.providerRunning.set(job.providerId, Math.max(0, (this.providerRunning.get(job.providerId) ?? 1) - 1))
    }
    try {
      if (this.opts.budget) {
        const b = await this.opts.budget(job, this)
        if (!b.ok) {
          this.starting--
          release()
          this.paused = true
          this.budgetBlocked = b.reason ?? 'Chạm giới hạn ngân sách'
          job.error = this.budgetBlocked
          this.changed()
          return
        }
      }
      if (job.status !== 'queued') {
        this.starting--
        release()
        return
      }
      const handler = this.handlers.get(job.type)
      if (!handler) throw new Error(`Chưa đăng ký handler cho job "${job.type}"`)
      const ac = new AbortController()
      this.controllers.set(job.id, ac)
      this.starting--
      job.status = 'running'
      job.attempts++
      job.startedAt = new Date(this.now()).toISOString()
      job.progress = 0
      this.changed()

      try {
        const { result, cost } = await handler(job.payload, {
          signal: ac.signal,
          job,
          progress: (p) => {
            job.progress = Math.max(0, Math.min(1, p))
            this.changed()
          }
        })
        job.result = result
        job.actualCost += cost
        if (job.cacheKey) {
          this.cache.set(job.cacheKey, result)
          const max = this.opts.maxCacheEntries ?? 5000
          while (this.cache.size > max) this.cache.delete(this.cache.keys().next().value as string)
        }
        if (cost > 0) await this.opts.onCost?.(job, cost)
        this.finish(job, 'done', null)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (ac.signal.aborted) {
          this.finish(job, 'cancelled', 'Đã huỷ')
        } else if (job.attempts < this.opts.maxAttempts && isRetryableError(err)) {
          const delay = retryAfterOf(err) ?? backoffDelay(job.attempts, this.opts.backoffBaseMs, this.opts.backoffMaxMs, this.opts.random)
          job.status = 'queued'
          job.error = `Lần ${job.attempts} lỗi (${msg.slice(0, 160)}) – thử lại sau ${Math.round(delay / 100) / 10}s`
          job.nextRunAt = this.now() + delay
          this.changed()
        } else {
          this.finish(job, 'failed', msg)
        }
      } finally {
        this.controllers.delete(job.id)
      }
    } catch (err) {
      this.starting = Math.max(0, this.starting - 1)
      this.finish(job, 'failed', err instanceof Error ? err.message : String(err))
    } finally {
      release()
      this.pump()
    }
  }

  private finish(job: Job, status: JobStatus, error: string | null): void {
    job.status = status
    job.error = error
    if (status === 'done') job.progress = 1
    job.finishedAt = new Date(this.now()).toISOString()
    this.trimFinished()
    this.changed()
    const ws = this.waiters.get(job.id)
    if (ws) {
      this.waiters.delete(job.id)
      for (const w of ws) w(job)
    }
  }

  private trimFinished(): void {
    const keep = this.opts.keepFinished ?? 500
    const finished = this.list().filter((j) => TERMINAL.includes(j.status))
    for (const j of finished.slice(0, Math.max(0, finished.length - keep))) {
      if (!this.waiters.has(j.id)) this.jobs.delete(j.id)
    }
  }

  private persistTimer: NodeJS.Timeout | null = null

  private changed(): void {
    for (const l of this.listeners) l()
    // Gom nhiều thay đổi (tiến độ %) thành một lần ghi đĩa
    if (this.opts.persistPath && !this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null
        void this.persist()
      }, 400)
    }
  }

  // ------------------------------------------------------------------ lưu / khôi phục

  persist(): Promise<void> {
    const file = this.opts.persistPath
    if (!file) return Promise.resolve()
    const data: PersistShape = {
      version: 1,
      paused: this.paused,
      concurrency: this.concurrency,
      seq: this.seq,
      // Chỉ lưu job chưa xong + job lỗi (để thử lại); job xong nằm trong cache
      jobs: this.list().filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'failed'),
      cache: [...this.cache.entries()]
    }
    this.persistChain = this.persistChain
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        const tmp = `${file}.tmp`
        await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
        await fs.rename(tmp, file)
      })
      .catch(() => undefined)
    return this.persistChain
  }

  async restore(): Promise<void> {
    const file = this.opts.persistPath
    if (!file) return
    let data: PersistShape
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8')) as PersistShape
    } catch {
      return
    }
    this.seq = Math.max(this.seq, data.seq ?? 0)
    this.concurrency = this.clampConcurrency(data.concurrency ?? this.concurrency)
    for (const [k, v] of data.cache ?? []) this.cache.set(k, v)
    let pending = 0
    for (const j of data.jobs ?? []) {
      if (!this.handlers.has(j.type)) continue
      if (j.status === 'running' || j.status === 'queued') {
        j.status = 'queued'
        j.nextRunAt = 0
        j.error = j.error ?? 'Khôi phục sau khi mở lại app'
        pending++
      }
      this.jobs.set(j.id, j)
    }
    // Có việc dở dang ⇒ khôi phục ở trạng thái tạm dừng, người dùng bấm "Tiếp tục"
    this.paused = pending > 0 ? true : !!data.paused
    this.changed()
  }
}
