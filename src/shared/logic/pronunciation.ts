/**
 * Áp từ điển phát âm: thay thuật ngữ bằng cách đọc (ttsRespelling) CHỈ trong văn bản gửi TTS.
 * Văn bản hiển thị (kịch bản, phụ đề) giữ nguyên.
 */
import type { Language, PronunciationEntry } from '../types'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const normKey = (s: string): string => s.normalize('NFC').toLocaleLowerCase('vi')

/**
 * Regex khớp nguyên cụm từ, ranh giới theo chữ cái Unicode (để "đò" không khớp trong "đòn").
 * Ghép tất cả thuật ngữ thành một regex duy nhất, cụm dài ưu tiên trước → thay một lượt,
 * tránh trường hợp thay xong rồi bị thay tiếp lần nữa.
 */
function buildTermsRegex(terms: string[]): RegExp | null {
  const cleaned = [...new Set(terms.map((t) => t.normalize('NFC').trim()).filter((t) => t.length > 0))]
  if (cleaned.length === 0) return null
  cleaned.sort((a, b) => b.length - a.length)
  const alternation = cleaned.map(escapeRegExp).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alternation})(?![\\p{L}\\p{N}])`, 'giu')
}

export interface PronunciationResult {
  text: string
  appliedIds: string[]
}

export function applyPronunciation(
  text: string,
  entries: PronunciationEntry[],
  language: Language
): PronunciationResult {
  const relevant = entries.filter((e) => e.language === language && e.term.trim().length > 0)
  const source = text.normalize('NFC')
  const re = buildTermsRegex(relevant.map((e) => e.term))
  if (!re) return { text: source, appliedIds: [] }
  const byKey = new Map(relevant.map((e) => [normKey(e.term), e]))
  const applied = new Set<string>()
  const out = source.replace(re, (match: string) => {
    const entry = byKey.get(normKey(match))
    if (!entry) return match
    applied.add(entry.id)
    return entry.ttsRespelling
  })
  return { text: out, appliedIds: [...applied] }
}

/** Tìm id các thuật ngữ xuất hiện trong câu (dùng gắn glossaryTermIds cho ScriptLine) */
export function findTermIds(text: string, entries: PronunciationEntry[], language: Language): string[] {
  return applyPronunciation(text, entries, language).appliedIds
}
