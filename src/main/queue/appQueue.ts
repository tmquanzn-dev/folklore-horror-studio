/**
 * Tạo hàng đợi job của app: giới hạn theo provider (từ config), chặn khi chạm ngân sách Story / tháng,
 * ghi chi phí thực tế của từng job vào sổ chi phí của Story.
 */
import { providersConfig } from '../../shared/config'
import { checkBudget, formatUsdShort, storySpent } from '../../shared/logic/costEstimate'
import type { CostEntry, Job } from '../../shared/types'
import { logger } from '../logger'
import type { StoryRepository } from '../storage/storyRepo'
import { JobQueueImpl } from './jobQueue'

/** Tổng chi trong tháng hiện tại trên mọi Story (theo thời điểm ghi sổ) */
export async function monthSpent(repo: StoryRepository, now = new Date()): Promise<number> {
  const prefix = now.toISOString().slice(0, 7)
  let sum = 0
  const add = (entries: CostEntry[]): void => {
    for (const e of entries) if (e.timestamp.startsWith(prefix)) sum += e.cost
  }
  for (const s of await repo.listStories()) {
    const b = await repo.loadBundle(s.id)
    add(b.story.costs?.entries ?? [])
    for (const r of b.releases) add(r.costs.entries)
  }
  return sum
}

const KIND: Record<Job['type'], CostEntry['kind']> = {
  image: 'image',
  video: 'video',
  tts: 'tts',
  llm: 'llm',
  stt: 'stt',
  render: 'render',
  depthMap: 'image'
}

export function createAppQueue(opts: {
  repo: StoryRepository
  persistPath?: string
  concurrency: number
  getMonthlyBudget: () => number
  onCostRecorded?: (storyId: string) => void
}): JobQueueImpl {
  const q = providersConfig.queue
  return new JobQueueImpl({
    concurrency: opts.concurrency,
    maxConcurrency: q.maxConcurrency,
    providerLimits: {
      mock: providersConfig.image.mock.maxConcurrency,
      gemini: providersConfig.image.gemini.maxConcurrency,
      veo: providersConfig.video.veo.maxConcurrency,
      elevenlabs: providersConfig.tts.elevenlabs.maxConcurrency ?? 4,
      openai: providersConfig.tts.openai.maxConcurrency ?? 6
    },
    maxAttempts: q.maxAttempts,
    backoffBaseMs: q.backoffBaseMs,
    backoffMaxMs: q.backoffMaxMs,
    persistPath: opts.persistPath,
    budget: async (job, queue) => {
      if (job.estimatedCost <= 0) return { ok: true }
      if (job.storyId) {
        const b = await opts.repo.loadBundle(job.storyId)
        const spent = storySpent(b.story.costs, b.releases.map((r) => r.costs)) + queue.inFlightCost(job.storyId)
        const chk = checkBudget(spent, job.estimatedCost, b.story.budget.limitUsd)
        if (!chk.ok) {
          return { ok: false, reason: `Story "${b.story.name}" chạm ngân sách ${formatUsdShort(chk.limit)} (đã chi ${formatUsdShort(spent)}). Tăng ngân sách ở màn Story rồi bấm Tiếp tục.` }
        }
      }
      const monthly = opts.getMonthlyBudget()
      if (monthly > 0) {
        const spent = (await monthSpent(opts.repo)) + queue.inFlightCost(job.storyId)
        if (spent + job.estimatedCost > monthly) {
          return { ok: false, reason: `Chạm ngân sách tháng ${formatUsdShort(monthly)} (đã chi ${formatUsdShort(spent)}). Đổi ở Cài đặt rồi bấm Tiếp tục.` }
        }
      }
      return { ok: true }
    },
    onCost: async (job, cost) => {
      if (!job.storyId) {
        logger.info(`Chi phí ${formatUsdShort(cost)} cho "${job.label}" (không gắn Story)`, 'queue')
        return
      }
      await opts.repo.updateStory(job.storyId, (s) => {
        s.costs.actual += cost
        s.costs.entries.push({ provider: job.providerId, kind: KIND[job.type], units: 1, cost, timestamp: new Date().toISOString() })
      })
      opts.onCostRecorded?.(job.storyId)
    }
  })
}
