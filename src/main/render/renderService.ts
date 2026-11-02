/**
 * Quản lý utility process render (khởi động lười, giữ sống để dùng lại bundle Remotion đã build).
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { utilityProcess, type UtilityProcess } from 'electron'
import { logger } from '../logger'
import type { RenderProgress, RenderRequest, VideoRenderer, WorkerInbound, WorkerOutbound } from './protocol'

interface Pending {
  resolve: () => void
  reject: (err: Error) => void
  onProgress: (p: RenderProgress) => void
}

export class RenderService implements VideoRenderer {
  private child: UtilityProcess | null = null
  private pending = new Map<string, Pending>()

  constructor(
    private readonly workerPath: string,
    /** Thư mục làm việc của tiến trình render (bản cài đặt: <userData>/render) */
    private readonly cwd?: string
  ) {
    if (cwd) fs.mkdirSync(cwd, { recursive: true })
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    // cwd = thư mục ghi được: Remotion tải Chrome Headless Shell vào <cwd>/.remotion (bản cài đặt không ghi được vào Program Files)
    const child = utilityProcess.fork(this.workerPath, [], { serviceName: 'Folklore Render', stdio: 'pipe', cwd: this.cwd })
    child.stdout?.on('data', (d: Buffer) => logger.info(d.toString('utf8').trim(), 'render'))
    child.stderr?.on('data', (d: Buffer) => logger.warn(d.toString('utf8').trim(), 'render'))
    child.on('message', (msg: WorkerOutbound) => {
      if (msg.type === 'log') {
        logger.info(msg.message, 'render')
        return
      }
      const p = this.pending.get(msg.jobId)
      if (!p) return
      if (msg.type === 'progress') p.onProgress(msg.progress)
      else if (msg.type === 'done') {
        this.pending.delete(msg.jobId)
        p.resolve()
      } else if (msg.type === 'error') {
        this.pending.delete(msg.jobId)
        const err = new Error(msg.message)
        if (msg.aborted) err.name = 'AbortError'
        p.reject(err)
      }
    })
    child.on('exit', (code) => {
      logger.warn(`Render worker thoát (mã ${code})`, 'render')
      for (const [, p] of this.pending) p.reject(new Error(`Tiến trình render dừng đột ngột (mã ${code})`))
      this.pending.clear()
      this.child = null
    })
    this.child = child
    return child
  }

  render(req: RenderRequest, onProgress: (p: RenderProgress) => void, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Đã huỷ', 'AbortError'))
      const jobId = randomUUID()
      const child = this.ensureChild()
      this.pending.set(jobId, { resolve, reject, onProgress })
      signal?.addEventListener(
        'abort',
        () => child.postMessage({ type: 'cancel', jobId } satisfies WorkerInbound),
        { once: true }
      )
      child.postMessage({ type: 'render', jobId, request: req } satisfies WorkerInbound)
    })
  }

  dispose(): void {
    this.child?.kill()
    this.child = null
  }
}
