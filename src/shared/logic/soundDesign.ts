/**
 * THIẾT KẾ ÂM THANH THEO LUẬT (hàm thuần): dùng làm output Mock LLM và phương án dự phòng.
 * - Ambience: một lớp nền phủ toàn video, chọn theo tag bảng âm thanh của kênh + từ khoá trong kịch bản.
 * - Nhạc nền (drone) rất nhỏ phủ toàn video nếu có.
 * - Stinger ở câu đầu của beat cao trào; khoảng lặng có chủ đích ngay trước đó.
 * - SFX ở câu có từ khoá khớp tag (nước, gỗ kẽo kẹt, gõ cửa…), thưa (cách nhau tối thiểu vài giây).
 * - Câu treo cuối (cliffhanger/outro) có thêm stinger nhỏ.
 * CHỈ dùng asset đã xác nhận giấy phép.
 */
import type { SoundAsset, SoundCue, SoundPalette } from '../types'

export interface DesignLine {
  id: string
  text: string
  start: number
  end: number
  beatId: string
  sectionKind: string
}

export interface DesignInput {
  duration: number
  lines: DesignLine[]
  beatIntensity: (beatId: string) => number
  assets: SoundAsset[]
  palette: SoundPalette
  climaxThreshold: number
  silenceBeforeClimaxSec: number
}

/** Từ khoá trong lời kể (VI + EN) → tag âm thanh */
export const SFX_KEYWORDS: Record<string, RegExp> = {
  water: /nước|sông|tắm|chết đuối|splash|water|river|drown/i,
  'wood-creak': /mái chèo|ghe|đò|thuyền|ván|kẽo kẹt|oar|boat|plank|creak/i,
  knock: /gõ cửa|cửa nhà|knock|door/i,
  footsteps: /bước chân|dấu chân|footstep|footprint/i,
  whisper: /thì thầm|thầm thì|kêu nhỏ|gọi tên|whisper|call(s|ed)? (your|my|her) name/i,
  wind: /gió|wind/i
}

const r2 = (n: number): number => Math.round(n * 100) / 100
let seq = 0
const cid = (k: string): string => `cue-${k}-${(++seq).toString(36)}`

function score(asset: SoundAsset, wanted: string[]): number {
  const tags = asset.tags.map((t) => t.toLowerCase())
  return wanted.reduce((s, w) => s + (tags.some((t) => t.includes(w.toLowerCase()) || w.toLowerCase().includes(t)) ? 1 : 0), 0)
}

function best(assets: SoundAsset[], kind: SoundAsset['kind'], wanted: string[]): SoundAsset | undefined {
  return assets
    .filter((a) => a.kind === kind && a.licenseConfirmed)
    .map((a) => ({ a, s: score(a, wanted) }))
    .sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name))[0]?.a
}

export function designSoundCues(input: DesignInput): SoundCue[] {
  seq = 0
  const cues: SoundCue[] = []
  const D = input.duration
  const allText = input.lines.map((l) => l.text).join(' ')
  const textTags = Object.entries(SFX_KEYWORDS)
    .filter(([, re]) => re.test(allText))
    .map(([t]) => t)

  const amb = best(input.assets, 'ambience', [...input.palette.ambienceTags, ...textTags])
  if (amb) cues.push({ id: cid('amb'), kind: 'ambience', assetId: amb.id, start: 0, end: r2(D), volume: 1, fadeIn: 2, fadeOut: 3, reason: `Nền không khí "${amb.name}" theo bối cảnh` })
  const music = best(input.assets, 'music', input.palette.musicTags)
  if (music) cues.push({ id: cid('mus'), kind: 'music', assetId: music.id, start: 0, end: r2(D), volume: 1, fadeIn: 4, fadeOut: 4, reason: `Nhạc nền "${music.name}" rất nhỏ, giữ độ căng` })

  // Cao trào: câu đầu tiên của beat có cường độ ≥ ngưỡng
  const climax = input.lines.find((l) => input.beatIntensity(l.beatId) >= input.climaxThreshold)
  const stinger = best(input.assets, 'stinger', input.palette.stingerTags)
  if (climax) {
    const silStart = Math.max(0, climax.start - input.silenceBeforeClimaxSec)
    if (climax.start - silStart >= 0.3) {
      cues.push({ id: cid('sil'), kind: 'silence', assetId: null, start: r2(silStart), end: r2(climax.start - 0.05), volume: 0, fadeIn: 0, fadeOut: 0, reason: 'Khoảng lặng có chủ đích ngay trước cao trào' })
    }
    if (stinger) cues.push({ id: cid('stg'), kind: 'stinger', assetId: stinger.id, start: r2(climax.start), end: r2(Math.min(D, climax.start + Math.max(1, stinger.durationSec || 3))), volume: 1, fadeIn: 0, fadeOut: 0.6, reason: 'Stinger mở màn cao trào' })
  }
  // Câu treo / kết
  const last = [...input.lines].reverse().find((l) => l.sectionKind === 'cliffhanger' || l.sectionKind === 'outro')
  if (last && stinger && (!climax || last.start - climax.start > 8)) {
    cues.push({ id: cid('stg'), kind: 'stinger', assetId: stinger.id, start: r2(last.end), end: r2(Math.min(D, last.end + Math.max(1, stinger.durationSec || 3))), volume: 0.7, fadeIn: 0, fadeOut: 0.8, reason: 'Stinger nhẹ sau câu treo' })
  }

  // SFX theo từ khoá – chỉ ở khoảnh khắc then chốt: bỏ 2,5s đầu (câu móc), beat đủ căng, cách nhau ≥10s, tối đa ~1/15s
  let lastSfx = -Infinity
  let sfxCount = 0
  const maxSfx = Math.max(2, Math.round(D / 15))
  for (const l of input.lines) {
    if (sfxCount >= maxSfx) break
    if (l.start < 2.5 || l.start - lastSfx < 10 || input.beatIntensity(l.beatId) < 0.45) continue
    // Một câu có thể khớp nhiều từ khoá (vd "dấu chân… cửa nhà") ⇒ thử lần lượt, lấy cái có âm thanh phù hợp
    let a: SoundAsset | undefined
    for (const [tag, re] of Object.entries(SFX_KEYWORDS)) {
      if (!re.test(l.text)) continue
      const cand = best(input.assets, 'sfx', [tag])
      if (cand && score(cand, [tag]) > 0) {
        a = cand
        break
      }
    }
    if (!a) continue
    const start = r2(Math.min(D - 0.5, l.start + 0.3))
    cues.push({ id: cid('sfx'), kind: 'sfx', assetId: a.id, start, end: r2(Math.min(D, start + Math.min(3, Math.max(0.5, a.durationSec || 2)))), volume: 1, fadeIn: 0.05, fadeOut: 0.3, reason: `"${l.text.slice(0, 40)}…" → ${a.name}` })
    lastSfx = l.start
    sfxCount++
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** Kiểm tra cue (từ LLM hoặc người dùng): asset tồn tại + đúng loại + có giấy phép, thời gian hợp lệ */
export function validateCues(cues: SoundCue[], assets: SoundAsset[], duration: number): { cues: SoundCue[]; problems: string[] } {
  const problems: string[] = []
  const out: SoundCue[] = []
  for (const c of cues) {
    const start = Math.max(0, Math.min(duration, c.start))
    const end = Math.max(start, Math.min(duration, c.end))
    if (end - start < 0.1) {
      problems.push(`cue ${c.id}: quá ngắn hoặc ngoài thời lượng video`)
      continue
    }
    if (c.kind !== 'silence') {
      const a = assets.find((x) => x.id === c.assetId)
      if (!a) {
        problems.push(`cue ${c.id}: assetId "${c.assetId}" không tồn tại`)
        continue
      }
      if (!a.licenseConfirmed) {
        problems.push(`cue ${c.id}: "${a.name}" chưa xác nhận giấy phép`)
        continue
      }
      if (a.kind !== c.kind) {
        problems.push(`cue ${c.id}: "${a.name}" là ${a.kind}, không phải ${c.kind}`)
        continue
      }
    }
    out.push({ ...c, start: r2(start), end: r2(end), volume: Math.max(0, Math.min(1.5, c.volume)), fadeIn: Math.max(0, c.fadeIn), fadeOut: Math.max(0, c.fadeOut) })
  }
  return { cues: out.sort((a, b) => a.start - b.start), problems }
}
