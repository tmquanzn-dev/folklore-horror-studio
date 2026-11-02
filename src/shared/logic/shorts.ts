/**
 * Chọn đoạn cắt Shorts teaser (30–60 giây) từ bản YouTube dài:
 * - Bắt đầu ở đầu một câu, kết thúc ở cuối một câu (không cắt giữa câu).
 * - Không lấy cold open/outro/giải thích; ưu tiên đoạn căng (tổng cường độ cao)
 *   và KẾT THÚC Ở CÂU CĂNG (treo lửng) để người xem muốn xem bản dài.
 * - KHÔNG lộ cao trào: người gọi loại các câu thuộc beat cao trào trở về sau (spoilerBeatIds)
 *   ⇒ teaser dừng ngay trước cao trào.
 */

/** Beat cao trào (cường độ lớn nhất, nếu bằng nhau lấy beat đầu tiên) và mọi beat sau nó */
export function spoilerBeatIds(beats: { id: string; order: number; emotionalIntensity: number }[]): Set<string> {
  const ordered = [...beats].sort((a, b) => a.order - b.order)
  if (ordered.length === 0) return new Set()
  const climax = ordered.reduce((best, b, i) => (b.emotionalIntensity > ordered[best].emotionalIntensity ? i : best), 0)
  return new Set(ordered.slice(climax).map((b) => b.id))
}
export interface TeaserLine {
  id: string
  start: number
  end: number
  beatId: string
  sectionKind: string
}

export interface TeaserWindow {
  start: number
  end: number
  lineIds: string[]
  score: number
}

export function selectTeaserWindow(
  lines: TeaserLine[],
  beatIntensity: (beatId: string) => number,
  opts: { minSec: number; maxSec: number }
): TeaserWindow | null {
  const usable = lines.filter((l) => l.sectionKind === 'story' || l.sectionKind === 'context' || l.sectionKind === 'hook')
  let best: TeaserWindow | null = null
  for (let i = 0; i < usable.length; i++) {
    for (let j = i; j < usable.length; j++) {
      // Chỉ xét chuỗi câu liền nhau trong kịch bản gốc
      if (j > i && lines.indexOf(usable[j]) !== lines.indexOf(usable[j - 1]) + 1) break
      const len = usable[j].end - usable[i].start
      if (len > opts.maxSec) break
      if (len < opts.minSec) continue
      const seg = usable.slice(i, j + 1)
      const avg = seg.reduce((s, l) => s + beatIntensity(l.beatId), 0) / seg.length
      const endTension = beatIntensity(usable[j].beatId)
      // Kết ở câu căng được thưởng (treo lửng); đoạn dài hơn được cộng nhẹ
      const score = avg * 2 + endTension + (len - opts.minSec) / (opts.maxSec - opts.minSec) * 0.2
      if (!best || score > best.score) best = { start: usable[i].start, end: usable[j].end, lineIds: seg.map((l) => l.id), score: Math.round(score * 1000) / 1000 }
    }
  }
  return best
}
