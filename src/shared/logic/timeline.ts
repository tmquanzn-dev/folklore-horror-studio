/**
 * Ghép câu: tính mốc start/end chính xác từng câu từ thời lượng take + khoảng lặng trước/sau.
 * Bố cục: [leadIn] [pauseBefore₁][câu 1][pauseAfter₁] [pauseBefore₂][câu 2]... [tail]
 */

export interface TimelineItemInput {
  id: string
  duration: number
  pauseBeforeMs: number
  pauseAfterMs: number
}

export interface TimedItem {
  id: string
  start: number
  end: number
}

export interface TimelineResult {
  items: TimedItem[]
  totalDuration: number
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000

export function computeLineTimings(
  inputs: TimelineItemInput[],
  opts: { leadInSec: number; tailSec: number }
): TimelineResult {
  let cursor = Math.max(0, opts.leadInSec)
  const items: TimedItem[] = []
  for (const it of inputs) {
    if (!(it.duration >= 0)) throw new Error(`Thời lượng câu ${it.id} không hợp lệ: ${it.duration}`)
    const start = cursor + Math.max(0, it.pauseBeforeMs) / 1000
    const end = start + it.duration
    items.push({ id: it.id, start: r3(start), end: r3(end) })
    cursor = end + Math.max(0, it.pauseAfterMs) / 1000
  }
  return { items, totalDuration: r3(cursor + Math.max(0, opts.tailSec)) }
}
