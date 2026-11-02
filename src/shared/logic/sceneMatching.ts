/**
 * KHỚP CẢNH THEO BEAT
 * - Gom các câu liên tiếp cùng beat, chia thành nhóm 3–8 giây (không cắt giữa câu).
 * - Mỗi nhóm = 1 cảnh, lấy từ ngân hàng cảnh của beat đó, tuân luật đa dạng
 *   (không 2 cảnh liền nhau cùng shotType nếu còn lựa chọn khác, không lặp cùng một ảnh liền nhau).
 * - Beat thiếu cảnh → mượn cảnh beat gần nhất + trả về gợi ý "cần tạo thêm cảnh".
 */
import type { Beat, SceneBankItem, ShotType } from '../types'

export interface MatchLine {
  id: string
  beatId: string
  start: number
  end: number
  /** true = câu mở đầu đoạn có nhân vật kênh (người kể) xuất hiện trên hình */
  narrator?: boolean
}

export interface NarratorOptions {
  /** Cảnh có nhân vật kênh trong cast */
  isNarratorScene: (s: SceneBankItem) => boolean
}

export interface MatchOptions {
  minSec: number
  targetSec: number
  maxSec: number
  /** Cắt cảnh sớm hơn đầu câu kế tiếp một chút (nằm trong khoảng lặng) */
  cutLeadSec: number
}

export interface MatchedScene {
  id: string
  sceneBankId: string
  beatId: string
  start: number
  end: number
  lineIds: string[]
}

export interface MissingSceneHint {
  beatId: string
  available: number
  needed: number
  reason: 'noScenes' | 'reuse'
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** Gom câu liên tiếp cùng beatId (và cùng cờ người kể) */
export function groupByBeat(lines: MatchLine[]): MatchLine[][] {
  const groups: MatchLine[][] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && last[0].beatId === line.beatId && !!last[0].narrator === !!line.narrator) last.push(line)
    else groups.push([line])
  }
  return groups
}

/** Chia một nhóm câu thành các cụm ~targetSec, tối đa maxSec (trừ khi 1 câu đã dài hơn). */
export function chunkLines(lines: MatchLine[], opts: MatchOptions): MatchLine[][] {
  const chunks: MatchLine[][] = []
  let current: MatchLine[] = []
  const span = (c: MatchLine[]): number => (c.length ? c[c.length - 1].end - c[0].start : 0)
  for (const line of lines) {
    if (current.length > 0) {
      const d = span(current)
      const withNext = line.end - current[0].start
      if (d >= opts.minSec && (withNext > opts.maxSec || d >= opts.targetSec)) {
        chunks.push(current)
        current = []
      }
    }
    current.push(line)
  }
  if (current.length > 0) {
    // Cụm cuối quá ngắn → nhập vào cụm trước (trong cùng beat)
    if (chunks.length > 0 && span(current) < opts.minSec) {
      chunks[chunks.length - 1].push(...current)
    } else {
      chunks.push(current)
    }
  }
  return chunks
}

function pickCandidates(beatId: string, bank: SceneBankItem[], beats: Beat[]): SceneBankItem[] {
  const own = bank.filter((s) => s.beatId === beatId)
  if (own.length > 0) return own
  const order = beats.find((b) => b.id === beatId)?.order ?? 0
  // Beat gần nhất có cảnh (ưu tiên beat phía trước khi khoảng cách bằng nhau)
  const sorted = [...beats]
    .filter((b) => b.id !== beatId && bank.some((s) => s.beatId === b.id))
    .sort((a, b) => {
      const da = Math.abs(a.order - order)
      const db = Math.abs(b.order - order)
      if (da !== db) return da - db
      return a.order - b.order
    })
  const nearest = sorted[0]
  return nearest ? bank.filter((s) => s.beatId === nearest.id) : bank.slice(0, 1)
}

export function matchScenes(
  lines: MatchLine[],
  bank: SceneBankItem[],
  beats: Beat[],
  totalDuration: number,
  opts: MatchOptions,
  narrator?: NarratorOptions
): { scenes: MatchedScene[]; missing: MissingSceneHint[] } {
  if (lines.length === 0 || bank.length === 0) return { scenes: [], missing: [] }

  // Cảnh người kể chỉ dùng cho câu được đánh dấu narrator; cảnh truyện dùng cho phần còn lại
  const narratorBank = narrator ? bank.filter(narrator.isNarratorScene) : []
  const storyBank = narrator ? bank.filter((s) => !narrator.isNarratorScene(s)) : bank
  const usage = new Map<string, number>()
  const missing: MissingSceneHint[] = []
  const draft: { chunk: MatchLine[]; bankItem: SceneBankItem; beatId: string }[] = []
  let prev: SceneBankItem | null = null

  for (const group of groupByBeat(lines)) {
    const beatId = group[0].beatId
    const chunks = chunkLines(group, opts)
    const useNarrator = !!group[0].narrator && narratorBank.length > 0
    const pool = useNarrator ? narratorBank : storyBank.length > 0 ? storyBank : bank
    const own = pool.filter((s) => s.beatId === beatId)
    // Cảnh người kể: ưu tiên cảnh cùng beat, nếu không lấy bất kỳ cảnh người kể nào
    const candidates = useNarrator ? (own.length > 0 ? [...own, ...pool.filter((s) => s.beatId !== beatId)] : pool) : pickCandidates(beatId, pool, beats)
    if (!useNarrator) {
      if (own.length === 0) {
        missing.push({ beatId, available: 0, needed: chunks.length, reason: 'noScenes' })
      } else if (chunks.length > own.length) {
        missing.push({ beatId, available: own.length, needed: chunks.length, reason: 'reuse' })
      }
    }

    for (const chunk of chunks) {
      // Điểm phạt: trùng ảnh liền trước (rất nặng) > trùng shotType liền trước > đã dùng nhiều lần
      let best: SceneBankItem = candidates[0]
      let bestScore = Number.POSITIVE_INFINITY
      candidates.forEach((c, idx) => {
        let score = idx * 0.01 + (usage.get(c.id) ?? 0) * 10
        if (prev && c.id === prev.id) score += 1000
        if (prev && c.shotType === prev.shotType) score += 100
        if (score < bestScore) {
          bestScore = score
          best = c
        }
      })
      usage.set(best.id, (usage.get(best.id) ?? 0) + 1)
      draft.push({ chunk, bankItem: best, beatId })
      prev = best
    }
  }

  // Tính biên cảnh: cảnh đầu từ 0, cảnh cuối tới hết video, biên nằm trong khoảng lặng giữa 2 câu
  const scenes: MatchedScene[] = draft.map((d, i) => {
    const start =
      i === 0
        ? 0
        : (() => {
            const prevEnd = draft[i - 1].chunk[draft[i - 1].chunk.length - 1].end
            const nextStart = d.chunk[0].start
            const gap = Math.max(0, nextStart - prevEnd)
            return nextStart - Math.min(opts.cutLeadSec, gap / 2)
          })()
    return {
      id: `rs-${String(i + 1).padStart(3, '0')}`,
      sceneBankId: d.bankItem.id,
      beatId: d.beatId,
      start: r3(start),
      end: 0,
      lineIds: d.chunk.map((l) => l.id)
    }
  })
  scenes.forEach((s, i) => {
    s.end = i < scenes.length - 1 ? scenes[i + 1].start : r3(Math.max(totalDuration, s.start + 0.5))
  })
  return { scenes, missing }
}

export interface DiversityItem {
  shotType: ShotType
  motionType: string
}

export interface DiversityViolation {
  index: number
  kind: 'shotType' | 'motion'
}

/** Luật đa dạng: không 2 cảnh liền nhau cùng shotType, không 2 cảnh liền nhau cùng kiểu chuyển động */
export function findDiversityViolations(items: DiversityItem[]): DiversityViolation[] {
  const out: DiversityViolation[] = []
  for (let i = 1; i < items.length; i++) {
    if (items[i].shotType === items[i - 1].shotType) out.push({ index: i, kind: 'shotType' })
    if (items[i].motionType === items[i - 1].motionType) out.push({ index: i, kind: 'motion' })
  }
  return out
}
