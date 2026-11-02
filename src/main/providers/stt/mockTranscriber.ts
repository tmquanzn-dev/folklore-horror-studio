/**
 * Bộ chép lời Mock (offline, miễn phí): tìm các đoạn có tiếng bằng ffmpeg silencedetect rồi rải các từ
 * của văn bản kỳ vọng lên các đoạn đó theo độ dài từ. Cố ý làm "nhiễu" giống Whisper thật
 * (chữ thường, mất dấu câu, thỉnh thoảng bỏ sót / nghe thừa một từ) để thử thuật toán căn mốc.
 */
import { splitWords } from '../../../shared/logic/align'
import type { Language } from '../../../shared/types'
import { probeDuration, runFfmpegCapture } from '../../media/ffmpeg'
import type { Transcriber, TranscribeOptions, Transcript, TranscriptWord } from '../interfaces'

/** Các khoảng có tiếng, suy ra từ log silencedetect */
export function speechIntervals(stderr: string, duration: number): { start: number; end: number }[] {
  const silences: { start: number; end: number }[] = []
  let open: number | null = null
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]))
    if (m[1] === 'start') open = t
    else if (open !== null) {
      silences.push({ start: open, end: t })
      open = null
    }
  }
  if (open !== null) silences.push({ start: open, end: duration })
  const out: { start: number; end: number }[] = []
  let cur = 0
  for (const s of silences) {
    if (s.start - cur > 0.05) out.push({ start: cur, end: s.start })
    cur = Math.max(cur, s.end)
  }
  if (duration - cur > 0.05) out.push({ start: cur, end: duration })
  return out
}

/** Rải từ lên các đoạn có tiếng theo trọng số ký tự (hàm thuần – có unit test) */
export function spreadWords(words: string[], intervals: { start: number; end: number }[]): TranscriptWord[] {
  const total = intervals.reduce((s, i) => s + (i.end - i.start), 0)
  if (total <= 0 || words.length === 0) return []
  const weights = words.map((w) => w.length + 1)
  const sumW = weights.reduce((a, b) => a + b, 0)
  // Thời gian nói tích luỹ → thời điểm thật (nhảy qua khoảng lặng)
  const at = (speechT: number): number => {
    let acc = 0
    for (const iv of intervals) {
      const len = iv.end - iv.start
      if (speechT <= acc + len + 1e-9) return iv.start + (speechT - acc)
      acc += len
    }
    return intervals[intervals.length - 1].end
  }
  // Khoảng nói (theo thời gian nói tích luỹ) của từng đoạn có tiếng
  const spans: { a: number; b: number; iv: { start: number; end: number } }[] = []
  let acc = 0
  for (const iv of intervals) {
    spans.push({ a: acc, b: acc + (iv.end - iv.start), iv })
    acc += iv.end - iv.start
  }
  const r3 = (n: number): number => Math.round(n * 1000) / 1000
  const out: TranscriptWord[] = []
  let cum = 0
  words.forEach((w, i) => {
    const a = (cum / sumW) * total
    cum += weights[i]
    const b = (cum / sumW) * total
    // Một từ không vắt qua khoảng lặng: dồn hẳn vào đoạn có tiếng chứa phần lớn của từ
    const home = spans.reduce((best, s) => (Math.min(b, s.b) - Math.max(a, s.a) > Math.min(b, best.b) - Math.max(a, best.a) ? s : best), spans[0])
    const start = Math.max(home.iv.start, at(a + 1e-6))
    const end = Math.min(home.iv.end, at(b))
    const s0 = home.a <= a ? start : home.iv.start
    const e0 = home.b >= b ? end : home.iv.end
    out.push({ word: w, start: r3(s0), end: r3(Math.max(s0, e0)) })
  })
  return out
}

export class MockTranscriber implements Transcriber {
  readonly id = 'mock-stt'
  readonly model = 'mock'

  estimateCost(): number {
    return 0
  }

  async transcribe(audioPath: string, language: Language, opts: TranscribeOptions = {}): Promise<Transcript> {
    const duration = await probeDuration(audioPath)
    // Ngưỡng lặng tương đối theo đỉnh của file (file thu nhỏ tiếng vẫn tách được câu)
    const vol = await runFfmpegCapture(['-i', audioPath, '-af', 'volumedetect', '-f', 'null', '-'], opts.signal)
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(vol)?.[1] ?? '0')
    const noise = Math.min(-20, peak - 24).toFixed(1)
    const log = await runFfmpegCapture(['-i', audioPath, '-af', `silencedetect=noise=${noise}dB:d=0.25`, '-f', 'null', '-'], opts.signal)
    const intervals = speechIntervals(log, duration)
    // Nhiễu có chủ đích, tất định: bỏ từ thứ 19, chèn "ờ"/"uh" sau mỗi 29 từ, bỏ dấu câu + chữ thường
    let k = 0
    const noisy = (text: string): string[] => {
      const out: string[] = []
      for (const w of splitWords(text)) {
        const i = k++
        if (i % 19 === 18) continue
        out.push(w.toLocaleLowerCase(language).replace(/[^\p{L}\p{N}]/gu, ''))
        if (i % 29 === 28) out.push(language === 'vi' ? 'ờ' : 'uh')
      }
      return out
    }
    // Mỗi câu có khoảng lặng riêng (số đoạn có tiếng = số câu) ⇒ đặt từng câu vào đúng đoạn của nó, như Whisper nghe thật;
    // không thì rải cả bài theo độ dài từ
    const lines = opts.expectedLines?.filter((l) => splitWords(l).length > 0)
    const timed =
      lines && lines.length === intervals.length
        ? lines.flatMap((l, i) => spreadWords(noisy(l), [intervals[i]]))
        : spreadWords(noisy(opts.expectedText ?? lines?.join(' ') ?? ''), intervals)
    return { text: timed.map((w) => w.word).join(' '), language, words: timed, segments: intervals.map((iv) => ({ text: '', ...iv })), cost: 0 }
  }
}
