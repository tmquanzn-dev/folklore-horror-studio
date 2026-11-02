/**
 * Voice Studio: tạo lại TỪNG CÂU độc lập, chọn take, waveform nhỏ, so sánh trước/sau xử lý giọng, nghe thử giọng.
 * Mọi thay đổi giọng đánh dấu bước 12 trở đi là "Chờ" ⇒ chạy lại pipeline chỉ ghép lại (take khác dùng cache).
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { TtsPreviewInput, TtsPreviewResult } from '../../shared/ipc'
import { checkBudget, formatUsdShort, storySpent } from '../../shared/logic/costEstimate'
import { applyPronunciation } from '../../shared/logic/pronunciation'
import { resetStepsFrom } from '../../shared/pipeline'
import type { Release } from '../../shared/types'
import { readWav } from '../media/wav'
import { logger } from '../logger'
import type { ProviderRegistry } from '../providers/registry'
import type { StoryRepository } from '../storage/storyRepo'
import { fileExists, plannedTts, processTake, synthesizeLine, voiceForLine } from './voiceCore'

/** Biên độ đỉnh theo từng ô (0..1) – vẽ waveform nhỏ */
export function computePeaks(samples: Int16Array, buckets: number): number[] {
  const n = Math.max(1, buckets)
  const size = Math.max(1, Math.floor(samples.length / n))
  const out: number[] = []
  for (let b = 0; b < n; b++) {
    let max = 0
    const end = Math.min(samples.length, (b + 1) * size)
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > max) max = v
    }
    out.push(Math.round((max / 32768) * 1000) / 1000)
  }
  return out
}

export class VoiceService {
  constructor(
    private readonly repo: StoryRepository,
    private readonly providers: ProviderRegistry,
    private readonly previewDir: string
  ) {}

  private async load(storyId: string, releaseId: string) {
    const [story, release, library] = await Promise.all([
      this.repo.loadStory(storyId),
      this.repo.loadRelease(storyId, releaseId),
      this.repo.loadLibrary()
    ])
    return { story, release, library }
  }

  async regenerateLine(storyId: string, releaseId: string, lineId: string): Promise<Release> {
    const { story, release, library } = await this.load(storyId, releaseId)
    const line = release.script.lines.find((l) => l.id === lineId)
    if (!line) throw new Error(`Không tìm thấy câu ${lineId}`)
    const plan = plannedTts(story, release, line, library, this.providers)
    const estimate = plan.provider.estimateCost(plan.text.length)
    const bundle = await this.repo.loadBundle(storyId)
    const budget = checkBudget(storySpent(story.costs, bundle.releases.map((r) => r.costs)), estimate, story.budget.limitUsd)
    if (!budget.ok) throw new Error(`Vượt ngân sách Story (ước tính thêm ${formatUsdShort(estimate)}). Tăng ngân sách ở màn Story.`)

    const res = await synthesizeLine({
      repo: this.repo,
      providers: this.providers,
      story,
      release,
      line,
      library,
      // Mỗi lần bấm "Tạo lại" ⇒ một take mới (provider thật cho kết quả khác nhau)
      nonce: randomUUID()
    })
    line.selectedTakeId = res.take.id
    if (res.cost > 0) {
      release.costs.actual += res.cost
      release.costs.entries.push({ provider: res.provider, kind: 'tts', units: res.characters, cost: res.cost, timestamp: new Date().toISOString() })
    }
    resetStepsFrom(release.pipelineState, 12)
    await this.repo.saveRelease(release)
    logger.info(`Tạo lại câu ${line.id} (${res.provider})`, release.id)
    return release
  }

  async selectTake(storyId: string, releaseId: string, lineId: string, takeId: string): Promise<Release> {
    const release = await this.repo.loadRelease(storyId, releaseId)
    const line = release.script.lines.find((l) => l.id === lineId)
    if (!line?.takes.some((t) => t.id === takeId)) throw new Error('Take không tồn tại')
    line.selectedTakeId = takeId
    resetStepsFrom(release.pipelineState, 12)
    await this.repo.saveRelease(release)
    return release
  }

  async peaks(storyId: string, relPath: string, buckets = 48): Promise<number[]> {
    const abs = this.repo.resolveInStory(storyId, relPath)
    const wav = readWav(await fs.readFile(abs))
    if (wav.bitsPerSample !== 16) return []
    const samples = new Int16Array(wav.data.buffer, wav.data.byteOffset, Math.floor(wav.data.length / 2))
    return computePeaks(samples, buckets)
  }

  /** Trả về đường dẫn take gốc + take đã xử lý (để nghe so sánh trước/sau) */
  async processPreview(storyId: string, releaseId: string, lineId: string): Promise<{ rawPath: string; processedPath: string }> {
    const { story, release, library } = await this.load(storyId, releaseId)
    const line = release.script.lines.find((l) => l.id === lineId)
    const take = line?.takes.find((t) => t.id === line.selectedTakeId)
    if (!line || !take) throw new Error('Câu chưa có take – hãy tạo giọng trước')
    const voice = voiceForLine(story, release, line, library)
    const { rel } = await processTake(this.repo, storyId, take, voice.postProcessChain)
    return { rawPath: take.path, processedPath: rel }
  }

  /** Nghe thử một giọng với câu bất kỳ (từ điển phát âm, màn nhân vật). Trả về data URL để phát ngay. */
  async ttsPreview(input: TtsPreviewInput): Promise<TtsPreviewResult> {
    const library = await this.repo.loadLibrary()
    const voice = library.voiceProfiles.find((v) => v.id === input.voiceProfileId)
    if (!voice) throw new Error('Giọng không tồn tại')
    const provider = this.providers.tts(voice.providerId)
    const text = input.applyDictionary === false ? input.text : applyPronunciation(input.text, library.pronunciations, voice.language).text
    if (!text.trim()) throw new Error('Văn bản trống')
    const hash = createHash('sha1').update(JSON.stringify([text, voice, provider.id, provider.model])).digest('hex').slice(0, 14)
    await fs.mkdir(this.previewDir, { recursive: true })
    const abs = path.join(this.previewDir, `${hash}.wav`)
    let cost = 0
    if (!(await fileExists(abs))) {
      const res = await provider.synthesize({
        text,
        language: voice.language,
        voice,
        delivery: { tags: [], instructions: '', pace: 1, pauseBeforeMs: 0, pauseAfterMs: 0 },
        outputPath: abs
      })
      cost = res.cost
      if (cost > 0) logger.info(`Nghe thử giọng ${voice.name}: ~${formatUsdShort(cost)}`, 'tts')
    }
    const buf = await fs.readFile(abs)
    return { dataUrl: `data:audio/wav;base64,${buf.toString('base64')}`, sentText: text, cost, provider: provider.id }
  }
}
