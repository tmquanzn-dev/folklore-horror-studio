import { describe, expect, it } from 'vitest'
import { splitIntoParts, type PartLineInput } from '../src/shared/logic/tiktokParts'

const opts = { targetSec: 80, toleranceRatio: 0.15, minLastPartRatio: 0.45 }

function lines(spec: [string, number][]): PartLineInput[] {
  return spec.map(([beatId, estSec], i) => ({ id: `l${i + 1}`, beatId, estSec }))
}

const sum = (ls: PartLineInput[], ids: string[]): number => ids.reduce((s, id) => s + ls.find((l) => l.id === id)!.estSec, 0)

describe('splitIntoParts – chia phần TikTok', () => {
  it('giữ nguyên thứ tự, không mất / lặp câu', () => {
    const ls = lines(Array.from({ length: 40 }, (_, i) => [`b${Math.floor(i / 5)}`, 6] as [string, number]))
    const parts = splitIntoParts(ls, opts)
    expect(parts.flat()).toEqual(ls.map((l) => l.id))
  })

  it('mỗi phần nằm trong khoảng cho phép (trừ phần cuối)', () => {
    const ls = lines(Array.from({ length: 40 }, (_, i) => [`b${Math.floor(i / 4)}`, 6] as [string, number]))
    const parts = splitIntoParts(ls, opts)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const p of parts.slice(0, -1)) {
      expect(sum(ls, p)).toBeGreaterThanOrEqual(80 * 0.5)
      expect(sum(ls, p)).toBeLessThanOrEqual(80 * 1.15)
    }
  })

  it('ưu tiên cắt ở ranh giới beat khi đã đủ dài', () => {
    // beat A dài 72s (≥ 68s = 85% target) ⇒ cắt ngay khi sang beat B, dù B còn chỗ
    const ls = lines([...Array(12).fill(['A', 6]), ...Array(12).fill(['B', 6])] as [string, number][])
    const parts = splitIntoParts(ls, opts)
    expect(parts[0]).toEqual(ls.slice(0, 12).map((l) => l.id))
  })

  it('buộc cắt ở ranh giới câu khi một beat quá dài', () => {
    const ls = lines(Array(30).fill(['A', 6]) as [string, number][])
    const parts = splitIntoParts(ls, opts)
    expect(parts.length).toBe(2)
    expect(sum(ls, parts[0])).toBeLessThanOrEqual(92)
  })

  it('phần cuối quá ngắn được nhập vào phần trước', () => {
    const ls = lines([...Array(13).fill(['A', 6]), ['B', 6], ['B', 6]] as [string, number][])
    const parts = splitIntoParts(ls, opts)
    expect(parts.length).toBe(1)
  })

  it('kịch bản ngắn ⇒ 1 phần; rỗng ⇒ 0 phần', () => {
    expect(splitIntoParts(lines([['A', 10], ['B', 10]]), opts)).toEqual([['l1', 'l2']])
    expect(splitIntoParts([], opts)).toEqual([])
  })
})
