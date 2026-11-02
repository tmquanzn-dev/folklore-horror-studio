/**
 * Dựng phụ đề từ câu đã có mốc thời gian.
 * - Mốc từng từ: có mốc thật (giọng tự thu căn bằng Whisper) thì dùng; không thì chia thời lượng câu theo độ dài từ.
 * - Chia cụm theo preset (YouTube: dài, 2 dòng; TikTok: 3–5 từ, chữ to).
 * - Đánh dấu thuật ngữ trong từ điển (bản tiếng Anh in nghiêng).
 */
import type { PronunciationEntry, SubtitleCue, SubtitleStyle, SubtitleWord } from '../types'

export interface SubtitleLineInput {
  id: string
  text: string
  start: number
  end: number
  /** Mốc thật từng từ (bỏ qua token chỉ có dấu câu) – từ align.ts */
  words?: { word: string; start: number; end: number }[]
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const bare = (w: string): string =>
  w
    .normalize('NFC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLocaleLowerCase('vi')

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0)
}

/** Chia [start,end] cho các từ theo số ký tự (+1 để từ ngắn vẫn có thời gian) */
export function wordTimings(words: string[], start: number, end: number): { start: number; end: number }[] {
  const weights = words.map((w) => bare(w).length + 1)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const span = Math.max(0, end - start)
  let cursor = start
  return weights.map((wt, i) => {
    const s = cursor
    const e = i === weights.length - 1 ? end : cursor + (span * wt) / total
    cursor = e
    return { start: r3(s), end: r3(e) }
  })
}

/** Trả về các cụm [từ chỉ số a, tới b) – ưu tiên ngắt sau dấu câu khi cụm đã đủ dài */
/**
 * Ghép mốc thật vào token phụ đề: token chỉ có dấu câu (vd "—", "…") không có mốc riêng ⇒ dính vào từ trước.
 * Số từ không khớp (kịch bản vừa sửa sau khi căn mốc) ⇒ quay về mốc ước lượng.
 */
export function realTimings(tokens: string[], real: { start: number; end: number }[], start: number, end: number): { start: number; end: number }[] {
  const isWord = tokens.map((t) => /[\p{L}\p{N}]/u.test(t))
  if (isWord.filter(Boolean).length !== real.length) return wordTimings(tokens, start, end)
  let k = 0
  let last = start
  return tokens.map((_, i) => {
    if (!isWord[i]) return { start: r3(last), end: r3(last) }
    const w = real[k++]
    last = w.end
    return { start: r3(w.start), end: r3(w.end) }
  })
}

export function chunkWords(words: string[], maxWords: number, maxChars: number): [number, number][] {
  const chunks: [number, number][] = []
  let begin = 0
  let chars = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const count = i - begin
    const nextChars = chars + (count > 0 ? 1 : 0) + w.length
    if (count > 0 && (count >= maxWords || nextChars > maxChars)) {
      chunks.push([begin, i])
      begin = i
      chars = w.length
    } else {
      chars = nextChars
    }
    const endsPhrase = /[,.!?…;:"”]$/.test(w)
    const len = i - begin + 1
    if (endsPhrase && len >= Math.max(2, Math.ceil(maxWords / 2)) && i < words.length - 1) {
      chunks.push([begin, i + 1])
      begin = i + 1
      chars = 0
    }
  }
  if (begin < words.length) chunks.push([begin, words.length])
  return chunks
}

/** Đánh dấu từ thuộc thuật ngữ (hỗ trợ cụm nhiều từ như "cây đa") */
export function markGlossaryWords(
  words: string[],
  glossary: PronunciationEntry[]
): { emphasis: boolean[]; termIds: string[] } {
  const keys = words.map(bare)
  const emphasis = words.map(() => false)
  const termIds = new Set<string>()
  const terms = glossary
    .filter((g) => g.glossEn)
    .map((g) => ({ id: g.id, parts: tokenize(g.term).map(bare) }))
    .sort((a, b) => b.parts.length - a.parts.length)
  for (let i = 0; i < keys.length; i++) {
    for (const t of terms) {
      if (t.parts.length === 0 || i + t.parts.length > keys.length) continue
      if (t.parts.every((p, k) => keys[i + k] === p)) {
        for (let k = 0; k < t.parts.length; k++) emphasis[i + k] = true
        termIds.add(t.id)
      }
    }
  }
  return { emphasis, termIds: [...termIds] }
}

export function buildSubtitles(
  lines: SubtitleLineInput[],
  glossary: PronunciationEntry[],
  style: SubtitleStyle
): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const line of lines) {
    const words = tokenize(line.text)
    if (words.length === 0) continue
    const timings = line.words?.length ? realTimings(words, line.words, line.start, line.end) : wordTimings(words, line.start, line.end)
    const { emphasis } = markGlossaryWords(words, glossary)
    for (const [a, b] of chunkWords(words, style.maxWordsPerCue, style.maxCharsPerCue)) {
      const cueWords: SubtitleWord[] = []
      for (let i = a; i < b; i++) {
        cueWords.push({ text: words[i], start: timings[i].start, end: timings[i].end, emphasis: emphasis[i] })
      }
      const ids = markGlossaryWords(words.slice(a, b), glossary).termIds
      cues.push({
        id: `${line.id}-c${cues.length + 1}`,
        start: cueWords[0].start,
        end: cueWords[cueWords.length - 1].end,
        text: cueWords.map((w) => w.text).join(' '),
        words: cueWords,
        glossaryTermIds: ids,
        styleId: style.id
      })
    }
  }
  return cues
}
