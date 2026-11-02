/**
 * XUẤT BẢN & KINH DOANH (GĐ5):
 *  - Gói xuất bản theo nền tảng (LLM) + mô tả YouTube đầy đủ + checklist tự kiểm
 *  - Thumbnail / ảnh bìa: nhanh (ảnh cảnh + chữ, miễn phí) hoặc AI (qua hàng đợi)
 *  - Shorts teaser 30–60s cắt từ bản YouTube (render 9:16, câu móc + thẻ kêu gọi xem bản dài)
 *  - Sổ hiệu quả (PerformanceNote) và sổ chi phí (báo cáo theo tháng, xuất CSV)
 * Không có tính năng đăng bài tự động (nguyên tắc 7) – chỉ chuẩn bị nội dung để người dùng tự đăng.
 */
import { renderFingerprint } from '../render/fingerprint'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildCompositionProps } from '../../shared/composition'
import { platformsConfig } from '../../shared/config'
import { buildCostReport, costCsv, type CostReport, type CostRow } from '../../shared/logic/business'
import { aiDisclosureNeeded, buildChecklist, buildYoutubeDescription, normalizeHashtags, normalizeTags, type ChecklistFacts } from '../../shared/logic/publishing'
import { CHARACTERS_FOLDER } from '../storage/storyRepo'
import { selectTeaserWindow, spoilerBeatIds } from '../../shared/logic/shorts'
import { resolveVoice } from '../../shared/logic/voices'
import { buildMediaUrl, toRelPath } from '../../shared/media'
import type { Library, MediaRef, PerformanceNote, PublishingPackage, Release, Story } from '../../shared/types'
import { tiktokPackTask, youtubePackTask, type PublishInput } from '../llm/tasks'
import { logger } from '../logger'
import { cutAudio } from '../media/ffmpeg'
import { composeThumbnail } from '../media/thumbnail'
import type { ProviderRegistry } from '../providers/registry'
import type { VideoRenderer } from '../render/protocol'
import type { StoryRepository } from '../storage/storyRepo'

export interface PublishDeps {
  repo: StoryRepository
  providers: ProviderRegistry
  renderer: VideoRenderer
  remotionEntry: string
  mediaBaseUrl: string
  getRenderScale: () => number
}

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

export class PublishService {
  constructor(private readonly d: PublishDeps) {}

  private get repo(): StoryRepository {
    return this.d.repo
  }

  private async ctx(storyId: string, releaseId: string): Promise<{ story: Story; release: Release; lib: Library }> {
    const [story, release, lib] = await Promise.all([this.repo.loadStory(storyId), this.repo.loadRelease(storyId, releaseId), this.repo.loadLibrary()])
    return { story, release, lib }
  }

  private emptyPackage(): PublishingPackage {
    return { aiDisclosureNeeded: true, checklist: [], thumbnails: [], selectedThumbnail: null, shorts: null, generatedAt: new Date().toISOString() }
  }

  // ======================================================================== Gói xuất bản

  async generatePackage(storyId: string, releaseId: string, signal?: AbortSignal): Promise<{ release: Release; cost: number }> {
    const { story, release, lib } = await this.ctx(storyId, releaseId)
    const llm = this.d.providers.llm()
    const folklore = lib.folklore.filter((f) => story.folkloreIds.includes(f.id))
    const input: PublishInput = {
      platform: release.platform,
      language: release.language,
      storyName: story.name,
      premiseVi: story.premiseVi,
      folkloreNames: folklore.map((f) => (release.language === 'en' ? f.nameEn : f.nameVi)),
      scriptExcerpt: release.script.lines.slice(0, 14).map((l) => l.text).join('\n').slice(0, 2500),
      partIndex: release.partIndex,
      partCount: release.partCount
    }
    const pkg: PublishingPackage = { ...this.emptyPackage(), ...(release.publishing ?? {}) }
    let cost = 0
    if (release.platform === 'tiktok') {
      const req = tiktokPackTask(input)
      req.signal = signal
      const r = await llm.generateJson(req)
      cost += r.cost
      const partLabel = release.partCount > 1 ? `Phần ${release.partIndex}/${release.partCount}` : ''
      let caption = r.data.captionVi.trim()
      if (partLabel && !caption.includes(partLabel)) caption = `${partLabel} · ${caption}`
      pkg.tiktok = { captionVi: caption, hashtags: normalizeHashtags(r.data.hashtags), coverConcepts: r.data.coverConcepts, partLabel }
    } else {
      const req = youtubePackTask(input)
      req.signal = signal
      const r = await llm.generateJson(req)
      cost += r.cost
      const glossary = lib.pronunciations.filter((p) => p.language === release.language)
      const desc = (intro: string, language: 'en' | 'vi'): string =>
        buildYoutubeDescription({ intro, chapters: release.chapters, glossary, folklore, fictionNote: story.fictionNoteVi, language })
      pkg.youtube = {
        titleOptions: r.data.titleOptions.map((t) => t.title),
        titleOptionsVi: r.data.titleOptions.map((t) => t.titleVi),
        description: desc(r.data.descriptionIntro, release.language),
        descriptionVi: desc(r.data.descriptionIntroVi, 'vi'),
        tags: normalizeTags(r.data.tags),
        thumbnailConcepts: r.data.thumbnailConcepts,
        shortsHook: r.data.shortsHook,
        shortsHookVi: r.data.shortsHookVi,
        shortsCta: r.data.shortsCta,
        shortsCtaVi: r.data.shortsCtaVi
      }
    }
    pkg.aiDisclosureNeeded = aiDisclosureNeeded(release)
    pkg.generatedAt = new Date().toISOString()
    const updated = await this.repo.updateRelease(storyId, releaseId, (rel) => {
      rel.publishing = pkg
      if (cost > 0) {
        rel.costs.actual += cost
        rel.costs.entries.push({ provider: llm.id, kind: 'llm', units: 1, cost, timestamp: new Date().toISOString() })
      }
    })
    await this.refreshChecklist(storyId, releaseId)
    return { release: await this.repo.loadRelease(storyId, releaseId).catch(() => updated), cost }
  }

  async updatePackage(storyId: string, releaseId: string, pkg: PublishingPackage): Promise<Release> {
    await this.repo.updateRelease(storyId, releaseId, (r) => {
      const prev = r.publishing ?? this.emptyPackage()
      // Không cho renderer đổi danh sách thumbnail / Shorts (chỉ chọn); checklist tay giữ trạng thái
      r.publishing = {
        ...prev,
        youtube: pkg.youtube ? { ...pkg.youtube, tags: normalizeTags(pkg.youtube.tags) } : prev.youtube,
        tiktok: pkg.tiktok ? { ...pkg.tiktok, hashtags: normalizeHashtags(pkg.tiktok.hashtags, 12) } : prev.tiktok,
        selectedThumbnail: pkg.selectedThumbnail && prev.thumbnails.some((t) => t.path === pkg.selectedThumbnail) ? pkg.selectedThumbnail : prev.selectedThumbnail,
        checklist: prev.checklist.map((c) => (c.auto ? c : { ...c, done: pkg.checklist.find((x) => x.id === c.id)?.done ?? c.done }))
      }
    })
    return this.refreshChecklist(storyId, releaseId)
  }

  // ======================================================================== Checklist

  async facts(story: Story, release: Release, lib: Library): Promise<ChecklistFacts> {
    const voices = [...new Set(release.script.lines.map((l) => resolveVoice(l.speakerId, release.language, lib, story.channelPresetId)))].filter(Boolean)
    const usedBank = new Set(release.scenes.map((s) => s.sceneBankId))
    const aspect = release.aspectRatio
    const mockMedia =
      voices.some((v) => v?.providerId === 'mock') ||
      story.sceneBank.some((b) => usedBank.has(b.id) && (b.media[aspect]?.provider === 'mock' || b.media['16:9']?.provider === 'mock')) ||
      release.scenes.some((s) => s.motion.level === 'aiVideo' && story.sceneBank.find((b) => b.id === s.sceneBankId)?.heroClip[aspect]?.provider === 'mock')
    const assets = new Map(lib.soundAssets.map((a) => [a.id, a]))
    const exportsDir = path.join(this.repo.releaseDir(story.id, release.id), 'exports')
    const files = (await fs.readdir(exportsDir).catch(() => [] as string[])).filter((f) => f.endsWith('.mp4') && !f.includes('_shorts_'))
    const p = release.publishing
    const partLabel = release.partCount > 1 ? `Phần ${release.partIndex}/${release.partCount}` : ''
    return {
      voicesAllLicensed: voices.length > 0 && voices.every((v) => v?.commercialLicenseConfirmed),
      usesMockMedia: mockMedia,
      soundAllLicensed: release.soundCues.every((c) => c.kind === 'silence' || assets.get(c.assetId ?? '')?.licenseConfirmed),
      hasRender: files.length > 0,
      renderStale: this.renderStale(story, release, lib, files),
      hasThumbnail: !!p?.selectedThumbnail,
      isSeries: release.partCount > 1,
      partLabelInCaption: !partLabel || !!p?.tiktok?.captionVi.includes(partLabel),
      fictionNoteInDescription: release.platform === 'tiktok' ? true : /fictional|hư cấu/i.test(p?.youtube?.description ?? ''),
      hasDescriptionOrCaption: !!(p?.youtube?.description || p?.tiktok?.captionVi)
    }
  }

  /** Bản render mới nhất có còn khớp nội dung hiện tại? (bản cũ chưa có lastRender ⇒ không kết luận được ⇒ coi như khớp) */
  renderStale(story: Story, release: Release, lib: Library, files: string[]): boolean {
    const lr = release.lastRender
    if (!lr || files.length === 0) return false
    if (!files.includes(path.basename(lr.path))) return true
    return renderFingerprint(story, release, lib) !== lr.fingerprint
  }

  async refreshChecklist(storyId: string, releaseId: string): Promise<Release> {
    const { story, release, lib } = await this.ctx(storyId, releaseId)
    const f = await this.facts(story, release, lib)
    return this.repo.updateRelease(storyId, releaseId, (r) => {
      r.publishing ??= this.emptyPackage()
      r.publishing.checklist = buildChecklist(f, r.publishing.checklist)
    })
  }

  // ======================================================================== Thumbnail

  /** Cảnh làm nền thumbnail mặc định: cảnh hero đầu tiên, nếu không có thì cảnh của beat căng nhất */
  pickThumbnailScene(story: Story, release: Release): string | null {
    const hero = release.scenes.find((s) => s.isHero)
    if (hero) return hero.sceneBankId
    const beats = new Map(story.outline.beats.map((b) => [b.id, b.emotionalIntensity]))
    const best = [...release.scenes].sort((a, b) => {
      const ia = beats.get(story.sceneBank.find((x) => x.id === a.sceneBankId)?.beatId ?? '') ?? 0
      const ib = beats.get(story.sceneBank.find((x) => x.id === b.sceneBankId)?.beatId ?? '') ?? 0
      return ib - ia
    })[0]
    return best?.sceneBankId ?? story.sceneBank[0]?.id ?? null
  }

  async quickThumbnail(storyId: string, releaseId: string, opts: { sceneBankId?: string; text?: string } = {}): Promise<Release> {
    const { story, release, lib } = await this.ctx(storyId, releaseId)
    const sceneId = opts.sceneBankId ?? this.pickThumbnailScene(story, release)
    const scene = story.sceneBank.find((s) => s.id === sceneId)
    const yt = release.platform === 'youtube'
    const aspect = yt ? '16:9' : '9:16'
    // Ưu tiên ảnh đúng khung; thiếu ảnh 9:16 riêng thì dùng ảnh 16:9 và cắt quanh focusPoint
    const own = scene?.media[aspect]
    const media = own ?? scene?.media['16:9']
    if (!scene || !media) throw new Error('Chưa có ảnh cảnh để làm thumbnail – chạy bước 6 trước')
    const concept = yt ? release.publishing?.youtube?.thumbnailConcepts[0] : release.publishing?.tiktok?.coverConcepts[0]
    const text = opts.text ?? concept?.text ?? story.name
    const folk = lib.folklore.find((f) => story.folkloreIds.includes(f.id))
    const ch = lib.channelPresets.find((c) => c.id === story.channelPresetId)
    const size = yt ? platformsConfig.publishing.thumbnail.youtube : platformsConfig.publishing.thumbnail.cover
    const dir = path.join(this.repo.releaseDir(storyId, releaseId), 'thumbs')
    await fs.mkdir(dir, { recursive: true })
    const file = `quick_${createHash('sha1').update(media.path + text + Date.now()).digest('hex').slice(0, 8)}.png`
    await composeThumbnail(
      this.repo.resolveInStory(storyId, media.path),
      path.join(dir, file),
      {
        ...size,
        text,
        sub: folk ? (release.language === 'en' ? folk.nameEn : folk.nameVi) : undefined,
        badge: release.partCount > 1 ? `PHẦN ${release.partIndex}/${release.partCount}` : undefined,
        layout: yt ? 'youtube' : 'cover',
        accent: ch?.palette[4]
      },
      // Ảnh 9:16 riêng đã bố cục cho khung dọc ⇒ cắt giữa; mọi trường hợp dùng ảnh 16:9 ⇒ cắt theo focusPoint
      own && aspect === '9:16' ? { x: 0.5, y: 0.5 } : scene.focusPoint
    )
    const ref: MediaRef = { path: toRelPath('releases', releaseId, 'thumbs', file), mediaType: 'image', source: 'own', provider: 'quick-thumbnail', model: `scene ${scene.id} + chữ`, cost: 0, createdAt: new Date().toISOString(), width: size.width, height: size.height }
    await this.repo.updateRelease(storyId, releaseId, (r) => {
      r.publishing ??= this.emptyPackage()
      r.publishing.thumbnails.unshift(ref)
      r.publishing.selectedThumbnail ??= ref.path
    })
    return this.refreshChecklist(storyId, releaseId)
  }

  // ======================================================================== Shorts teaser

  async cutShorts(storyId: string, releaseId: string, onProgress: (p: number, msg: string) => void = () => undefined, signal?: AbortSignal, range?: { start: number; end: number }): Promise<Release> {
    const { story, release, lib } = await this.ctx(storyId, releaseId)
    if (release.platform !== 'youtube') throw new Error('Shorts teaser chỉ cắt từ bản YouTube dài')
    const vt = release.voiceTrack
    if (!vt?.mixedPath || release.scenes.length === 0) throw new Error('Bản YouTube chưa có giọng/cảnh – chạy pipeline tới bước 19 trước')
    const sp = platformsConfig.publishing.shorts
    const beats = new Map(story.outline.beats.map((b) => [b.id, b.emotionalIntensity]))
    const kinds = new Map(release.script.sections.map((s) => [s.id, s.kind]))
    let win = range ? { start: range.start, end: range.end } : null
    if (!win) {
      // Không lộ cao trào: bỏ beat cao trào và các beat sau nó
      const spoilers = spoilerBeatIds(story.outline.beats)
      const timed = release.script.lines.filter((l) => l.start != null && l.end != null)
      // Giữ nguyên thứ tự câu (để kiểm tra liền mạch), câu lộ cao trào đánh dấu 'spoiler' ⇒ không được chọn
      const candidates = timed.map((l) => ({
        id: l.id,
        start: l.start as number,
        end: l.end as number,
        beatId: l.beatId,
        sectionKind: spoilers.has(l.beatId) ? 'spoiler' : (kinds.get(l.sectionId) ?? 'story')
      }))
      const pick = (minSec: number): ReturnType<typeof selectTeaserWindow> =>
        selectTeaserWindow(candidates, (b) => beats.get(b) ?? 0.5, { minSec, maxSec: sp.maxSec - sp.endCardSec })
      // Phần trước cao trào quá ngắn ⇒ chấp nhận teaser ngắn hơn (tối thiểu 15s) thay vì lộ cao trào
      const w = pick(sp.minSec - 2) ?? pick(15)
      if (!w) throw new Error('Không đủ nội dung trước cao trào để cắt teaser (cần ≥ 15 giây) – chọn đoạn thủ công hoặc bỏ qua Shorts')
      // Đệm 0,5s cuối nhưng không lấn sang câu kế tiếp
      const next = timed.find((l) => (l.start as number) >= w.end - 0.01)
      win = { start: Math.max(0, w.start - 0.3), end: Math.min(vt.duration, w.end + 0.5, next ? (next.start as number) : Infinity) }
    }
    const len = win.end - win.start
    if (len < 10 || len > 60) throw new Error('Đoạn teaser phải dài 10–60 giây')
    const yt = release.publishing?.youtube
    const en = release.language === 'en'
    const hook = yt?.shortsHook ?? (en ? 'Never answer when the river calls…' : 'Đừng trả lời khi sông gọi tên…')
    const cta = yt?.shortsCta ?? (en ? 'Full story on the channel' : 'Xem trọn truyện trên kênh')

    onProgress(0.05, 'Cắt audio teaser')
    const voiceRel = toRelPath('releases', releaseId, 'voice', 'teaser.wav')
    await cutAudio(this.repo.resolveInStory(storyId, vt.mixedPath), this.repo.resolveInStory(storyId, voiceRel), win.start, len, sp.endCardSec, signal)

    const ch = lib.channelPresets.find((c) => c.id === story.channelPresetId)
    const props = buildCompositionProps({
      story,
      release,
      glossary: lib.pronunciations.filter((p) => p.language === release.language),
      subtitleStyle: ch?.subtitleStyleByPlatform.youtubeShorts ?? platformsConfig.subtitleStyles.tiktok,
      mediaUrl: (rel, v) => buildMediaUrl(this.d.mediaBaseUrl, storyId, rel, v),
      sharedUrl: (rel, v) => buildMediaUrl(this.d.mediaBaseUrl, CHARACTERS_FOLDER, rel, v),
      puppetLib: lib,
      fps: platformsConfig.fps,
      sizes: platformsConfig.aspectSizes,
      aspect: '9:16',
      scale: this.d.getRenderScale(),
      parallaxFactors: platformsConfig.parallax.layerFactors,
      window: { start: win.start, end: win.end, voiceRelPath: voiceRel, hookText: hook, ctaTitle: cta, ctaSub: ch?.name.split('/').pop()?.trim() ?? '', hookCardSec: sp.hookCardSec, endCardSec: sp.endCardSec }
    })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    const file = `${storyId}_${releaseId}_shorts_teaser_${stamp}.mp4`
    const out = path.join(this.repo.releaseDir(storyId, releaseId), 'exports', file)
    await fs.mkdir(path.dirname(out), { recursive: true })
    logger.info(`Cắt Shorts teaser ${win.start.toFixed(1)}–${win.end.toFixed(1)}s (${len.toFixed(1)}s + thẻ kết) → ${file}`, releaseId)
    await this.d.renderer.render({ entryPoint: this.d.remotionEntry, inputProps: props, outputPath: out }, (p) => onProgress(0.1 + 0.9 * (p.stage === 'render' ? p.progress : 0), `Render teaser ${Math.round(p.progress * 100)}%`), signal)
    return this.repo.updateRelease(storyId, releaseId, (r) => {
      r.publishing ??= this.emptyPackage()
      r.publishing.shorts = { start: win.start, end: win.end, path: toRelPath('releases', releaseId, 'exports', file), hookText: hook, ctaText: cta, createdAt: new Date().toISOString() }
    })
  }

  // ======================================================================== Sổ hiệu quả

  async addPerformanceNote(storyId: string, note: Omit<PerformanceNote, 'id'>): Promise<Story> {
    if (!(note.views >= 0) || !(note.avgWatchPercent >= 0 && note.avgWatchPercent <= 100)) throw new Error('Số liệu không hợp lệ (lượt xem ≥ 0, % xem 0–100)')
    return this.repo.updateStory(storyId, (s) => {
      if (!s.releaseIds.includes(note.releaseId)) throw new Error('Bản phát hành không thuộc Story này')
      s.performanceNotes.push({ ...note, id: randomUUID() })
      s.performanceNotes.sort((a, b) => b.date.localeCompare(a.date))
    })
  }

  async deletePerformanceNote(storyId: string, noteId: string): Promise<Story> {
    return this.repo.updateStory(storyId, (s) => {
      s.performanceNotes = s.performanceNotes.filter((n) => n.id !== noteId)
    })
  }

  // ======================================================================== Sổ chi phí

  async costRows(): Promise<{ rows: CostRow[]; budgets: Record<string, number> }> {
    const rows: CostRow[] = []
    const budgets: Record<string, number> = {}
    for (const s of await this.repo.listStories()) {
      const b = await this.repo.loadBundle(s.id)
      budgets[s.id] = b.story.budget.limitUsd
      for (const e of b.story.costs?.entries ?? []) rows.push({ ...e, storyId: s.id, storyName: s.name, releaseId: null, releaseTitle: null })
      for (const r of b.releases) for (const e of r.costs.entries) rows.push({ ...e, storyId: s.id, storyName: s.name, releaseId: r.id, releaseTitle: r.title })
    }
    return { rows, budgets }
  }

  async costReport(month: string): Promise<CostReport> {
    const { rows, budgets } = await this.costRows()
    return buildCostReport(rows, month, budgets)
  }

  async exportCostCsv(month: string, outPath: string): Promise<string> {
    const r = await this.costReport(month)
    await fs.writeFile(outPath, costCsv(r.rows), 'utf8')
    return outPath
  }

  async exportsOf(storyId: string, releaseId: string): Promise<boolean> {
    return exists(path.join(this.repo.releaseDir(storyId, releaseId), 'exports'))
  }
}
