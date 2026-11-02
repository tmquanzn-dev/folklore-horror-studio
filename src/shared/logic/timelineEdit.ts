/**
 * Sửa timeline bằng kéo thả (hàm thuần, có test):
 * - Kéo biên giữa 2 cảnh liền nhau: cảnh trước kết thúc = cảnh sau bắt đầu (timeline luôn liền mạch).
 * - Hút về khoảng lặng gần nhất giữa 2 câu (để không cắt cảnh giữa câu) nếu trong tầm hút.
 * - Kéo/di chuyển sound cue, kẹp trong thời lượng video.
 */
import type { ReleaseScene, SoundCue } from '../types'

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** Điểm hút: giữa khoảng lặng giữa các câu */
export function lineGapSnapPoints(lines: { start: number | null; end: number | null }[]): number[] {
  const sorted = lines.filter((l) => l.start != null && l.end != null).sort((a, b) => (a.start as number) - (b.start as number))
  const pts: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].end as number
    const nextStart = sorted[i].start as number
    if (nextStart >= prevEnd) pts.push(r3(nextStart - Math.min(0.2, (nextStart - prevEnd) / 2)))
  }
  return pts
}

export function snap(t: number, points: number[], radius: number): number {
  let best = t
  let d = radius
  for (const p of points) {
    if (Math.abs(p - t) <= d) {
      d = Math.abs(p - t)
      best = p
    }
  }
  return best
}

/**
 * Dời biên bắt đầu của cảnh index (= biên kết thúc của cảnh index-1).
 * Mỗi cảnh giữ tối thiểu minSec.
 */
export function moveSceneBoundary(scenes: ReleaseScene[], index: number, t: number, minSec = 0.6): ReleaseScene[] {
  if (index <= 0 || index >= scenes.length) return scenes
  const lo = scenes[index - 1].start + minSec
  const hi = scenes[index].end - minSec
  if (lo > hi) return scenes
  const nt = r3(Math.min(hi, Math.max(lo, t)))
  return scenes.map((s, i) => (i === index - 1 ? { ...s, end: nt } : i === index ? { ...s, start: nt } : s))
}

export type CueDragMode = 'move' | 'start' | 'end'

export function dragCue(cue: SoundCue, mode: CueDragMode, delta: number, duration: number, minLen = 0.2): SoundCue {
  const len = cue.end - cue.start
  if (mode === 'move') {
    const start = r3(Math.min(Math.max(0, cue.start + delta), Math.max(0, duration - len)))
    return { ...cue, start, end: r3(start + len) }
  }
  if (mode === 'start') return { ...cue, start: r3(Math.min(Math.max(0, cue.start + delta), cue.end - minLen)) }
  return { ...cue, end: r3(Math.max(Math.min(duration, cue.end + delta), cue.start + minLen)) }
}
