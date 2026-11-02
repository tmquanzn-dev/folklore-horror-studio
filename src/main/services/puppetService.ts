/**
 * GĐ7.1 – Rối 2D: tạo rối Mock cho nhân vật, bối cảnh mặc định của kênh, tính hình miệng (MouthCue)
 * cho từng câu sau khi đã có voice track, kiểm tra rối (validateRig).
 * File ảnh rối nằm trong thư mục dùng chung _characters/rigs/<rigId>/ (media server phục vụ như ảnh nhân vật).
 */
import fs from 'node:fs/promises'
import { puppetConfig, platformsConfig } from '../../shared/config'
import { lineMouthCues, rmsDbPerFrame } from '../../shared/logic/lipsync'
import { CHANNEL_NARRATOR_ID } from '../../shared/sampleData'
import { MOUTH_SHAPES, type Library, type MouthShape, type PuppetRig, type PuppetStage, type Release, type Story } from '../../shared/types'
import { logger } from '../logger'
import { generateMockRigFiles, generateMockStageFiles, lookOf, RIG_CANVAS, RIG_REGIONS } from '../media/mockRig'
import { readWav } from '../media/wav'
import type { StoryRepository } from '../storage/storyRepo'

export const DEFAULT_STAGE_ID = 'stage-lamp-corner'

export interface RigIssue {
  level: 'error' | 'warn'
  message: string
}

/** Kiểm tra rối: đủ 3 trạng thái mắt, tối thiểu X/A/B/D/F, file tồn tại, vùng nằm trong canvas */
export async function validateRig(rig: PuppetRig, exists: (rel: string) => Promise<boolean>): Promise<RigIssue[]> {
  const issues: RigIssue[] = []
  for (const st of ['open', 'half', 'closed'] as const) {
    if (!rig.eyeSet[st]) issues.push({ level: 'error', message: `Thiếu mắt "${st}"` })
    else if (!(await exists(rig.eyeSet[st]))) issues.push({ level: 'error', message: `Không thấy file mắt "${st}"` })
  }
  for (const m of ['X', 'A', 'B', 'D', 'F'] as MouthShape[]) {
    if (!rig.mouthSet[m]) issues.push({ level: 'error', message: `Thiếu hình miệng ${m} (bắt buộc X/A/B/D/F)` })
  }
  for (const m of MOUTH_SHAPES) {
    if (rig.mouthSet[m] && !(await exists(rig.mouthSet[m]))) issues.push({ level: 'error', message: `Không thấy file miệng ${m}` })
    if (!rig.mouthSet[m] && !['X', 'A', 'B', 'D', 'F'].includes(m)) issues.push({ level: 'warn', message: `Thiếu miệng ${m} – dùng hình gần nhất` })
  }
  if (!(await exists(rig.basePath))) issues.push({ level: 'error', message: 'Không thấy ảnh gốc' })
  for (const [k, r] of Object.entries(rig.regions)) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > rig.canvas.width || r.y + r.h > rig.canvas.height) issues.push({ level: 'error', message: `Vùng ${k} nằm ngoài ảnh gốc` })
  }
  return issues
}

/** Hình miệng thiếu ⇒ hình gần nhất có trong rối */
const NEAREST: Record<MouthShape, MouthShape[]> = {
  X: ['A'], A: ['X'], B: ['C', 'X'], C: ['B', 'D'], D: ['C', 'B'], E: ['F', 'C'], F: ['E', 'B'], G: ['B', 'A'], H: ['C', 'B']
}
export function completeMouthSet(set: Partial<Record<MouthShape, string>>): Record<MouthShape, string> {
  const out = {} as Record<MouthShape, string>
  for (const m of MOUTH_SHAPES) out[m] = set[m] ?? NEAREST[m].map((n) => set[n]).find(Boolean) ?? set.X ?? ''
  return out
}

export class PuppetService {
  constructor(private readonly repo: StoryRepository) {}

  private exists = (rel: string): Promise<boolean> => fs.access(this.repo.resolveCharacterPath(rel)).then(() => true, () => false)

  /** Rối Mock (offline, miễn phí) cho một nhân vật – thực thể ma không khớp môi (đặc tả) */
  async createMockRig(characterId: string): Promise<Library> {
    const lib = await this.repo.loadLibrary()
    const c = lib.characters.find((x) => x.id === characterId)
    if (!c) throw new Error('Không tìm thấy nhân vật')
    if (c.role === 'entity') throw new Error('Thực thể ma không dùng rối khớp môi (dễ thành hài) – giữ cho ma xuất hiện qua ảnh/bóng tối')
    const rigId = `rig-${characterId}`
    const files = await generateMockRigFiles(this.repo.resolveCharacterPath(`rigs/${rigId}`), `rigs/${rigId}`, lookOf(c))
    const rig: PuppetRig = {
      id: rigId,
      characterId,
      name: `${c.name} (Mock)`,
      level: 'patch',
      canvas: { ...RIG_CANVAS },
      basePath: files.base,
      regions: structuredClone(RIG_REGIONS),
      eyeSet: { open: files.eyes.open, half: files.eyes.half, closed: files.eyes.closed, wide: files.eyes.wide },
      mouthSet: files.mouths,
      expressions: structuredClone(puppetConfig.defaultExpressions),
      idle: { blinkMinSec: puppetConfig.blink.minSec, blinkMaxSec: puppetConfig.blink.maxSec, breathAmp: 0.012, swayDeg: 0.8 },
      source: 'mock',
      validated: false,
      version: puppetConfig.lipsync.algorithmVersion,
      createdAt: new Date().toISOString()
    }
    rig.validated = (await validateRig(rig, this.exists)).every((i) => i.level !== 'error')
    lib.puppetRigs = [...lib.puppetRigs.filter((r) => r.id !== rigId), rig]
    c.puppetRigId = rigId
    await this.ensureDefaultStageIn(lib)
    await this.repo.saveLibrary(lib)
    logger.info(`Tạo rối Mock cho "${c.name}" (3 mắt + 9 miệng)`, 'puppet')
    return lib
  }

  async removeRig(characterId: string): Promise<Library> {
    const lib = await this.repo.loadLibrary()
    const c = lib.characters.find((x) => x.id === characterId)
    if (!c) throw new Error('Không tìm thấy nhân vật')
    lib.puppetRigs = lib.puppetRigs.filter((r) => r.characterId !== characterId)
    c.puppetRigId = null
    await this.repo.saveLibrary(lib)
    return lib
  }

  /** Bối cảnh mặc định (góc nhà đèn dầu) – gán cho kênh chưa có */
  private async ensureDefaultStageIn(lib: Library): Promise<PuppetStage> {
    let stage = lib.puppetStages.find((s) => s.id === DEFAULT_STAGE_ID)
    if (!stage || !(await this.exists(stage.backgroundPath['16:9']))) {
      const bg = await generateMockStageFiles(this.repo.resolveCharacterPath(`stages/${DEFAULT_STAGE_ID}`), `stages/${DEFAULT_STAGE_ID}`)
      stage = { id: DEFAULT_STAGE_ID, name: 'Góc nhà đèn dầu', backgroundPath: bg, floorY: 0.82, lighting: 'lamp' }
      lib.puppetStages = [...lib.puppetStages.filter((s) => s.id !== DEFAULT_STAGE_ID), stage]
    }
    for (const ch of lib.channelPresets) ch.puppetStageId ??= stage.id
    return stage
  }

  /** Dữ liệu mẫu: người kể (Bà Tư) có rối Mock ⇒ intro/đoạn người kể "lên hình" chớp mắt, khớp môi */
  async ensureSampleRig(): Promise<void> {
    const lib = await this.repo.loadLibrary()
    const narrator = lib.characters.find((c) => c.id === CHANNEL_NARRATOR_ID)
    if (!narrator) return
    const rig = lib.puppetRigs.find((r) => r.id === narrator.puppetRigId)
    if (rig && (await this.exists(rig.basePath)) && (await this.exists(rig.mouthSet.D))) return
    await this.createMockRig(CHANNEL_NARRATOR_ID)
  }

  /**
   * Sau bước 12 (đã có voice track + mốc câu): hình miệng cho mọi câu của nhân vật có rối.
   * Envelope âm lượng đọc thẳng từ voice_processed.wav (giọng chưa trộn nhạc ⇒ im lặng là im lặng thật).
   */
  async computeMouthCuesInto(story: Story, release: Release, lib: Library): Promise<number> {
    const vt = release.voiceTrack
    const rigged = new Set(lib.characters.filter((c) => c.puppetRigId && lib.puppetRigs.some((r) => r.id === c.puppetRigId)).map((c) => c.id))
    for (const l of release.script.lines) l.mouthCues = null
    if (!vt?.processedPath || rigged.size === 0) return 0
    const fps = platformsConfig.fps
    let envelope: number[] | null = null
    try {
      const wav = readWav(await fs.readFile(this.repo.resolveInStory(story.id, vt.processedPath)))
      if (wav.bitsPerSample === 16 && wav.channels === 1) {
        // Sao chép sang buffer mới: data có thể bắt đầu ở byte lẻ (Int16Array cần căn 2 byte)
        const bytes = new Uint8Array(wav.data.byteLength - (wav.data.byteLength % 2))
        bytes.set(wav.data.subarray(0, bytes.length))
        const pcm = new Int16Array(bytes.buffer)
        envelope = rmsDbPerFrame(pcm, wav.sampleRate, fps)
      }
    } catch (e) {
      logger.warn(`Không đọc được âm lượng giọng để khớp môi (${e instanceof Error ? e.message : String(e)}) – khớp theo chữ`, release.id)
    }
    let n = 0
    for (const l of release.script.lines) {
      if (!rigged.has(l.speakerId) || l.start == null || l.end == null) continue
      const whisper = l.delivery.tags.some((t) => puppetConfig.deliveryExpression[t] === 'whisper')
      l.mouthCues = lineMouthCues({ text: l.text, language: release.language, start: l.start, end: l.end, words: l.wordTimings ?? null, envelope, fps, bias: whisper ? 'B' : undefined })
      n++
    }
    return n
  }
}
