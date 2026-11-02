/**
 * SERVICE ẢNH (GĐ3) – mọi lần tạo ảnh đều đi qua hàng đợi job (1–20 luồng).
 *  - Ảnh cảnh 16:9 / 9:16 riêng: prompt = artStyle + culturalVisualBible + cảnh + nhân vật + thực thể (+ ảnh tham chiếu nhân vật đã khoá)
 *  - Character sheet (chính diện → 3/4, nghiêng, toàn thân dùng chính diện làm tham chiếu), bảng biểu cảm, ảnh trạng thái
 *  - AUTO DL bật: kết quả áp ngay vào cảnh (ảnh cũ thành biến thể); tắt: lưu thành biến thể chờ chọn
 *  - Kiểm tra đồng nhất bằng LLM nhìn ảnh; xuất ZIP theo độ phân giải
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { providersConfig } from '../../shared/config'
import { checkBudget, formatUsdShort, storySpent } from '../../shared/logic/costEstimate'
import {
  buildCharacterViewPrompt,
  buildExpressionPrompt,
  buildScenePrompt,
  buildStatePrompt,
  MAX_CLEAR_FACES,
  pickReferences,
  SHEET_VIEW_ASPECT,
  SHEET_VIEW_LABEL,
  SHEET_VIEWS,
  type PromptContext,
  type SheetView
} from '../../shared/logic/imagePrompt'
import { charactersForStory } from '../../shared/logic/voices'
import { toRelPath } from '../../shared/media'
import type { AspectRatio, Character, ImageAspect, Job, Library, MediaRef, SceneBankItem, Story } from '../../shared/types'
import { consistencyTask, slug } from '../llm/tasks'
import { logger } from '../logger'
import { createZip, type ZipEntry } from '../media/zip'
import type { JobContext, JobQueue } from '../providers/interfaces'
import type { ProviderRegistry } from '../providers/registry'
import type { StoryRepository } from '../storage/storyRepo'

export type ImageJobPayload =
  | { kind: 'scene'; storyId: string; sceneId: string; aspect: AspectRatio; providerId: string; autoApply: boolean; nonce: string }
  | { kind: 'sheet'; characterId: string; view: SheetView; providerId: string; storyId: string | null; nonce: string }
  | { kind: 'expression'; characterId: string; expression: string; providerId: string; storyId: string | null; nonce: string }
  | { kind: 'state'; characterId: string; stateId: string; providerId: string; storyId: string | null; nonce: string }
  | {
      kind: 'thumbnail'
      storyId: string
      releaseId: string
      aspect: '16:9' | '9:16'
      visual: string
      text: string
      sub: string
      badge: string
      providerId: string
      nonce: string
    }

export interface ImageJobResult {
  /** Tương đối thư mục Story (cảnh) hoặc thư mục _characters (nhân vật) */
  path: string
  kind: ImageJobPayload['kind']
  storyId: string | null
  targetId: string
}

export interface SceneGenOptions {
  providerId?: string
  regenerate?: boolean
  autoApply?: boolean
}

const MAX_VARIANTS_PER_ASPECT = 6
const aspectTag = (a: ImageAspect): string => a.replace(':', 'x')
const hash = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12)

export class ImageService {
  constructor(
    private readonly repo: StoryRepository,
    private readonly providers: ProviderRegistry,
    private readonly queue: JobQueue,
    private readonly getAutoApply: () => boolean = () => true,
    /** Báo UI tải lại dữ liệu (storyId null = thư viện nhân vật) */
    private readonly onChanged: (storyId: string | null) => void = () => undefined
  ) {
    queue.register<ImageJobPayload, ImageJobResult>('image', (p, ctx) => this.runJob(p, ctx))
  }

  private async promptContext(story: Story | null, lib: Library): Promise<PromptContext> {
    const channel = lib.channelPresets.find((c) => c.id === story?.channelPresetId) ?? lib.channelPresets[0]
    if (!channel) throw new Error('Chưa có kênh (ChannelPreset)')
    return {
      channel,
      folklore: lib.folklore.filter((f) => !story || story.folkloreIds.includes(f.id)),
      characters: story ? charactersForStory(story.id, lib.characters) : lib.characters
    }
  }

  private priceOf(providerId: string): number {
    return this.providers.image(providerId).estimateCost(1)
  }

  private resolveProvider(providerId?: string): string {
    return this.providers.isMock() ? 'mock' : (providerId ?? this.providers.defaultImageProvider())
  }

  /** Mtime + kích thước ảnh tham chiếu ⇒ đổi ảnh tham chiếu thì cache không còn khớp */
  private async refFingerprint(paths: string[]): Promise<string[]> {
    return Promise.all(
      paths.map(async (p) => {
        const st = await fs.stat(p).catch(() => null)
        return `${path.basename(p)}:${st?.size ?? 0}:${st?.mtimeMs ?? 0}`
      })
    )
  }

  // ======================================================================== Ảnh cảnh

  private async scenePlan(story: Story, lib: Library, scene: SceneBankItem, aspect: AspectRatio, providerId: string, nonce: string) {
    const ctx = await this.promptContext(story, lib)
    const { prompt, negativePrompt } = buildScenePrompt(scene, ctx, aspect)
    const max = providersConfig.image.gemini.maxReferenceImages ?? 4
    const refs = pickReferences(scene, ctx.characters, max).map((r) => this.repo.resolveCharacterPath(r.path))
    const model = this.providers.image(providerId).model
    const cacheKey = `image:${hash({ prompt, refs: await this.refFingerprint(refs), model, aspect, nonce })}`
    return { ctx, prompt, negativePrompt, refs, cacheKey }
  }

  async generateScenes(storyId: string, sceneIds: string[], aspect: AspectRatio, opts: SceneGenOptions = {}): Promise<Job[]> {
    const story = await this.repo.loadStory(storyId)
    const lib = await this.repo.loadLibrary()
    const providerId = this.resolveProvider(opts.providerId)
    const autoApply = opts.autoApply ?? this.getAutoApply()
    const jobs: Job[] = []
    for (const id of sceneIds) {
      const scene = story.sceneBank.find((s) => s.id === id)
      if (!scene) continue
      const nonce = opts.regenerate ? randomUUID() : ''
      const plan = await this.scenePlan(story, lib, scene, aspect, providerId, nonce)
      const n = story.sceneBank.indexOf(scene) + 1
      const job = this.queue.enqueue<ImageJobPayload>(
        'image',
        { kind: 'scene', storyId, sceneId: id, aspect, providerId, autoApply, nonce },
        { providerId, estimatedCost: this.priceOf(providerId), cacheKey: plan.cacheKey, storyId, label: `Cảnh ${n} · ${aspect} · ${scene.description.slice(0, 50)}` }
      )
      // Trúng cache (đã tạo đúng ảnh này trước đó) ⇒ áp lại ngay, không tốn phí
      if (job.status === 'done' && job.result) await this.applySceneResult(job.result as ImageJobResult, aspect, autoApply, providerId)
      jobs.push(job)
    }
    return jobs
  }

  private async applySceneResult(r: ImageJobResult, aspect: AspectRatio, autoApply: boolean, providerId: string): Promise<void> {
    const abs = this.repo.resolveInStory(r.storyId as string, r.path)
    const meta = await sharp(await fs.readFile(abs)).metadata().catch(() => ({ width: undefined, height: undefined }))
    const provider = this.providers.image(providerId)
    const ref: MediaRef = {
      path: r.path,
      mediaType: 'image',
      source: 'ai',
      provider: provider.id,
      model: provider.model,
      cost: provider.estimateCost(1),
      createdAt: new Date().toISOString(),
      width: meta.width,
      height: meta.height
    }
    await this.repo.updateStory(r.storyId as string, (s) => {
      const scene = s.sceneBank.find((x) => x.id === r.targetId)
      if (!scene) return
      if (scene.media[aspect]?.path === r.path) return
      if (autoApply) {
        const old = scene.media[aspect]
        if (old && old.provider !== 'focus-crop') scene.variants.unshift({ id: randomUUID(), aspect, media: old, note: 'ảnh trước' })
        scene.media[aspect] = ref
        // Ảnh 16:9 đổi ⇒ bản 9:16 cắt tự động cũ không còn đúng, để pipeline cắt lại
        if (aspect === '16:9' && scene.media['9:16']?.provider === 'focus-crop') scene.media['9:16'] = null
        scene.approval = { status: 'pending' }
        scene.consistency = null
      } else {
        if (!scene.variants.some((v) => v.media.path === r.path)) scene.variants.unshift({ id: randomUUID(), aspect, media: ref, note: 'mới – chờ chọn' })
      }
      const same = scene.variants.filter((v) => v.aspect === aspect)
      for (const v of same.slice(MAX_VARIANTS_PER_ASPECT)) scene.variants.splice(scene.variants.indexOf(v), 1)
    })
    this.onChanged(r.storyId)
  }

  /** Pipeline bước 6: tạo ảnh 16:9 còn thiếu cho mọi cảnh, chờ xong, báo tiến độ */
  async ensureSceneImages(storyId: string, signal: AbortSignal, onProgress: (p: number, msg: string) => void): Promise<{ created: number; reused: number }> {
    const story = await this.repo.loadStory(storyId)
    if (story.sceneBank.length === 0) throw new Error('Ngân hàng cảnh trống. Cách xử lý: bấm "Đề xuất ngân hàng cảnh" ở màn Story.')
    const missing: string[] = []
    for (const s of story.sceneBank) {
      const m = s.media['16:9']
      const ok = m ? await fs.access(this.repo.resolveInStory(storyId, m.path)).then(() => true, () => false) : false
      if (!ok) missing.push(s.id)
    }
    if (missing.length === 0) return { created: 0, reused: story.sceneBank.length }
    const providerId = this.resolveProvider()
    const estimate = missing.length * this.priceOf(providerId)
    const bundle = await this.repo.loadBundle(storyId)
    const b = checkBudget(storySpent(story.costs, bundle.releases.map((r) => r.costs)), estimate, story.budget.limitUsd)
    if (!b.ok) throw new Error(`Vượt ngân sách Story: ước tính ảnh ${formatUsdShort(estimate)} (${missing.length} ảnh). Cách xử lý: tăng ngân sách hoặc bật Chế độ Mock.`)
    logger.info(`Tạo ${missing.length} ảnh cảnh 16:9 (${providerId}) – ước tính ${formatUsdShort(estimate)}`, storyId)

    const jobs = await this.generateScenes(storyId, missing, '16:9', { providerId, autoApply: true })
    const onAbort = (): void => jobs.forEach((j) => this.queue.cancel(j.id))
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      let finished = 0
      const results = await Promise.all(
        jobs.map((j) =>
          this.queue.wait(j.id).then((r) => {
            finished++
            onProgress(finished / jobs.length, `Ảnh cảnh ${finished}/${jobs.length}`)
            return r
          })
        )
      )
      if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
      const failed = results.filter((r) => r.status !== 'done')
      if (failed.length) throw new Error(`${failed.length} ảnh lỗi: ${failed[0].error ?? ''}. Xem Film Studio → Hàng chờ để thử lại.`)
      return { created: missing.length, reused: story.sceneBank.length - missing.length }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  // ======================================================================== Ảnh nhân vật

  async generateCharacter(
    characterId: string,
    what: 'sheet' | 'expressions' | 'states',
    opts: { providerId?: string; regenerate?: boolean; storyId?: string | null } = {}
  ): Promise<Job[]> {
    const lib = await this.repo.loadLibrary()
    const c = lib.characters.find((x) => x.id === characterId)
    if (!c) throw new Error('Không tìm thấy nhân vật')
    const providerId = this.resolveProvider(opts.providerId)
    const storyId = c.storyId ?? opts.storyId ?? null
    const nonce = (): string => (opts.regenerate ? randomUUID() : '')
    const est = this.priceOf(providerId)
    const enqueue = (payload: ImageJobPayload, label: string, key: string): Job =>
      this.queue.enqueue<ImageJobPayload>('image', payload, { providerId, estimatedCost: est, cacheKey: key, storyId, label })

    if (what === 'sheet') {
      if (c.locked) throw new Error(`"${c.name}" đã khoá – mở khoá ở màn Nhân vật nếu muốn tạo lại character sheet`)
      const n = nonce()
      const front = enqueue({ kind: 'sheet', characterId, view: 'front', providerId, storyId, nonce: n }, `${c.name} · chính diện`, `sheet:${hash([c, 'front', providerId, n])}`)
      // Các góc còn lại dùng ảnh chính diện làm tham chiếu ⇒ chạy sau khi chính diện xong
      void this.queue.wait(front.id).then((j) => {
        if (j.status !== 'done') return
        for (const view of SHEET_VIEWS.filter((v) => v !== 'front')) {
          enqueue({ kind: 'sheet', characterId, view, providerId, storyId, nonce: n }, `${c.name} · ${SHEET_VIEW_LABEL[view]}`, `sheet:${hash([c, view, providerId, n, (j.result as ImageJobResult | null)?.path])}`)
        }
      })
      return [front]
    }
    if (!c.characterSheet.front) throw new Error(`Hãy tạo character sheet (ảnh chính diện) cho "${c.name}" trước`)
    if (what === 'expressions') {
      if (c.expressionSheet.length === 0) throw new Error('Nhân vật chưa có biểu cảm nào trong bảng biểu cảm')
      return c.expressionSheet
        .filter((e) => opts.regenerate || !e.imagePath)
        .map((e) => {
          const n = nonce()
          return enqueue({ kind: 'expression', characterId, expression: e.expression, providerId, storyId, nonce: n }, `${c.name} · biểu cảm "${e.expression}"`, `expr:${hash([c.characterSheet.front, c.appearance, e.expression, providerId, n])}`)
        })
    }
    if (c.states.length === 0) throw new Error('Nhân vật chưa có trạng thái ngoại hình nào')
    return c.states
      .filter((s) => opts.regenerate || !s.referenceImage)
      .map((s) => {
        const n = nonce()
        return enqueue({ kind: 'state', characterId, stateId: s.id, providerId, storyId, nonce: n }, `${c.name} · trạng thái "${s.name}"`, `state:${hash([c.characterSheet.front, c.appearance, s, providerId, n])}`)
      })
  }

  // ======================================================================== Handler job

  /** Thumbnail / ảnh bìa bằng AI: ảnh nền theo ý tưởng (không chữ) + app ghép chữ to */
  async generateThumbnail(storyId: string, releaseId: string, concept: { text: string; visual: string }, opts: { aspect: '16:9' | '9:16'; sub: string; badge: string; providerId?: string }): Promise<Job> {
    const providerId = this.resolveProvider(opts.providerId)
    const nonce = randomUUID()
    return this.queue.enqueue<ImageJobPayload>(
      'image',
      { kind: 'thumbnail', storyId, releaseId, aspect: opts.aspect, visual: concept.visual, text: concept.text, sub: opts.sub, badge: opts.badge, providerId, nonce },
      { providerId, estimatedCost: this.priceOf(providerId), storyId, label: `Thumbnail AI · "${concept.text}"`, cacheKey: null }
    )
  }

  private async runThumbnail(p: Extract<ImageJobPayload, { kind: 'thumbnail' }>, ctx: JobContext): Promise<{ result: ImageJobResult; cost: number }> {
    const story = await this.repo.loadStory(p.storyId)
    const lib = await this.repo.loadLibrary()
    const pc = await this.promptContext(story, lib)
    const prompt = [
      `Art style: ${pc.channel.artStyle}.`,
      `Setting: Vietnamese folk-horror, ${pc.channel.culturalVisualBible.slice(0, 5).join('; ')}.`,
      `Thumbnail image: ${p.visual}. One strong focal subject, high contrast, dramatic rim light, ${p.aspect === '16:9' ? 'subject on the right third, dark empty space on the left for a title' : 'subject in the upper half, dark empty space in the lower half for a title'}.`,
      'Absolutely no text, letters or logos. No gore, no blood.',
      `Avoid: ${pc.channel.negativePrompt}.`
    ].join(' ')
    const dir = path.join(this.repo.releaseDir(p.storyId, p.releaseId), 'thumbs')
    await fs.mkdir(dir, { recursive: true })
    const base = path.join(dir, `ai_base_${p.nonce.slice(0, 8)}.png`)
    ctx.progress(0.1)
    const res = await this.providers.image(p.providerId).generate({
      prompt,
      negativePrompt: pc.channel.negativePrompt,
      aspect: p.aspect,
      outputPath: base,
      referenceImagePaths: [],
      placeholder: { title: 'THUMBNAIL', index: 0, shotType: 'thumbnail', cameraAngle: p.aspect, summary: p.visual, focusPoint: { x: p.aspect === '16:9' ? 0.7 : 0.5, y: 0.35 }, palette: pc.channel.palette },
      signal: ctx.signal
    })
    const { composeThumbnail } = await import('../media/thumbnail')
    const { platformsConfig } = await import('../../shared/config')
    const size = p.aspect === '16:9' ? platformsConfig.publishing.thumbnail.youtube : platformsConfig.publishing.thumbnail.cover
    const file = `ai_${p.nonce.slice(0, 8)}.png`
    await composeThumbnail(base, path.join(dir, file), { ...size, text: p.text, sub: p.sub, badge: p.badge, layout: p.aspect === '16:9' ? 'youtube' : 'cover', accent: pc.channel.palette[4] })
    const rel = toRelPath('releases', p.releaseId, 'thumbs', file)
    await this.repo.updateRelease(p.storyId, p.releaseId, (r) => {
      if (!r.publishing) return
      r.publishing.thumbnails.unshift({ path: rel, mediaType: 'image', source: 'ai', provider: res.provider, model: res.model, cost: res.cost, createdAt: new Date().toISOString(), width: size.width, height: size.height })
      r.publishing.selectedThumbnail ??= rel
    })
    this.onChanged(p.storyId)
    return { result: { path: rel, kind: 'thumbnail', storyId: p.storyId, targetId: p.releaseId }, cost: res.cost }
  }

  private async runJob(p: ImageJobPayload, ctx: JobContext): Promise<{ result: ImageJobResult; cost: number }> {
    if (p.kind === 'thumbnail') return this.runThumbnail(p, ctx)
    const lib = await this.repo.loadLibrary()
    const provider = this.providers.image(p.providerId)

    if (p.kind === 'scene') {
      const story = await this.repo.loadStory(p.storyId)
      const scene = story.sceneBank.find((s) => s.id === p.sceneId)
      if (!scene) throw new Error(`Cảnh ${p.sceneId} không còn tồn tại`)
      const plan = await this.scenePlan(story, lib, scene, p.aspect, p.providerId, p.nonce)
      const file = `${scene.id}_${aspectTag(p.aspect)}_${plan.cacheKey.slice(-8)}.png`
      const abs = path.join(this.repo.storyDir(p.storyId), 'bank', file)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      ctx.progress(0.1)
      const castLabel = scene.cast
        .map((m) => {
          const c = plan.ctx.characters.find((x) => x.id === m.characterId)
          const st = c?.states.find((s) => s.id === m.stateId)
          return `${c?.name ?? m.characterId}${[m.expression, st?.name].filter(Boolean).length ? ` (${[m.expression, st?.name].filter(Boolean).join(', ')})` : ''}`
        })
        .join(' · ')
      const res = await provider.generate({
        prompt: plan.prompt,
        negativePrompt: plan.negativePrompt,
        aspect: p.aspect,
        outputPath: abs,
        referenceImagePaths: plan.refs,
        seed: story.sceneBank.indexOf(scene) + 1 + (p.nonce ? Date.now() % 997 : 0),
        placeholder: {
          index: story.sceneBank.indexOf(scene) + 1,
          shotType: scene.shotType,
          cameraAngle: scene.cameraAngle,
          summary: scene.description,
          castLabel: castLabel + (plan.refs.length ? ` · ${plan.refs.length} ảnh tham chiếu` : ''),
          focusPoint: scene.focusPoint,
          palette: plan.ctx.channel.palette
        },
        signal: ctx.signal
      })
      const result: ImageJobResult = { path: toRelPath('bank', file), kind: 'scene', storyId: p.storyId, targetId: p.sceneId }
      await this.applySceneResult(result, p.aspect, p.autoApply, p.providerId)
      return { result, cost: res.cost }
    }

    // ----- nhân vật
    const c = lib.characters.find((x) => x.id === p.characterId)
    if (!c) throw new Error('Nhân vật không còn tồn tại')
    const story = p.storyId ? await this.repo.loadStory(p.storyId).catch(() => null) : null
    const pctx = await this.promptContext(story, lib)
    const dir = path.join(this.repo.charactersRoot, c.id)
    await fs.mkdir(dir, { recursive: true })
    const front = c.characterSheet.front ? this.repo.resolveCharacterPath(c.characterSheet.front) : null

    let prompt: string
    let aspect: ImageAspect = '1:1'
    let refs: string[] = []
    let title: string
    let name: string
    if (p.kind === 'sheet') {
      prompt = buildCharacterViewPrompt(c, p.view, pctx)
      aspect = SHEET_VIEW_ASPECT[p.view]
      refs = p.view !== 'front' && front ? [front] : []
      title = `${c.name} · ${SHEET_VIEW_LABEL[p.view]}`
      name = p.view
    } else if (p.kind === 'expression') {
      prompt = buildExpressionPrompt(c, p.expression, pctx)
      refs = front ? [front] : []
      title = `${c.name} · ${p.expression}`
      name = `expr-${slug(p.expression)}`
    } else {
      const st = c.states.find((s) => s.id === p.stateId)
      if (!st) throw new Error('Trạng thái không còn tồn tại')
      prompt = buildStatePrompt(c, p.stateId, pctx)
      aspect = '9:16'
      refs = front ? [front] : []
      title = `${c.name} · ${st.name}`
      name = `state-${slug(st.name)}`
    }
    const file = `${name}_${hash([prompt, p.nonce, refs.length]).slice(0, 8)}.png`
    const abs = path.join(dir, file)
    ctx.progress(0.1)
    const res = await provider.generate({
      prompt,
      negativePrompt: pctx.channel.negativePrompt,
      aspect,
      outputPath: abs,
      referenceImagePaths: refs,
      placeholder: {
        title,
        index: 0,
        shotType: p.kind === 'sheet' ? SHEET_VIEW_LABEL[p.view] : p.kind === 'expression' ? 'biểu cảm' : 'trạng thái',
        cameraAngle: c.role === 'entity' ? 'thực thể' : `${c.age ?? '?'} tuổi`,
        summary: `${c.appearance} ${c.defaultOutfit}`,
        castLabel: p.kind === 'expression' ? p.expression : undefined,
        focusPoint: { x: 0.5, y: 0.45 },
        palette: pctx.channel.palette
      },
      signal: ctx.signal
    })
    const rel = `${c.id}/${file}`
    await this.repo.updateLibrary((l) => {
      const ch = l.characters.find((x) => x.id === c.id)
      if (!ch) return
      if (p.kind === 'sheet') {
        const old = ch.characterSheet[p.view]
        if (old && !ch.referenceImages.includes(old)) ch.referenceImages.unshift(old)
        ch.referenceImages = ch.referenceImages.slice(0, 12)
        ch.characterSheet[p.view] = rel
      } else if (p.kind === 'expression') {
        const e = ch.expressionSheet.find((x) => x.expression === p.expression)
        if (e) e.imagePath = rel
      } else {
        const st = ch.states.find((x) => x.id === p.stateId)
        if (st) st.referenceImage = rel
      }
    })
    this.onChanged(null)
    return { result: { path: rel, kind: p.kind, storyId: p.storyId, targetId: c.id }, cost: res.cost }
  }

  // ======================================================================== Sửa cảnh / biến thể

  async updateScene(storyId: string, sceneId: string, patch: Partial<Pick<SceneBankItem, 'imagePrompt' | 'description' | 'focusPoint' | 'cast' | 'approval' | 'shotType' | 'cameraAngle' | 'needsVerticalVersion'>>): Promise<Story> {
    if (patch.cast) {
      const lib = await this.repo.loadLibrary()
      const faces = patch.cast.filter((m) => {
        const c = lib.characters.find((x) => x.id === m.characterId)
        return c && c.role !== 'entity' && m.position !== 'background'
      }).length
      if (faces > MAX_CLEAR_FACES) throw new Error(`Tối đa ${MAX_CLEAR_FACES} nhân vật rõ mặt trong một cảnh (để giữ đồng nhất) – đặt bớt nhân vật ở vị trí "hậu cảnh"`)
    }
    return this.repo.updateStory(storyId, (s) => {
      const scene = s.sceneBank.find((x) => x.id === sceneId)
      if (!scene) throw new Error('Không tìm thấy cảnh')
      if (patch.focusPoint) {
        patch.focusPoint = { x: Math.min(1, Math.max(0, patch.focusPoint.x)), y: Math.min(1, Math.max(0, patch.focusPoint.y)) }
        // Đổi focusPoint ⇒ bản cắt dọc tự động phải cắt lại
        if (scene.media['9:16']?.provider === 'focus-crop') scene.media['9:16'] = null
      }
      if (patch.cast) scene.expression = patch.cast[0]?.expression ?? ''
      Object.assign(scene, patch)
      if (patch.approval) scene.approval = { ...patch.approval, at: new Date().toISOString() }
    })
  }

  async applyVariant(storyId: string, sceneId: string, variantId: string): Promise<Story> {
    return this.repo.updateStory(storyId, (s) => {
      const scene = s.sceneBank.find((x) => x.id === sceneId)
      const v = scene?.variants.find((x) => x.id === variantId)
      if (!scene || !v) throw new Error('Không tìm thấy biến thể')
      const aspect = v.aspect as AspectRatio
      const cur = scene.media[aspect]
      scene.variants = scene.variants.filter((x) => x.id !== variantId)
      if (cur && cur.provider !== 'focus-crop') scene.variants.unshift({ id: randomUUID(), aspect, media: cur, note: 'ảnh trước' })
      scene.media[aspect] = v.media
      if (aspect === '16:9' && scene.media['9:16']?.provider === 'focus-crop') scene.media['9:16'] = null
      scene.approval = { status: 'pending' }
      scene.consistency = null
    })
  }

  // ======================================================================== Kiểm tra đồng nhất

  private async imageB64(abs: string, size: number): Promise<string> {
    const buf = await sharp(await fs.readFile(abs)).resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
    return buf.toString('base64')
  }

  async checkConsistency(storyId: string, sceneIds: string[]): Promise<Story> {
    const story = await this.repo.loadStory(storyId)
    const lib = await this.repo.loadLibrary()
    const llm = this.providers.llm()
    for (const id of sceneIds) {
      const scene = story.sceneBank.find((s) => s.id === id)
      const media = scene?.media['16:9'] ?? scene?.media['9:16']
      if (!scene || !media) continue
      const members = scene.cast
        .map((m) => ({ m, c: lib.characters.find((x) => x.id === m.characterId) }))
        .filter((x): x is { m: SceneBankItem['cast'][number]; c: Character } => !!x.c && x.c.role !== 'entity' && !!x.c.characterSheet.front)
      let result: { ok: boolean; issues: string[] }
      if (members.length === 0) {
        result = { ok: true, issues: [] }
      } else {
        const images = [{ mimeType: 'image/jpeg', base64: await this.imageB64(this.repo.resolveInStory(storyId, media.path), 768), label: 'SCENE' }]
        for (const { m, c } of members) {
          images.push({ mimeType: 'image/jpeg', base64: await this.imageB64(this.repo.resolveCharacterPath(c.characterSheet.front as string), 512), label: `REFERENCE ${c.name}` })
          const st = c.states.find((s) => s.id === m.stateId)
          if (st?.referenceImage) images.push({ mimeType: 'image/jpeg', base64: await this.imageB64(this.repo.resolveCharacterPath(st.referenceImage), 512), label: `REFERENCE ${c.name} – state ${st.name}` })
        }
        const res = await llm.generateJson(
          consistencyTask(
            scene.description,
            members.map(({ m, c }) => ({ name: c.name, appearance: c.appearance, outfit: c.defaultOutfit, state: c.states.find((s) => s.id === m.stateId)?.name ?? '' })),
            images
          )
        )
        if (res.cost > 0) {
          await this.repo.updateStory(storyId, (s) => {
            s.costs.actual += res.cost
            s.costs.entries.push({ provider: llm.id, kind: 'llm', units: res.inputTokens + res.outputTokens, cost: res.cost, timestamp: new Date().toISOString() })
          })
        }
        result = { ok: res.data.ok && res.data.issues.length === 0, issues: res.data.issues.map((i) => `${i.characterName}: ${i.problem}`) }
      }
      await this.repo.updateStory(storyId, (s) => {
        const sc = s.sceneBank.find((x) => x.id === id)
        if (sc) sc.consistency = { checkedAt: new Date().toISOString(), ok: result.ok, issues: result.issues, characterIds: members.map((x) => x.c.id), provider: llm.id }
      })
    }
    return this.repo.loadStory(storyId)
  }

  // ======================================================================== Xuất ZIP

  async exportZip(storyId: string, outPath: string, maxEdge: number | null): Promise<{ path: string; files: number; bytes: number }> {
    const story = await this.repo.loadStory(storyId)
    const lib = await this.repo.loadLibrary()
    const entries: ZipEntry[] = []
    const add = async (abs: string, name: string): Promise<void> => {
      const raw = await fs.readFile(abs).catch(() => null)
      if (!raw) return
      const data = maxEdge ? await sharp(raw).resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true }).png().toBuffer() : raw
      entries.push({ name, data })
    }
    for (const [i, s] of story.sceneBank.entries()) {
      for (const a of ['16:9', '9:16'] as const) {
        const m = s.media[a]
        if (m) await add(this.repo.resolveInStory(storyId, m.path), `canh/${String(i + 1).padStart(2, '0')}_${s.id}_${aspectTag(a)}.png`)
      }
    }
    for (const c of charactersForStory(storyId, lib.characters)) {
      const folder = `nhan-vat/${slug(c.name)}`
      for (const v of SHEET_VIEWS) if (c.characterSheet[v]) await add(this.repo.resolveCharacterPath(c.characterSheet[v] as string), `${folder}/${v}.png`)
      for (const e of c.expressionSheet) if (e.imagePath) await add(this.repo.resolveCharacterPath(e.imagePath), `${folder}/bieu-cam_${slug(e.expression)}.png`)
      for (const s of c.states) if (s.referenceImage) await add(this.repo.resolveCharacterPath(s.referenceImage), `${folder}/trang-thai_${slug(s.name)}.png`)
    }
    if (entries.length === 0) throw new Error('Chưa có ảnh nào để xuất')
    const zip = createZip(entries)
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, zip)
    logger.info(`Đã xuất ${entries.length} ảnh → ${outPath}`, storyId)
    return { path: outPath, files: entries.length, bytes: zip.length }
  }
}
