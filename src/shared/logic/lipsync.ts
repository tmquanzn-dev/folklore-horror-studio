/**
 * GĐ7 – Khớp môi, chớp mắt, chọn cảnh rối (hàm thuần, TẤT ĐỊNH: cùng đầu vào ⇒ cùng kết quả,
 * không Math.random / Date.now ⇒ Remotion Player xem trước và bản render khớp nhau).
 *
 * Khớp môi = chữ → hình miệng (viseme) theo mốc từng từ, rồi dùng đường âm lượng (envelope) của giọng
 * để khép miệng khi im lặng và thu nhỏ độ mở khi nói nhỏ ("hybrid"). Không có chữ ⇒ chỉ theo âm lượng.
 */
import { puppetConfig } from '../config'
import type { EyeState, MouthCue, MouthShape } from '../types'
import { tokenize, wordTimings } from './subtitles'

const L = puppetConfig.lipsync

// ============================================================================ PRNG

/** Hash chuỗi → seed 32-bit (FNV-1a) */
export function seedOf(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 – số giả ngẫu nhiên [0,1) tất định theo seed */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============================================================================ Chữ → hình miệng

export interface VisemeSeg {
  shape: MouthShape
  /** Tỉ lệ thời lượng trong từ (tổng = 1) */
  w: number
}

const VI_VOWELS = 'aăâeêioôơuưy'

/** Bỏ dấu THANH (huyền, sắc, hỏi, ngã, nặng) nhưng giữ dấu chữ (â, ê, ô, ơ, ư, ă) */
export function stripTones(w: string): string {
  return w.normalize('NFD').replace(/[̣̀́̃̉]/g, '').normalize('NFC')
}

function collapse(segs: VisemeSeg[]): VisemeSeg[] {
  const out: VisemeSeg[] = []
  for (const s of segs) {
    if (s.w <= 0) continue
    const last = out[out.length - 1]
    if (last && last.shape === s.shape) last.w += s.w
    else out.push({ ...s })
  }
  const total = out.reduce((a, s) => a + s.w, 0) || 1
  return out.map((s) => ({ shape: s.shape, w: s.w / total }))
}

/** Một âm tiết tiếng Việt: phụ âm đầu (~30%) → nguyên âm (phần còn lại) → âm cuối m/p khép môi (A) */
export function visemesVi(word: string): VisemeSeg[] {
  const w = stripTones(word.toLowerCase()).replace(/[^a-zăâđêôơư]/g, '')
  if (!w) return []
  const vi = L.vi
  let initial = ''
  for (const c of vi.initials) {
    // "gi" + phụ âm (vd "gìn") ⇒ g + i; còn lại lấy phụ âm đầu dài nhất
    if (w.startsWith(c) && [...w.slice(c.length)].some((ch) => VI_VOWELS.includes(ch))) {
      initial = c
      break
    }
  }
  const rest = w.slice(initial.length)
  let k = 0
  while (k < rest.length && VI_VOWELS.includes(rest[k])) k++
  const nucleus = rest.slice(0, k)
  const final = rest.slice(k)
  if (!nucleus) return [{ shape: vi.defaultConsonant, w: 1 }]
  const segs: VisemeSeg[] = []
  const hasInitial = initial.length > 0
  const closes = vi.closingFinals.includes(final)
  const coreShare = 1 - (hasInitial ? vi.initialShare : 0) - (closes ? vi.finalShare : 0)
  if (hasInitial) segs.push({ shape: vi.initialShape[initial] ?? vi.defaultConsonant, w: vi.initialShare })
  // Nguyên âm đôi/ba: âm lướt đầu (o, u trước nguyên âm khác) ngắn, nguyên âm chính giữ lâu
  const shapes = [...nucleus].map((ch) => vi.vowelShape[ch] ?? 'C')
  if (shapes.length >= 2 && (nucleus[0] === 'o' || nucleus[0] === 'u')) {
    segs.push({ shape: shapes[0], w: coreShare * 0.3 }, { shape: shapes[1], w: coreShare * 0.7 })
  } else {
    segs.push({ shape: shapes[0], w: coreShare * (shapes.length >= 2 ? 0.7 : 1) })
    if (shapes.length >= 2) segs.push({ shape: shapes[shapes.length - 1], w: coreShare * 0.3 })
  }
  if (closes) segs.push({ shape: 'A', w: vi.finalShare })
  return collapse(segs)
}

/** Tiếng Anh: khớp cụm chữ dài nhất theo bảng luật trong config (không hardcode) */
export function visemesEn(word: string): VisemeSeg[] {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return []
  const en = L.en
  if (en.silentFinalE && w.length > 3 && w.endsWith('e') && !'aeiou'.includes(w[w.length - 2])) w = w.slice(0, -1)
  const rules = [...en.rules].sort((a, b) => b[0].length - a[0].length)
  const segs: VisemeSeg[] = []
  let i = 0
  while (i < w.length) {
    const r = rules.find(([g]) => w.startsWith(g, i))
    if (r) {
      segs.push({ shape: r[1], w: r[0].length })
      i += r[0].length
    } else {
      segs.push({ shape: en.defaultShape, w: 1 })
      i++
    }
  }
  return collapse(segs)
}

export function visemes(word: string, language: string): VisemeSeg[] {
  return language === 'vi' ? visemesVi(word) : visemesEn(word)
}

// ============================================================================ Âm lượng

/** RMS theo khung hình (dBFS) từ PCM 16-bit mono */
export function rmsDbPerFrame(pcm: Int16Array, sampleRate: number, fps: number): number[] {
  const per = sampleRate / fps
  const n = Math.ceil(pcm.length / per)
  const out = new Array<number>(n)
  for (let f = 0; f < n; f++) {
    const a = Math.floor(f * per)
    const b = Math.min(pcm.length, Math.floor((f + 1) * per))
    let sum = 0
    for (let i = a; i < b; i++) sum += pcm[i] * pcm[i]
    const rms = b > a ? Math.sqrt(sum / (b - a)) / 32768 : 0
    out[f] = rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -120
  }
  return out
}

/**
 * Chế độ 'amplitude' (không có chữ): ngưỡng có TRỄ (hysteresis) để miệng không rung giữa 2 mức:
 * im ⇒ X; to dần ⇒ B → C → D; âm lượng tụt đột ngột giữa câu ⇒ khép A thoáng qua.
 */
export function amplitudeShapes(db: number[]): MouthShape[] {
  const a = L.amplitude
  const levels: MouthShape[] = ['X', 'B', 'C', 'D']
  // ngưỡng để LÊN mức 1 (B), 2 (C), 3 (D)
  const up = [a.silenceDb, a.openDb[0], a.openDb[1]]
  let lvl = 0
  return db.map((v, i) => {
    // lên mức khi vượt ngưỡng; xuống mức chỉ khi thấp hơn ngưỡng của mức hiện tại một khoảng "trễ"
    while (lvl < 3 && v >= up[lvl]) lvl++
    while (lvl > 0 && v < up[lvl - 1] - a.hysteresisDb) lvl--
    const prev = i > 0 ? db[i - 1] : v
    if (lvl > 0 && prev - v >= a.dropDb && v > a.silenceDb) return 'A'
    return levels[lvl]
  })
}

// ============================================================================ Câu → MouthCue

export interface LineLipInput {
  text: string
  language: string
  start: number
  end: number
  /** Mốc thật từng từ (giọng tự thu); không có ⇒ ước lượng theo độ dài từ */
  words?: { word: string; start: number; end: number }[] | null
  /** dB theo khung, khung 0 = thời điểm 0 của voice track */
  envelope?: number[] | null
  fps: number
  /** Biểu cảm thì thầm ⇒ ưu tiên hình B/C thay D */
  bias?: MouthShape
}

/** Dãy hình miệng theo từng khung (rồi gom thành cue) – hàm thuần */
export function lineMouthCues(inp: LineLipInput): MouthCue[] {
  const { fps } = inp
  const f0 = Math.max(0, Math.floor(inp.start * fps))
  const f1 = Math.max(f0 + 1, Math.ceil(inp.end * fps))
  const frames: MouthShape[] = new Array(f1 - f0).fill('X')
  const env = inp.envelope ?? null

  const tokens = tokenize(inp.text).filter((t) => /[\p{L}\p{N}]/u.test(t))
  let words: { word: string; start: number; end: number }[]
  if (inp.words && inp.words.length) words = inp.words
  else if (tokens.length) words = wordTimings(tokens, inp.start, inp.end).map((t, i) => ({ word: tokens[i], ...t }))
  else words = []

  if (words.length) {
    for (const w of words) {
      const segs = visemes(w.word, inp.language)
      if (!segs.length) continue
      let t = w.start
      const span = Math.max(0, w.end - w.start)
      for (const s of segs) {
        const a = Math.round(t * fps) - f0
        t += span * s.w
        const b = Math.round(t * fps) - f0
        for (let f = Math.max(0, a); f < Math.min(frames.length, Math.max(b, a + 1)); f++) frames[f] = s.shape
      }
    }
    // Khoảng hở ngắn giữa 2 từ (< silenceGapMs) ⇒ giữ hình trước, không giật về X
    const gap = Math.round((L.silenceGapMs / 1000) * fps)
    for (let f = 1; f < frames.length; f++) {
      if (frames[f] !== 'X' || frames[f - 1] === 'X') continue
      let e = f
      while (e < frames.length && frames[e] === 'X') e++
      if (e < frames.length && e - f <= gap) for (let k = f; k < e; k++) frames[k] = frames[f - 1]
      f = e
    }
  } else if (env) {
    const amp = amplitudeShapes(env.slice(f0, f1))
    for (let f = 0; f < frames.length; f++) frames[f] = amp[f] ?? 'X'
  }

  // Hybrid: âm lượng ép về X khi im, nói nhỏ / thì thầm ⇒ thu độ mở
  if (env) {
    for (let f = 0; f < frames.length; f++) {
      const db = env[f0 + f]
      if (db === undefined) continue
      if (db < L.amplitude.silenceDb) frames[f] = 'X'
      else if (frames[f] === 'D' && (db < L.whisperDb || inp.bias === 'B')) frames[f] = 'C'
    }
  }
  // Thì thầm: miệng chỉ hé (không mở vừa/to/tròn hơi mở)
  if (inp.bias === 'B') for (let f = 0; f < frames.length; f++) if (frames[f] === 'D' || frames[f] === 'C' || frames[f] === 'E') frames[f] = 'B'
  return framesToCues(frames, f0, fps)
}

/** Gom khung thành cue + hậu xử lý: cue < minCueFrames gộp vào cue kề, A tối thiểu minClosedFrames */
export function framesToCues(frames: MouthShape[], f0: number, fps: number): MouthCue[] {
  type Run = { shape: MouthShape; a: number; b: number }
  let runs: Run[] = []
  for (let f = 0; f < frames.length; f++) {
    const last = runs[runs.length - 1]
    if (last && last.shape === frames[f]) last.b = f + 1
    else runs.push({ shape: frames[f], a: f, b: f + 1 })
  }
  // A (môi khép m/b/p) phải thấy được ⇒ kéo dài sang cue sau
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (r.shape !== 'A' || r.b - r.a >= L.minClosedFrames) continue
    const need = L.minClosedFrames - (r.b - r.a)
    const next = runs[i + 1]
    if (next && next.b - next.a > need) {
      r.b += need
      next.a += need
    }
  }
  // Cue quá ngắn (giật) ⇒ gộp vào cue trước (không có thì cue sau); A và X được giữ
  let changed = true
  while (changed) {
    changed = false
    const out: Run[] = []
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]
      const short = r.b - r.a < L.minCueFrames && r.shape !== 'A' && r.shape !== 'X'
      if (short && out.length) {
        out[out.length - 1].b = r.b
        changed = true
      } else if (short && runs[i + 1]) {
        runs[i + 1].a = r.a
        changed = true
      } else out.push({ ...r })
    }
    // gộp các run kề cùng hình sau khi nhập
    runs = out.reduce<Run[]>((acc, r) => {
      const last = acc[acc.length - 1]
      if (last && last.shape === r.shape) last.b = r.b
      else acc.push(r)
      return acc
    }, [])
  }
  const q = (f: number): number => Math.round(((f0 + f) / fps) * 1000) / 1000
  return runs.map((r) => ({ start: q(r.a), end: q(r.b), shape: r.shape }))
}

/** Hình miệng tại thời điểm t (giây tuyệt đối) – ngoài mọi cue ⇒ X */
export function mouthAt(cues: MouthCue[], t: number): MouthShape {
  // cues đã sắp xếp ⇒ tìm nhị phân
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = cues[mid]
    if (t < c.start) hi = mid - 1
    else if (t >= c.end) lo = mid + 1
    else return c.shape
  }
  return 'X'
}

// ============================================================================ Chớp mắt

/**
 * Lịch chớp mắt tất định: khoảng ngẫu nhiên trong [minSec, maxSec] (chia rate), seed = rigId + sceneId.
 * avoid(frame) = true ⇒ dời chớp mắt (vd đang mở miệng to D kéo dài).
 */
export function blinkStarts(seed: string, totalFrames: number, fps: number, minSec: number, maxSec: number, rate = 1, avoid?: (frame: number) => boolean): number[] {
  const rnd = prng(seedOf(seed))
  const out: number[] = []
  let f = Math.round(fps * (0.4 + rnd() * 1.2))
  const len = puppetConfig.blink.frames.length
  while (f < totalFrames - len) {
    let s = f
    for (let k = 0; k < fps && avoid?.(s); k++) s++
    out.push(s)
    f = s + len + Math.round((fps * (minSec + rnd() * (maxSec - minSec))) / Math.max(0.2, rate))
  }
  return out
}

/** Trạng thái mắt tại khung (null = không chớp, dùng mắt của biểu cảm) */
export function blinkStateAt(starts: number[], frame: number): EyeState | null {
  const seq = puppetConfig.blink.frames
  for (const s of starts) {
    if (frame < s) return null
    if (frame < s + seq.length) return seq[frame - s]
  }
  return null
}

// ============================================================================ Chọn cảnh rối

export interface PuppetCandidate {
  start: number
  end: number
  /** Cảnh có thể dùng rối (vd cảnh người kể mà người kể có rối) */
  eligible: boolean
}

/**
 * Chọn cảnh rối: tổng thời lượng ≤ maxRatio × tổng; không để 1 chuỗi cảnh rối liền nhau dài quá maxContinuousSec.
 * Ưu tiên theo thứ tự thời gian (intro người kể trước).
 */
export function selectPuppetScenes(scenes: PuppetCandidate[], totalSec: number, maxRatio: number, maxContinuousSec: number): Set<number> {
  const picked = new Set<number>()
  if (maxRatio <= 0) return picked
  let used = 0
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]
    if (!s.eligible) continue
    const d = s.end - s.start
    if (used + d > maxRatio * totalSec + 1e-6) continue
    // chiều dài chuỗi rối liền nhau nếu thêm cảnh này
    let run = d
    for (let k = i - 1; k >= 0 && picked.has(k); k--) run += scenes[k].end - scenes[k].start
    if (run > maxContinuousSec + 1e-6) continue
    picked.add(i)
    used += d
  }
  return picked
}
