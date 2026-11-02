/**
 * Thao tác cấp STORY (pipeline A, bước 1–5):
 *  1. Tạo Story  2. LLM dàn ý  3. ★ Duyệt dàn ý  3a. LLM đề xuất dàn nhân vật  4. LLM đề xuất ngân hàng cảnh
 * Mỗi lần gọi LLM: ước tính chi phí trước, chặn nếu vượt ngân sách Story, ghi chi phí thực tế vào sổ của Story.
 * (3b character sheet, 3c duyệt/khoá nhân vật bằng ảnh – Giai đoạn 3)
 */
import { randomBytes } from 'node:crypto'
import { platformsConfig } from '../../shared/config'
import type { LibraryPatch, NewReleaseInput, NewStoryInput, StoryPatch } from '../../shared/ipc'
import { checkBudget, formatUsdShort, storySpent } from '../../shared/logic/costEstimate'
import { charactersForStory, suggestVoiceId } from '../../shared/logic/voices'
import { applyCastRemap, beatEditImpact, clearSceneMedia, reachedStep, remapCast } from '../../shared/logic/invalidation'
import { resetStepsFrom } from '../../shared/pipeline'
import { CHANNEL_NARRATOR_ID } from '../../shared/sampleData'
import { emptyLedger } from '../../shared/sampleData'
import type { Library, Release, Story } from '../../shared/types'
import { castTask, outlineTask, sceneBankTask, slug, toBeats, toCharacters, toSceneBank } from '../llm/tasks'
import { logger } from '../logger'
import type { LlmJsonRequest, LlmProvider } from '../providers/interfaces'
import type { StoryRepository } from '../storage/storyRepo'
import { channelOf, estimateTaskCost, platformDefaultsOf } from './scriptService'

export class StoryService {
  constructor(
    private readonly repo: StoryRepository,
    private readonly llm: () => LlmProvider,
    /** Pipeline đang chạy? (app: hỏi PipelineRunner) */
    private readonly isRunning: (storyId: string, releaseId: string) => boolean = () => false
  ) {}

  /** Thay dữ liệu dùng chung khi pipeline đang chạy ⇒ release đang chạy dùng dữ liệu nửa cũ nửa mới */
  private assertIdle(storyId: string, releases: Release[], what: string): void {
    // Hỏi runner đang sống (không tin cờ running trên đĩa – app tắt đột ngột có thể để lại cờ cũ)
    const busy = releases.find((r) => this.isRunning(storyId, r.id))
    if (busy) throw new Error(`Bản "${busy.title}" đang chạy pipeline – hãy Huỷ ở AutoEdit trước khi ${what}`)
  }

  /**
   * Đặt lại các bản phát hành sau khi dữ liệu dùng chung đổi: chạy mutate, rồi đưa các bước ≥ fromStep về "Chờ"
   * (chỉ với release đã chạy tới bước đó). Trả về tên các release bị ảnh hưởng.
   */
  private async invalidateReleases(storyId: string, releases: Release[], fromStep: number, reason: string, mutate?: (r: Release) => boolean): Promise<string[]> {
    const touched: string[] = []
    for (const r of releases) {
      let changed = false
      await this.repo.updateRelease(storyId, r.id, (rel) => {
        if (mutate?.(rel)) changed = true
        if (reachedStep(rel, fromStep) && resetStepsFrom(rel.pipelineState, fromStep)) changed = true
      })
      if (changed) touched.push(r.title)
    }
    if (touched.length) logger.warn(`${reason} ⇒ ${touched.length} bản phát hành chạy lại từ bước ${fromStep}: ${touched.join(', ')}`, storyId)
    return touched
  }

  /** Ước tính chi phí + chặn khi vượt ngân sách Story; chạy LLM; ghi chi phí vào story.costs */
  private async runStoryLlm<T>(story: Story, req: LlmJsonRequest<T>, expectedOutputChars: number): Promise<T> {
    const llm = this.llm()
    const estimate = estimateTaskCost(llm.id, req as LlmJsonRequest<unknown>, expectedOutputChars)
    const releases = (await this.repo.loadBundle(story.id)).releases
    const budget = checkBudget(storySpent(story.costs, releases.map((r) => r.costs)), estimate, story.budget.limitUsd)
    if (!budget.ok) {
      throw new Error(
        `Vượt ngân sách Story: đã chi ${formatUsdShort(budget.spent)} + ước tính ${formatUsdShort(estimate)} > ${formatUsdShort(budget.limit)}. Cách xử lý: tăng ngân sách ở màn Story hoặc bật Chế độ Mock.`
      )
    }
    logger.info(`LLM ${req.task} (${llm.id}) – ước tính ${formatUsdShort(estimate)}`, story.id)
    const res = await llm.generateJson(req)
    story.costs ??= emptyLedger(story.budget.limitUsd)
    story.costs.estimated += estimate
    if (res.cost > 0) {
      story.costs.actual += res.cost
      story.costs.entries.push({ provider: llm.id, kind: 'llm', units: res.inputTokens + res.outputTokens, cost: res.cost, timestamp: new Date().toISOString() })
    }
    return res.data
  }

  async createStory(input: NewStoryInput): Promise<Story> {
    const lib = await this.repo.loadLibrary()
    if (!lib.channelPresets.some((c) => c.id === input.channelPresetId)) throw new Error('Kênh không tồn tại')
    if (!input.name.trim()) throw new Error('Hãy nhập tên Story')
    if (input.premiseVi.trim().length < 20) throw new Error('Ý tưởng gốc quá ngắn (tối thiểu 20 ký tự)')
    const now = new Date().toISOString()
    const id = `story-${slug(input.name)}-${randomBytes(2).toString('hex')}`
    const story: Story = {
      id,
      name: input.name.trim(),
      channelPresetId: input.channelPresetId,
      folkloreIds: input.folkloreIds,
      premiseVi: input.premiseVi.trim(),
      fictionNoteVi: '',
      outline: { beats: [], approval: { status: 'pending' } },
      characterIds: lib.characters.filter((c) => c.scope === 'channel').map((c) => c.id),
      sceneBank: [],
      releaseIds: [],
      status: 'draft',
      budget: { limitUsd: Math.max(0, input.budgetUsd) },
      performanceNotes: [],
      costs: emptyLedger(input.budgetUsd),
      createdAt: now,
      updatedAt: now
    }
    await this.repo.ensureStoryFolders(story)
    await this.repo.saveStory(story)
    logger.info(`Tạo Story mới "${story.name}"`, story.id)
    return story
  }

  async updateStory(storyId: string, patch: StoryPatch): Promise<Story> {
    const { story, releases } = await this.repo.loadBundle(storyId)
    const oldBeats = story.outline.beats
    if (patch.name !== undefined) story.name = patch.name.trim() || story.name
    if (patch.premiseVi !== undefined) story.premiseVi = patch.premiseVi
    if (patch.fictionNoteVi !== undefined) story.fictionNoteVi = patch.fictionNoteVi
    if (patch.budgetUsd !== undefined) {
      if (!(patch.budgetUsd >= 0)) throw new Error('Ngân sách phải ≥ 0')
      story.budget.limitUsd = patch.budgetUsd
      story.costs.budgetLimit = patch.budgetUsd
    }
    if (patch.status !== undefined) story.status = patch.status
    if (patch.beats !== undefined) {
      // Sửa dàn ý ⇒ cần duyệt lại
      story.outline.beats = patch.beats.map((b, i) => ({ ...b, order: i + 1, emotionalIntensity: Math.min(1, Math.max(0, b.emotionalIntensity)) }))
      story.outline.approval = { status: 'pending' }
    }
    if (patch.sceneBank !== undefined) story.sceneBank = patch.sceneBank
    // Sửa beat ⇒ khớp cảnh / cảnh hero / chuyển động / âm thanh của release dựa trên beat phải tính lại
    const impact = patch.beats !== undefined ? beatEditImpact(oldBeats, story.outline.beats, releases, story.sceneBank) : null
    if (impact?.resetFrom != null) this.assertIdle(storyId, releases, 'sửa dàn ý')
    await this.repo.saveStory(story)
    if (impact?.resetFrom != null) {
      const what = impact.removed.length || impact.added.length || impact.reordered ? 'Thêm/xoá/đổi thứ tự beat' : 'Đổi cường độ cảm xúc beat'
      await this.invalidateReleases(storyId, releases, impact.resetFrom, what)
      if (impact.orphanLines) logger.warn(`${impact.orphanLines} câu kịch bản thuộc beat đã xoá – nên "Chuyển thể lại" ở Script Editor`, storyId)
      if (impact.orphanScenes) logger.warn(`${impact.orphanScenes} cảnh trong ngân hàng thuộc beat đã xoá – sẽ không được gán`, storyId)
      if (impact.added.length) logger.warn(`Beat mới ${impact.added.join(', ')} chưa có cảnh – đề xuất lại ngân hàng cảnh hoặc thêm cảnh`, storyId)
    }
    return story
  }

  /**
   * Bước 2 – (tạo lại) dàn ý. Id beat tất định (b1…bn) ⇒ ngân hàng cảnh và kịch bản cũ vẫn "khớp id" nhưng sai nội dung
   * ⇒ tạo lại dàn ý = bỏ ngân hàng cảnh + kịch bản/cảnh/giọng của mọi release (file media vẫn còn trên đĩa làm cache).
   */
  async generateOutline(storyId: string): Promise<Story> {
    const { story, releases } = await this.repo.loadBundle(storyId)
    this.assertIdle(storyId, releases, 'tạo lại dàn ý')
    const lib = await this.repo.loadLibrary()
    const folklore = lib.folklore.filter((f) => story.folkloreIds.includes(f.id))
    const out = await this.runStoryLlm(story, outlineTask(story, folklore), 4000)
    const hadBank = story.sceneBank.length
    story.outline = { beats: toBeats(out), approval: { status: 'pending' } }
    story.fictionNoteVi = out.fictionNoteVi
    story.sceneBank = []
    await this.repo.saveStory(story)
    if (hadBank) logger.warn(`Dàn ý mới ⇒ bỏ ngân hàng cảnh cũ (${hadBank} cảnh) – duyệt dàn ý rồi đề xuất lại ngân hàng cảnh`, story.id)
    await this.invalidateReleases(storyId, releases, 6, 'Dàn ý mới', (r) => {
      if (!r.script.lines.length && !r.scenes.length) return false
      r.script = { sections: [], lines: [] }
      r.scenes = []
      r.voiceTrack = null
      r.subtitles = []
      r.chapters = []
      r.soundCues = []
      return true
    })
    logger.info(`Đã tạo dàn ý ${story.outline.beats.length} beat – chờ duyệt`, story.id)
    return story
  }

  async approveOutline(storyId: string): Promise<Story> {
    const story = await this.repo.loadStory(storyId)
    if (story.outline.beats.length === 0) throw new Error('Chưa có dàn ý để duyệt')
    story.outline.approval = { status: 'approved', at: new Date().toISOString() }
    await this.repo.saveStory(story)
    logger.info('★ Đã duyệt dàn ý', story.id)
    return story
  }

  /** 3a – LLM đề xuất dàn nhân vật; giữ nguyên nhân vật đã khoá, thay nhân vật chưa khoá */
  async proposeCast(storyId: string): Promise<{ story: Story; library: Library }> {
    const { story, releases } = await this.repo.loadBundle(storyId)
    if (story.outline.approval.status !== 'approved') throw new Error('Hãy duyệt dàn ý trước khi đề xuất nhân vật')
    this.assertIdle(storyId, releases, 'đề xuất lại nhân vật')
    const lib = await this.repo.loadLibrary()
    const folklore = lib.folklore.filter((f) => story.folkloreIds.includes(f.id))
    const channelChars = lib.characters.filter((c) => c.scope === 'channel')
    const out = await this.runStoryLlm(story, castTask(story, folklore, channelChars), 5000)
    const keep = lib.characters.filter((c) => !(c.scope === 'story' && c.storyId === storyId && !c.locked))
    const created = toCharacters(out, storyId, new Set(keep.map((c) => c.id)))
    // Gợi ý giọng riêng cho từng nhân vật (câu thoại không dùng giọng người kể)
    const channel = channelOf(lib, story)
    for (const c of created) {
      for (const lang of ['vi', 'en'] as const) {
        const id = suggestVoiceId(c, lib.voiceProfiles, lang, new Set([channel.defaultVoiceByLanguage[lang]]))
        if (id) c.voiceProfileIdByLanguage[lang] = id
      }
      if (!c.voiceProfileIdByLanguage.vi && !c.voiceProfileIdByLanguage.en) {
        logger.warn(`Chưa tìm được giọng phù hợp cho "${c.name}" – hãy chọn ở Voice Studio / màn Nhân vật`, story.id)
      }
    }
    // Nhân vật cũ bị thay ⇒ ánh xạ sang nhân vật mới cùng vai (theo thứ tự); cảnh có cast đổi phải vẽ lại,
    // câu thoại của nhân vật cũ chuyển sang nhân vật mới (không còn ai cùng vai ⇒ người kể đọc)
    const removed = lib.characters.filter((c) => c.scope === 'story' && c.storyId === storyId && !c.locked)
    const map = remapCast(removed, created)
    const { bank, changedScenes } = applyCastRemap(story.sceneBank, map)
    const redraw = new Set(changedScenes)
    story.sceneBank = bank.map((s) => (redraw.has(s.id) ? clearSceneMedia(s) : s))
    lib.characters = [...keep, ...created]
    story.characterIds = charactersForStory(storyId, lib.characters).map((c) => c.id)
    await this.repo.saveLibrary(lib)
    await this.repo.saveStory(story)
    if (map.size) {
      for (const [from, to] of map) logger.info(`Nhân vật ${from} → ${to ?? 'người kể (không còn nhân vật cùng vai)'}`, story.id)
      if (redraw.size) logger.warn(`${redraw.size} cảnh có nhân vật đổi ⇒ xoá ảnh cũ, tạo lại ở bước 6`, story.id)
      const respeak = (r: Release): boolean => {
        let changed = false
        for (const l of r.script.lines) {
          if (map.has(l.speakerId)) {
            l.speakerId = map.get(l.speakerId) ?? CHANNEL_NARRATOR_ID
            changed = true
          }
        }
        return changed
      }
      // Cảnh vẽ lại ⇒ từ bước 6; chỉ đổi người nói ⇒ từ bước 11 (tạo giọng)
      await this.invalidateReleases(storyId, releases, redraw.size ? 6 : 11, 'Đề xuất lại nhân vật', respeak)
    }
    logger.info(`Đề xuất ${created.length} nhân vật (character sheet + duyệt/khoá ảnh – Giai đoạn 3)`, story.id)
    return { story, library: lib }
  }

  /** Bước 4 – LLM đề xuất ngân hàng cảnh theo beat (thay toàn bộ ngân hàng hiện có) */
  async proposeSceneBank(storyId: string): Promise<Story> {
    const { story, releases } = await this.repo.loadBundle(storyId)
    if (story.outline.approval.status !== 'approved') throw new Error('Hãy duyệt dàn ý trước khi đề xuất ngân hàng cảnh')
    this.assertIdle(storyId, releases, 'đề xuất lại ngân hàng cảnh')
    const lib = await this.repo.loadLibrary()
    const chars = charactersForStory(storyId, lib.characters)
    const out = await this.runStoryLlm(story, sceneBankTask(story, chars, channelOf(lib, story)), 9000)
    story.sceneBank = toSceneBank(out)
    await this.repo.saveStory(story)
    logger.info(`Đề xuất ${story.sceneBank.length} cảnh – ảnh tạo ở bước 6 của pipeline Release`, story.id)
    // Id cảnh tất định (s01…) ⇒ release cũ vẫn "trỏ được" nhưng tới cảnh KHÁC, chưa có ảnh ⇒ bỏ cảnh đã gán, chạy lại từ bước 6
    await this.invalidateReleases(storyId, releases, 6, 'Ngân hàng cảnh mới', (r) => {
      if (!r.scenes.length) return false
      r.scenes = []
      return true
    })
    return story
  }

  async createRelease(storyId: string, input: NewReleaseInput): Promise<Release> {
    const story = await this.repo.loadStory(storyId)
    const lib = await this.repo.loadLibrary()
    const channel = channelOf(lib, story)
    const pd = platformDefaultsOf(channel, { platform: input.platform })
    const now = new Date().toISOString()
    const isSeries = pd.partDurationSec != null
    const label = `${pd.label} · ${input.language.toUpperCase()} · ${story.name}`
    let id = `rel-${input.platform === 'youtubeShorts' ? 'sh' : input.platform === 'youtube' ? 'yt' : 'tt'}-${input.language}`
    while (story.releaseIds.some((r) => r === id || r.startsWith(`${id}-p`))) id = `${id}-${randomBytes(1).toString('hex')}`
    const release: Release = {
      id,
      storyId,
      title: isSeries ? `${label} – Phần 1` : label,
      platform: input.platform,
      language: input.language,
      aspectRatio: pd.aspectRatio,
      targetDuration: isSeries ? (pd.partDurationSec ?? 90) : Math.max(60, input.targetDurationSec),
      seriesGroupId: isSeries ? `series-${id}` : null,
      partIndex: 1,
      partCount: isSeries ? Math.min(10, Math.max(1, input.plannedParts)) : 1,
      heroRatio: pd.heroRatio,
      script: { sections: [], lines: [] },
      voiceTrack: null,
      scenes: [],
      chapters: [],
      subtitles: [],
      soundCues: [],
      publishing: null,
      costs: emptyLedger(story.budget.limitUsd),
      pipelineState: null,
      createdAt: now,
      updatedAt: now
    }
    story.releaseIds.push(release.id)
    // Trạng thái kinh doanh: có bản TikTok ⇒ "đang thử"; thêm bản YouTube tiếng Anh sau TikTok ⇒ "đã chuyển thể"
    const existing = (await this.repo.loadBundle(storyId)).releases
    if (input.platform === 'youtube' && input.language === 'en' && existing.some((r) => r.platform === 'tiktok')) story.status = 'adapted'
    else if (input.platform === 'tiktok' && story.status === 'draft') story.status = 'testing'
    await this.repo.ensureStoryFolders(story)
    await this.repo.saveRelease(release)
    await this.repo.saveStory(story)
    logger.info(`Thêm bản phát hành ${release.title} (kịch bản sẽ chuyển thể ở bước 8)`, storyId)
    return release
  }

  async updateLibrary(patch: LibraryPatch): Promise<Library> {
    const lib = await this.repo.loadLibrary()
    const unique = <T extends { id: string }>(arr: T[], what: string): T[] => {
      const seen = new Set<string>()
      for (const x of arr) {
        if (!x.id.trim()) throw new Error(`${what}: có mục chưa có id`)
        if (seen.has(x.id)) throw new Error(`${what}: trùng id "${x.id}"`)
        seen.add(x.id)
      }
      return arr
    }
    if (patch.folklore) lib.folklore = unique(patch.folklore, 'Truyền thuyết')
    if (patch.pronunciations) lib.pronunciations = unique(patch.pronunciations, 'Từ điển phát âm')
    if (patch.voiceProfiles) lib.voiceProfiles = unique(patch.voiceProfiles, 'Giọng')
    if (patch.characters) lib.characters = unique(patch.characters, 'Nhân vật')
    if (patch.channelPresets) lib.channelPresets = unique(patch.channelPresets, 'Kênh')
    if (patch.soundAssets) lib.soundAssets = unique(patch.soundAssets, 'Âm thanh')
    await this.repo.saveLibrary(lib)
    return lib
  }
}

export const DEFAULT_TARGET_SEC = platformsConfig.platforms.youtube.targetDurationSec.min
