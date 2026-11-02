/**
 * Giọng tự thu (GĐ6): nhập 1 file đọc cả bài → chép lời (Whisper / Mock) → căn mốc từng câu, từng từ
 * với kịch bản → dựng voice track (xử lý theo chuỗi của người kể, không reverb).
 *
 * Các hàm "*Into" sửa trực tiếp object Release được truyền vào – pipeline (bước 11, 12) dùng ctx.release,
 * IPC dùng bản sao rồi ghi kết quả bằng repo.updateRelease (không giữ khoá file trong lúc gọi API dài).
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { alignTranscript } from '../../shared/logic/align'
import { toRelPath } from '../../shared/media'
import type { Library, Release, Story } from '../../shared/types'
import { CHANNEL_NARRATOR_ID } from '../../shared/sampleData'
import { logger } from '../logger'
import { buildVoiceFilter, probeDuration, runFfmpeg } from '../media/ffmpeg'
import type { ProviderRegistry } from '../providers/registry'
import type { StoryRepository } from '../storage/storyRepo'
import { voiceForLine } from './voiceCore'

export const RECORDING_EXTS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm']

async function sha1File(abs: string): Promise<string> {
  return createHash('sha1').update(await fs.readFile(abs)).digest('hex')
}

/** Gợi ý chính tả cho Whisper: tên nhân vật + thuật ngữ trong từ điển + tên truyền thuyết */
export function whisperPrompt(story: Story, release: Release, lib: Library): string {
  const names = lib.characters.filter((c) => c.storyId === story.id || c.scope === 'channel').map((c) => c.name)
  const terms = lib.pronunciations.filter((p) => p.language === release.language).map((p) => p.term)
  const folk = lib.folklore.filter((f) => story.folkloreIds.includes(f.id)).map((f) => (release.language === 'en' ? f.nameEn : f.nameVi))
  return [...new Set([...folk, ...names, ...terms])].join(', ')
}

export class RecordingService {
  constructor(
    private readonly repo: StoryRepository,
    private readonly providers: ProviderRegistry
  ) {}

  // -------------------------------------------------------------- nhập file

  async importRecording(storyId: string, releaseId: string, srcAbs: string): Promise<Release> {
    const ext = path.extname(srcAbs).slice(1).toLowerCase()
    if (!RECORDING_EXTS.includes(ext)) throw new Error(`Định dạng .${ext} chưa hỗ trợ – dùng ${RECORDING_EXTS.join(', ')}`)
    const duration = await probeDuration(srcAbs).catch(() => {
      throw new Error('Không đọc được file âm thanh (hỏng hoặc không phải audio)')
    })
    if (duration < 3) throw new Error('File tự thu quá ngắn (< 3 giây)')
    const rel = toRelPath('releases', releaseId, 'voice', `recording.${ext}`)
    const abs = this.repo.resolveInStory(storyId, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.copyFile(srcAbs, abs)
    const hash = await sha1File(abs)
    logger.info(`Nhập giọng tự thu ${path.basename(srcAbs)} (${duration.toFixed(1)}s)`, releaseId)
    return this.repo.updateRelease(storyId, releaseId, (r) => {
      const keep = r.recording?.transcript?.forHash === hash ? r.recording.transcript : null
      r.recording = { path: rel, originalName: path.basename(srcAbs), importedAt: new Date().toISOString(), duration, hash, transcript: keep, coverage: keep ? r.recording?.coverage ?? null : null, extraWords: null }
      r.voiceSource = 'recorded'
    })
  }

  async setSource(storyId: string, releaseId: string, source: 'tts' | 'recorded'): Promise<Release> {
    return this.repo.updateRelease(storyId, releaseId, (r) => {
      r.voiceSource = source
    })
  }

  // -------------------------------------------------------------- chép lời + căn mốc

  estimate(release: Release): number {
    const rec = release.recording
    if (!rec || rec.transcript?.forHash === rec.hash) return 0
    return this.providers.stt().estimateCost(rec.duration)
  }

  /**
   * Chép lời (nếu chưa có cho đúng file này) rồi căn mốc. Sửa trực tiếp release; trả về chi phí phát sinh.
   */
  async transcribeAndAlignInto(story: Story, release: Release, lib: Library, signal?: AbortSignal, force = false): Promise<{ cost: number; coverage: number; extraWords: number; lowLines: number }> {
    const rec = release.recording
    if (!rec) throw new Error('Chưa nhập file tự thu – Voice Studio → "Nhập file tự thu"')
    let cost = 0
    if (force || !rec.transcript || rec.transcript.forHash !== rec.hash || rec.transcript.words.length === 0) {
      const stt = this.providers.stt()
      const t = await stt.transcribe(this.repo.resolveInStory(story.id, rec.path), release.language, {
        signal,
        prompt: whisperPrompt(story, release, lib),
        expectedText: release.script.lines.map((l) => l.text).join(' '),
        expectedLines: release.script.lines.map((l) => l.text)
      })
      cost = t.cost
      rec.transcript = { provider: stt.id, model: stt.model, language: t.language, text: t.text, words: t.words, forHash: rec.hash, cost: t.cost, createdAt: new Date().toISOString() }
      if (cost > 0) {
        release.costs.actual += cost
        release.costs.entries.push({ provider: stt.id, kind: 'stt', units: Math.round(rec.duration), cost, timestamp: new Date().toISOString() })
      }
      logger.info(`Chép lời ${rec.transcript.words.length} từ (${stt.id})`, release.id)
    }
    const a = alignTranscript(
      release.script.lines.map((l) => ({ id: l.id, text: l.text })),
      rec.transcript!.words,
      rec.duration
    )
    const byId = new Map(a.lines.map((l) => [l.id, l]))
    for (const line of release.script.lines) {
      const al = byId.get(line.id)
      if (!al) continue
      line.start = al.start
      line.end = al.end
      line.wordTimings = al.words
      line.alignConfidence = al.confidence
    }
    rec.coverage = a.coverage
    rec.extraWords = a.extraWords
    const lowLines = a.lines.filter((l) => l.confidence < 0.6).length
    return { cost, coverage: a.coverage, extraWords: a.extraWords, lowLines }
  }

  /** Bản dùng cho IPC: làm trên bản sao, ghi kết quả vào đĩa */
  async transcribeAndAlign(storyId: string, releaseId: string, force = false): Promise<{ release: Release; cost: number; coverage: number; lowLines: number }> {
    const [story, release, lib] = await Promise.all([this.repo.loadStory(storyId), this.repo.loadRelease(storyId, releaseId), this.repo.loadLibrary()])
    const r = await this.transcribeAndAlignInto(story, release, lib, undefined, force)
    const saved = await this.repo.updateRelease(storyId, releaseId, (x) => {
      if (x.recording?.hash !== release.recording?.hash) throw new Error('File tự thu vừa bị thay – chạy lại "Chép lời & căn mốc"')
      x.recording = release.recording
      const byId = new Map(release.script.lines.map((l) => [l.id, l]))
      for (const line of x.script.lines) {
        const src = byId.get(line.id)
        if (!src) continue
        line.start = src.start
        line.end = src.end
        line.wordTimings = src.wordTimings
        line.alignConfidence = src.alignConfidence
      }
      if (r.cost > 0) {
        x.costs.actual += r.cost
        x.costs.entries.push(release.costs.entries[release.costs.entries.length - 1])
      }
    })
    return { release: saved, cost: r.cost, coverage: r.coverage, lowLines: r.lowLines }
  }

  // -------------------------------------------------------------- voice track

  /**
   * Bước 12 (nguồn tự thu): lọc/nén theo chuỗi xử lý của người kể (bỏ reverb – phòng thu thật đã có tiếng phòng),
   * chuẩn về WAV 44.1 kHz mono ⇒ voice_processed.wav. Mốc câu đã có từ bước căn mốc.
   */
  async buildRecordedTrackInto(story: Story, release: Release, lib: Library, signal?: AbortSignal): Promise<string> {
    const rec = release.recording
    if (!rec) throw new Error('Chưa nhập file tự thu')
    if (release.script.lines.some((l) => l.start == null || l.end == null)) throw new Error('Chưa căn mốc giọng tự thu – chạy bước 11')
    const narratorLine = release.script.lines.find((l) => l.speakerId === CHANNEL_NARRATOR_ID) ?? release.script.lines[0]
    const chain = { ...voiceForLine(story, release, narratorLine, lib).postProcessChain, reverbAmount: 0 }
    const rel = toRelPath('releases', release.id, 'voice', 'voice_processed.wav')
    const out = this.repo.resolveInStory(story.id, rel)
    await fs.mkdir(path.dirname(out), { recursive: true })
    await runFfmpeg(['-i', this.repo.resolveInStory(story.id, rec.path), '-af', buildVoiceFilter(chain), '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], signal)
    const duration = await probeDuration(out)
    release.voiceTrack = { mode: 'recorded', processedPath: rel, mixedPath: rel, duration }
    return rel
  }
}
