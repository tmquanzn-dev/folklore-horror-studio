/**
 * CHIA PHẦN TIKTOK/SHORTS: cắt kịch bản dài thành các phần ~targetSec giây.
 * - Ưu tiên cắt ở ranh giới beat (câu chuyện liền mạch hơn); nếu không thì cắt ở ranh giới câu.
 * - Không bao giờ cắt giữa câu.
 * - Phần cuối quá ngắn (< minLastPartRatio × target) được nhập vào phần trước nếu không vượt quá nhiều.
 * targetSec ở đây là thời lượng THÂN mỗi phần (đã trừ hook + cliffhanger).
 */
export interface PartLineInput {
  id: string
  beatId: string
  estSec: number
}

export interface SplitOptions {
  targetSec: number
  /** Cho phép lệch ±ratio quanh target */
  toleranceRatio: number
  minLastPartRatio: number
}

export function splitIntoParts(lines: PartLineInput[], opts: SplitOptions): string[][] {
  if (lines.length === 0) return []
  const lo = opts.targetSec * (1 - opts.toleranceRatio)
  const hi = opts.targetSec * (1 + opts.toleranceRatio)
  const parts: PartLineInput[][] = []
  let cur: PartLineInput[] = []
  let curSec = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (cur.length > 0) {
      const beatBoundary = cur[cur.length - 1].beatId !== line.beatId
      // Đã đủ dài và đang ở ranh giới beat ⇒ cắt đẹp
      const cutAtBeat = beatBoundary && curSec >= lo
      // Thêm câu này sẽ vượt quá xa ⇒ buộc cắt ở ranh giới câu
      const forced = curSec + line.estSec > hi && curSec >= opts.targetSec * 0.5
      if (cutAtBeat || forced) {
        parts.push(cur)
        cur = []
        curSec = 0
      }
    }
    cur.push(line)
    curSec += line.estSec
  }
  if (cur.length > 0) {
    const last = parts[parts.length - 1]
    const lastSec = (p: PartLineInput[]): number => p.reduce((s, l) => s + l.estSec, 0)
    if (last && curSec < opts.targetSec * opts.minLastPartRatio && lastSec(last) + curSec <= hi * 1.2) {
      last.push(...cur)
    } else {
      parts.push(cur)
    }
  }
  return parts.map((p) => p.map((l) => l.id))
}
