/**
 * Căn mốc giọng tự thu: so khớp chuỗi từ Whisper nghe được với chuỗi từ trong kịch bản
 * (quy hoạch động kiểu edit distance) ⇒ mốc start/end từng câu + mốc từng từ cho phụ đề.
 *
 * - So sánh sau chuẩn hoá: chữ thường, bỏ dấu tiếng Việt, đ→d, bỏ dấu câu
 *   (Whisper hay sai dấu thanh / viết hoa khác kịch bản – vẫn phải khớp được).
 * - Từ gần giống (nói nhịu, Whisper nghe lệch 1–2 ký tự) tính là khớp "mờ".
 * - Đọc thừa, đọc lại một đoạn (retake), Whisper bịa thêm từ ⇒ thành "chèn", bị bỏ qua.
 * - Câu không khớp được từ nào ⇒ nội suy giữa câu trước và câu sau theo số từ.
 * Văn bản phụ đề vẫn lấy từ KỊCH BẢN (đúng chính tả), chỉ mốc thời gian lấy từ Whisper.
 */

export interface AlignWord {
  word: string
  start: number
  end: number
}

export interface AlignLineInput {
  id: string
  text: string
}

export interface AlignedLine {
  id: string
  start: number
  end: number
  /** Tỉ lệ từ của câu khớp được (0..1) */
  confidence: number
  /** Mốc từng từ của câu (văn bản theo kịch bản) */
  words: AlignWord[]
  /** true = không khớp được từ nào, mốc nội suy */
  interpolated: boolean
}

export interface AlignmentResult {
  lines: AlignedLine[]
  /** Tỉ lệ từ kịch bản khớp được trên toàn bài */
  coverage: number
  /** Số từ Whisper nghe được nhưng không có trong kịch bản (đọc thừa / đọc lại) */
  extraWords: number
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** Chuẩn hoá để so khớp: bỏ dấu, đ→d, chữ thường, chỉ giữ chữ + số */
export function normalizeToken(w: string): string {
  return w
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** Tách từ theo khoảng trắng, giữ nguyên chữ gốc (để làm phụ đề) */
export function splitWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => normalizeToken(w).length > 0)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const prev = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** 0 = khớp, 1 = gần giống, 3 = khác */
function pairCost(a: string, b: string): number {
  if (a === b) return 0
  const len = Math.max(a.length, b.length)
  if (len >= 4 && levenshtein(a, b) / len <= 0.34) return 1
  return 3
}

const GAP = 2

/**
 * Căn kịch bản với bản chép lời. Bộ nhớ O(n·m) byte cho hướng truy vết – 4000×4000 từ ≈ 16 MB.
 */
export function alignTranscript(lines: AlignLineInput[], transcript: AlignWord[], totalDuration: number): AlignmentResult {
  const script: { line: number; text: string; norm: string }[] = []
  lines.forEach((l, li) => splitWords(l.text).forEach((w) => script.push({ line: li, text: w, norm: normalizeToken(w) })))
  const heard = transcript.map((w) => ({ ...w, norm: normalizeToken(w.word) })).filter((w) => w.norm.length > 0)
  const n = script.length
  const m = heard.length

  // dir: 0 = chéo (khớp/thay), 1 = bỏ từ kịch bản, 2 = bỏ từ nghe được
  const dir = new Uint8Array((n + 1) * (m + 1))
  let prev = new Float64Array(m + 1)
  let cur = new Float64Array(m + 1)
  for (let j = 0; j <= m; j++) {
    prev[j] = j * GAP
    dir[j] = 2
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i * GAP
    dir[i * (m + 1)] = 1
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + pairCost(script[i - 1].norm, heard[j - 1].norm)
      const up = prev[j] + GAP
      const left = cur[j - 1] + GAP
      let best = diag
      let d = 0
      if (up < best) {
        best = up
        d = 1
      }
      if (left < best) {
        best = left
        d = 2
      }
      cur[j] = best
      dir[i * (m + 1) + j] = d
    }
    ;[prev, cur] = [cur, prev]
  }

  // Truy vết: từ kịch bản i ↔ từ nghe j (chỉ nhận khớp / gần giống)
  const match = new Int32Array(n).fill(-1)
  let i = n
  let j = m
  let extra = 0
  while (i > 0 || j > 0) {
    const d = i === 0 ? 2 : j === 0 ? 1 : dir[i * (m + 1) + j]
    if (d === 0) {
      if (pairCost(script[i - 1].norm, heard[j - 1].norm) < 3) match[i - 1] = j - 1
      i--
      j--
    } else if (d === 1) {
      i--
    } else {
      extra++
      j--
    }
  }

  // Mốc từng từ kịch bản: từ khớp lấy mốc thật; từ không khớp nội suy giữa 2 từ khớp gần nhất
  const ws = new Array<{ start: number; end: number } | null>(n).fill(null)
  for (let k = 0; k < n; k++) if (match[k] >= 0) ws[k] = { start: heard[match[k]].start, end: heard[match[k]].end }
  let k = 0
  while (k < n) {
    if (ws[k]) {
      k++
      continue
    }
    let e = k
    while (e < n && !ws[e]) e++
    const from = k > 0 ? (ws[k - 1] as { end: number }).end : 0
    const to = e < n ? (ws[e] as { start: number }).start : Math.max(from, totalDuration)
    const span = Math.max(0, to - from)
    const cnt = e - k
    for (let q = 0; q < cnt; q++) ws[k + q] = { start: from + (span * q) / cnt, end: from + (span * (q + 1)) / cnt }
    k = e
  }

  // Gom theo câu; đảm bảo không chồng lấn và tăng dần
  const out: AlignedLine[] = []
  let lastEnd = 0
  lines.forEach((l, li) => {
    const idx = script.map((s, x) => (s.line === li ? x : -1)).filter((x) => x >= 0)
    if (idx.length === 0) {
      out.push({ id: l.id, start: r3(lastEnd), end: r3(lastEnd), confidence: 0, words: [], interpolated: true })
      return
    }
    const matched = idx.filter((x) => match[x] >= 0).length
    let words = idx.map((x) => ({ word: script[x].text, start: (ws[x] as { start: number }).start, end: (ws[x] as { end: number }).end }))
    // Kẹp vào sau câu trước
    words = words.map((w) => ({ word: w.word, start: Math.max(w.start, lastEnd), end: Math.max(w.end, lastEnd) }))
    const start = words[0].start
    const end = Math.max(start, words[words.length - 1].end)
    lastEnd = end
    out.push({
      id: l.id,
      start: r3(start),
      end: r3(end),
      confidence: Math.round((matched / idx.length) * 100) / 100,
      words: words.map((w) => ({ word: w.word, start: r3(w.start), end: r3(Math.max(w.start, w.end)) })),
      interpolated: matched === 0
    })
  })
  const matchedAll = Array.from(match).filter((x) => x >= 0).length
  return { lines: out, coverage: n ? Math.round((matchedAll / n) * 100) / 100 : 0, extraWords: extra }
}
