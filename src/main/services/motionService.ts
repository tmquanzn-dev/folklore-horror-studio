/**
 * CHUYỂN ĐỘNG (GĐ4):
 *  - Mức 2 parallax 2.5D: depth map local (onnxruntime) → 3 lớp PNG; cache theo ảnh nguồn của từng khung.
 *  - Mức 3 video AI cho cảnh hero: báo giá trước, tạo qua hàng đợi (job "video"), lỗi ⇒ pipeline quay về Mức 1/2.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildVideoPrompt } from '../../shared/logic/imagePrompt'
import { charactersForStory } from '../../shared/logic/voices'
import { toRelPath } from '../../shared/media'
import type { AspectRatio, Job, MediaRef, ParallaxLayers, Story } from '../../shared/types'
import { logger } from '../logger'
import type { DepthEstimator } from '../media/depth'
import { buildParallaxLayers } from '../media/parallax'
import type { JobContext, JobQueue } from '../providers/interfaces'
import type { ProviderRegistry } from '../providers/registry'
import type { StoryRepository } from '../storage/storyRepo'

export interface VideoJobPayload {
  storyId: string
  sceneId: string
  aspect: AspectRatio
  providerId: string
  seconds: number
  nonce: string
}

const tag = (a: AspectRatio): string => a.replace(':', 'x')
const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

export interface HeroQuote {
  providerId: string
  seconds: number
  /** Cảnh cần tạo clip mới */
  needed: string[]
  /** Cảnh đã có clip đúng khung (dùng lại, không tốn phí) */
  reused: string[]
  cost: number
}

export class MotionService {
  constructor(
    private readonly repo: StoryRepository,
    private readonly providers: ProviderRegistry,
    private readonly queue: JobQueue,
    private readonly depth: DepthEstimator,
    private readonly onChanged: (storyId: string) => void = () => undefined
  ) {
    queue.register<VideoJobPayload, { path: string }>('video', (p, ctx) => this.runVideoJob(p, ctx))
  }

  // ======================================================================== Parallax

  /** Tách lớp parallax cho cảnh ở khung aspect (dùng lại nếu ảnh nguồn không đổi và file còn) */
  async computeParallax(storyId: string, sceneId: string, aspect: AspectRatio, force = false): Promise<ParallaxLayers> {
    const story = await this.repo.loadStory(storyId)
    const scene = story.sceneBank.find((s) => s.id === sceneId)
    const media = scene?.media[aspect]
    if (!scene || !media) throw new Error(`Cảnh ${sceneId} chưa có ảnh ${aspect}`)
    const cur = scene.parallax?.[aspect]
    if (!force && cur && cur.sourcePath === media.path && (await exists(this.repo.resolveInStory(storyId, cur.layers[0])))) return cur

    const h = createHash('sha1').update(media.path + media.createdAt).digest('hex').slice(0, 8)
    const base = `${scene.id}_${tag(aspect)}_${h}`
    const rel = (s: string): string => toRelPath('bank', 'parallax', `${base}_${s}.png`)
    const abs = (r: string): string => this.repo.resolveInStory(storyId, r)
    await fs.mkdir(path.join(this.repo.storyDir(storyId), 'bank', 'parallax'), { recursive: true })
    const layersRel: [string, string, string] = [rel('l0'), rel('l1'), rel('l2')]
    const res = await buildParallaxLayers(
      abs(media.path),
      { depth: abs(rel('depth')), layers: [abs(layersRel[0]), abs(layersRel[1]), abs(layersRel[2])] },
      this.depth,
      aspect === '16:9' ? scene.focusPoint : { x: 0.5, y: 0.5 }
    )
    const p: ParallaxLayers = { sourcePath: media.path, depthPath: rel('depth'), layers: layersRel, depthSource: res.source, createdAt: new Date().toISOString() }
    await this.repo.updateStory(storyId, (s) => {
      const sc = s.sceneBank.find((x) => x.id === sceneId)
      if (!sc) return
      sc.parallax = { ...(sc.parallax ?? {}), [aspect]: p }
      if (aspect === '16:9') sc.depthMapPath = p.depthPath
    })
    this.onChanged(storyId)
    return p
  }

  /** Bước 17: tính lớp cho danh sách cảnh; cảnh lỗi trả về để pipeline quay về Ken Burns */
  async ensureParallax(storyId: string, sceneIds: string[], aspect: AspectRatio, signal: AbortSignal, onProgress: (p: number) => void): Promise<{ failed: string[]; heuristic: number }> {
    const failed: string[] = []
    let heuristic = 0
    const uniq = [...new Set(sceneIds)]
    for (const [i, id] of uniq.entries()) {
      if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
      try {
        const p = await this.computeParallax(storyId, id, aspect)
        if (p.depthSource === 'heuristic') heuristic++
      } catch (err) {
        logger.warn(`Parallax cảnh ${id} lỗi: ${err instanceof Error ? err.message : String(err)} – dùng Ken Burns`, storyId)
        failed.push(id)
      }
      onProgress((i + 1) / uniq.length)
    }
    return { failed, heuristic }
  }

  // ======================================================================== Video AI (cảnh hero)

  async quote(story: Story, sceneBankIds: string[], aspect: AspectRatio, providerId?: string): Promise<HeroQuote> {
    const pid = providerId ?? this.providers.defaultVideoProvider()
    const provider = this.providers.video(pid)
    const needed: string[] = []
    const reused: string[] = []
    for (const id of [...new Set(sceneBankIds)]) {
      const clip = story.sceneBank.find((s) => s.id === id)?.heroClip[aspect]
      if (clip && (await exists(this.repo.resolveInStory(story.id, clip.path)))) reused.push(id)
      else needed.push(id)
    }
    return { providerId: provider.id, seconds: provider.clipSeconds, needed, reused, cost: provider.estimateCost(provider.clipSeconds) * needed.length }
  }

  enqueueClips(storyId: string, sceneBankIds: string[], aspect: AspectRatio, providerId: string, regenerate = false): Job[] {
    const provider = this.providers.video(providerId)
    return sceneBankIds.map((sceneId) =>
      this.queue.enqueue<VideoJobPayload>(
        'video',
        { storyId, sceneId, aspect, providerId: provider.id, seconds: provider.clipSeconds, nonce: regenerate ? randomUUID() : '' },
        {
          providerId: provider.id === 'mock' ? 'mock' : provider.id,
          estimatedCost: provider.estimateCost(provider.clipSeconds),
          storyId,
          label: `Video AI · cảnh ${sceneId} · ${aspect} · ${provider.clipSeconds}s`,
          cacheKey: regenerate ? null : `video:${storyId}:${sceneId}:${aspect}:${provider.id}:${provider.model}`
        }
      )
    )
  }

  /** Tạo clip cho các cảnh và chờ xong; trả về cảnh thành công / thất bại */
  async generateClips(storyId: string, sceneBankIds: string[], aspect: AspectRatio, providerId: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<{ ok: string[]; failed: { id: string; error: string }[] }> {
    const jobs = this.enqueueClips(storyId, sceneBankIds, aspect, providerId)
    const onAbort = (): void => jobs.forEach((j) => this.queue.cancel(j.id))
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      let n = 0
      const done = await Promise.all(
        jobs.map((j) =>
          this.queue.wait(j.id).then((r) => {
            onProgress(++n / jobs.length)
            return r
          })
        )
      )
      if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
      return {
        ok: done.filter((j) => j.status === 'done').map((j) => (j.payload as VideoJobPayload).sceneId),
        failed: done.filter((j) => j.status !== 'done').map((j) => ({ id: (j.payload as VideoJobPayload).sceneId, error: j.error ?? j.status }))
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async runVideoJob(p: VideoJobPayload, ctx: JobContext): Promise<{ result: { path: string }; cost: number }> {
    const story = await this.repo.loadStory(p.storyId)
    const lib = await this.repo.loadLibrary()
    const scene = story.sceneBank.find((s) => s.id === p.sceneId)
    const media = scene?.media[p.aspect]
    if (!scene || !media) throw new Error(`Cảnh ${p.sceneId} chưa có ảnh ${p.aspect}`)
    const channel = lib.channelPresets.find((c) => c.id === story.channelPresetId) ?? lib.channelPresets[0]
    const prompt = buildVideoPrompt(scene, { channel, folklore: lib.folklore.filter((f) => story.folkloreIds.includes(f.id)), characters: charactersForStory(story.id, lib.characters) }, p.seconds)
    const file = `${scene.id}_${tag(p.aspect)}_hero_${createHash('sha1').update(media.path + p.nonce + p.providerId).digest('hex').slice(0, 8)}.mp4`
    const abs = path.join(this.repo.storyDir(p.storyId), 'bank', file)
    ctx.progress(0.05)
    const provider = this.providers.video(p.providerId)
    const res = await provider.imageToVideo({ imagePath: this.repo.resolveInStory(p.storyId, media.path), prompt, aspect: p.aspect, durationSec: p.seconds, outputPath: abs, signal: ctx.signal })
    const ref: MediaRef = {
      path: toRelPath('bank', file),
      mediaType: 'video',
      source: 'ai',
      provider: res.provider,
      model: res.model,
      cost: res.cost,
      createdAt: new Date().toISOString(),
      durationSec: res.duration
    }
    await this.repo.updateStory(p.storyId, (s) => {
      const sc = s.sceneBank.find((x) => x.id === p.sceneId)
      if (sc) sc.heroClip[p.aspect] = ref
    })
    this.onChanged(p.storyId)
    return { result: { path: ref.path }, cost: res.cost }
  }
}
