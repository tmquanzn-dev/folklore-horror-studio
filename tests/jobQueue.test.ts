import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { JobQueueImpl, type QueueOptions } from '../src/main/queue/jobQueue'
import { HttpError } from '../src/main/providers/http'
import type { Job } from '../src/shared/types'

function q(over: Partial<QueueOptions> = {}): JobQueueImpl {
  return new JobQueueImpl({ concurrency: 2, maxConcurrency: 20, maxAttempts: 3, backoffBaseMs: 5, backoffMaxMs: 50, random: () => 0, ...over })
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Handler điều khiển được từ test */
function controllable() {
  const pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void; payload: unknown; signal: AbortSignal }[] = []
  let maxRunning = 0
  let running = 0
  const handler = (payload: unknown, ctx: { signal: AbortSignal }) =>
    new Promise<{ result: unknown; cost: number }>((resolve, reject) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      const done = (fn: () => void): void => {
        running--
        fn()
      }
      pending.push({ resolve: (v) => done(() => resolve({ result: v, cost: 0.1 })), reject: (e) => done(() => reject(e)), payload, signal: ctx.signal })
      ctx.signal.addEventListener('abort', () => done(() => reject(new Error('aborted'))))
    })
  return { handler, pending, max: () => maxRunning }
}

describe('JobQueue – số luồng', () => {
  it('không chạy quá concurrency; tăng luồng khi đang chạy thì chạy thêm ngay', async () => {
    const c = controllable()
    const queue = q({ concurrency: 2 })
    queue.register('image', c.handler)
    for (let i = 0; i < 6; i++) queue.enqueue('image', { i }, { providerId: 'mock', estimatedCost: 0 })
    await tick()
    expect(c.pending.length).toBe(2)
    queue.setConcurrency(5)
    await tick()
    expect(c.pending.length).toBe(5)
    expect(queue.state().counts.running).toBe(5)
    c.pending.forEach((p) => p.resolve('ok'))
    await tick(20)
    c.pending.slice(5).forEach((p) => p.resolve('ok'))
    await tick(20)
    expect(queue.state().counts.done).toBe(6)
    expect(c.max()).toBeLessThanOrEqual(5)
  })

  it('giới hạn riêng theo provider', async () => {
    const c = controllable()
    const queue = q({ concurrency: 10, providerLimits: { gemini: 2 } })
    queue.register('image', c.handler)
    for (let i = 0; i < 4; i++) queue.enqueue('image', { p: 'g' }, { providerId: 'gemini', estimatedCost: 0 })
    for (let i = 0; i < 3; i++) queue.enqueue('image', { p: 'm' }, { providerId: 'mock', estimatedCost: 0 })
    await tick()
    expect(c.pending.filter((p) => (p.payload as { p: string }).p === 'g').length).toBe(2)
    expect(c.pending.filter((p) => (p.payload as { p: string }).p === 'm').length).toBe(3)
  })
})

describe('JobQueue – retry, huỷ, tạm dừng', () => {
  it('lỗi tạm thời ⇒ thử lại với backoff; tôn trọng Retry-After', async () => {
    let calls = 0
    const queue = q({ maxAttempts: 3 })
    queue.register('image', async () => {
      calls++
      if (calls === 1) throw new HttpError('rate limited', 429, '', 30)
      if (calls === 2) throw new Error('fetch failed')
      return { result: 'ok', cost: 0 }
    })
    const job = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0 })
    await tick(2)
    expect(job.status).toBe('queued')
    expect(job.nextRunAt).toBeGreaterThan(0)
    const done = await queue.wait(job.id)
    expect(done.status).toBe('done')
    expect(done.attempts).toBe(3)
  })

  it('lỗi không thể thử lại (400, sai key) ⇒ hỏng ngay', async () => {
    const queue = q()
    queue.register('image', async () => {
      throw new HttpError('bad', 400, '')
    })
    const job = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0 })
    expect((await queue.wait(job.id)).status).toBe('failed')
    expect(job.attempts).toBe(1)
  })

  it('huỷ job đang chạy (AbortSignal) và job đang chờ; thử lại job đã huỷ', async () => {
    const c = controllable()
    const queue = q({ concurrency: 1 })
    queue.register('image', c.handler)
    const a = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0 })
    const b = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0 })
    await tick()
    queue.cancel(b.id)
    expect(b.status).toBe('cancelled')
    queue.cancel(a.id)
    expect((await queue.wait(a.id)).status).toBe('cancelled')
    expect(c.pending[0].signal.aborted).toBe(true)
    queue.retry(b.id)
    await tick()
    expect(b.status).toBe('running')
  })

  it('tạm dừng: job mới không chạy cho tới khi tiếp tục', async () => {
    const c = controllable()
    const queue = q()
    queue.register('image', c.handler)
    queue.pause()
    queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0 })
    await tick()
    expect(c.pending.length).toBe(0)
    queue.resume()
    await tick()
    expect(c.pending.length).toBe(1)
  })
})

describe('JobQueue – ngân sách & chi phí', () => {
  it('chạm ngân sách ⇒ dừng cả hàng đợi, job vẫn "chờ"; ghi chi phí thực tế', async () => {
    let spent = 0
    const costs: number[] = []
    const queue = q({
      concurrency: 1,
      budget: async (job) => (spent + job.estimatedCost <= 0.25 ? { ok: true } : { ok: false, reason: 'hết ngân sách' }),
      onCost: (_j, cost) => {
        spent += cost
        costs.push(cost)
      }
    })
    queue.register('image', async () => ({ result: 'x', cost: 0.1 }))
    const jobs: Job[] = []
    for (let i = 0; i < 4; i++) jobs.push(queue.enqueue('image', { i }, { providerId: 'gemini', estimatedCost: 0.1 }))
    await tick(30)
    expect(costs).toEqual([0.1, 0.1])
    expect(queue.state().paused).toBe(true)
    expect(queue.state().budgetBlocked).toBe('hết ngân sách')
    expect(jobs[2].status).toBe('queued')
    spent = 0
    queue.resume()
    await tick(30)
    expect(jobs.every((j) => j.status === 'done')).toBe(true)
  })
})

describe('JobQueue – cache & lưu đĩa', () => {
  it('cacheKey: job trùng đang chạy dùng chung; đã xong ⇒ trả kết quả ngay, không chạy lại', async () => {
    let calls = 0
    const queue = q()
    queue.register('image', async () => {
      calls++
      await tick(5)
      return { result: { path: 'a.png' }, cost: 0.04 }
    })
    const a = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0, cacheKey: 'k1' })
    const b = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0, cacheKey: 'k1' })
    expect(b.id).toBe(a.id)
    await queue.wait(a.id)
    const c = queue.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0, cacheKey: 'k1' })
    expect(c.status).toBe('done')
    expect(c.result).toEqual({ path: 'a.png' })
    expect(calls).toBe(1)
  })

  it('lưu hàng chờ + cache xuống đĩa; khôi phục ở trạng thái tạm dừng', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-q-')), 'queue.json')
    const q1 = q({ persistPath: file })
    q1.register('image', async () => ({ result: 'r', cost: 0 }))
    await q1.wait(q1.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0, cacheKey: 'done-key' }).id)
    q1.pause()
    q1.enqueue('image', { keep: true }, { providerId: 'mock', estimatedCost: 0, label: 'việc dở' })
    await q1.persist()

    const q2 = q({ persistPath: file })
    q2.register('image', async () => ({ result: 'r2', cost: 0 }))
    await q2.restore()
    expect(q2.state().paused).toBe(true)
    expect(q2.list().filter((j) => j.status === 'queued').map((j) => j.label)).toEqual(['việc dở'])
    expect(q2.enqueue('image', {}, { providerId: 'mock', estimatedCost: 0, cacheKey: 'done-key' }).status).toBe('done')
  })
})
