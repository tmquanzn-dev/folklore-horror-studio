/**
 * Gói xuất bản (hàm thuần): mô tả YouTube (chapters + chú thích thuật ngữ + nguồn truyền thuyết),
 * chuẩn hoá hashtag/tag, checklist trước khi đăng, nhãn nội dung AI.
 */
import type { Chapter, ChecklistItem, FolkloreEntry, PronunciationEntry, Release } from '../types'

export function fmtTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** YouTube yêu cầu chapter đầu 0:00, ≥ 3 chapter, mỗi chapter ≥ 10 giây */
export function validChapters(chapters: Chapter[]): Chapter[] {
  const out: Chapter[] = []
  for (const c of [...chapters].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1]
    if (prev && c.start - prev.start < 10) continue
    out.push(out.length === 0 ? { ...c, start: 0 } : c)
  }
  return out.length >= 3 ? out : []
}

export function buildYoutubeDescription(args: {
  intro: string
  chapters: Chapter[]
  glossary: PronunciationEntry[]
  folklore: FolkloreEntry[]
  fictionNote: string
  language: 'en' | 'vi'
}): string {
  const en = args.language === 'en'
  const parts: string[] = [args.intro.trim()]
  const ch = validChapters(args.chapters)
  if (ch.length) parts.push((en ? 'Chapters:\n' : 'Chương:\n') + ch.map((c) => `${fmtTimestamp(c.start)} ${en ? c.title : (c.titleVi ?? c.title)}`).join('\n'))
  const gl = args.glossary.filter((g) => g.glossEn)
  if (gl.length && en) parts.push('Vietnamese terms:\n' + gl.map((g) => `• ${g.term} – ${g.glossEn}`).join('\n'))
  if (args.folklore.length) {
    const lines = args.folklore.map((f) => {
      const kind = f.isDocumentedFolklore ? (en ? 'documented Vietnamese folk belief' : 'tín ngưỡng dân gian có ghi nhận') : en ? "channel's fiction" : 'hư cấu của kênh'
      const src = f.sources.filter((s) => s.trim() && !s.startsWith('(')).join('; ')
      return `• ${en ? f.nameEn : f.nameVi}: ${kind}${src ? ` (${en ? 'sources' : 'nguồn'}: ${src})` : ''}`
    })
    parts.push((en ? 'About the legend:\n' : 'Về truyền thuyết:\n') + lines.join('\n'))
  }
  if (args.fictionNote.trim()) parts.push(en ? `Note: the village, characters and events in this story are fictional.` : `Lưu ý: ${args.fictionNote.trim()}`)
  parts.push(en ? 'Narration voice and illustrations are AI-assisted.' : 'Giọng đọc và hình minh hoạ có sử dụng AI.')
  return parts.join('\n\n')
}

/** Hashtag: bỏ dấu cách, thêm #, bỏ trùng, tối đa max */
export function normalizeHashtags(tags: string[], max = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const clean = t.trim().replace(/^#+/, '').replace(/\s+/g, '')
    if (!clean) continue
    const key = clean.toLocaleLowerCase('vi')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(`#${clean}`)
    if (out.length >= max) break
  }
  return out
}

/** Tag YouTube: tổng ≤ 500 ký tự, bỏ trùng */
export function normalizeTags(tags: string[], maxChars = 480): string[] {
  const out: string[] = []
  let total = 0
  for (const t of tags.map((x) => x.trim().replace(/^#/, '')).filter(Boolean)) {
    if (out.some((o) => o.toLowerCase() === t.toLowerCase())) continue
    if (total + t.length + 1 > maxChars) break
    out.push(t)
    total += t.length + 1
  }
  return out
}

export interface ChecklistFacts {
  voicesAllLicensed: boolean
  usesMockMedia: boolean
  soundAllLicensed: boolean
  hasRender: boolean
  hasThumbnail: boolean
  isSeries: boolean
  partLabelInCaption: boolean
  fictionNoteInDescription: boolean
  hasDescriptionOrCaption: boolean
}

/** Checklist trước khi đăng. Mục auto do app tự tính; mục tay giữ trạng thái người dùng đã tick. */
export function buildChecklist(f: ChecklistFacts, previous: ChecklistItem[] = []): ChecklistItem[] {
  const manual = (id: string): boolean => previous.find((p) => p.id === id)?.done ?? false
  const items: ChecklistItem[] = [
    { id: 'no-mock', labelVi: 'Không còn giọng Mock / ảnh placeholder / clip giả lập', done: !f.usesMockMedia, auto: true, detail: f.usesMockMedia ? 'Tắt Chế độ Mock và tạo lại media thật trước khi đăng' : undefined },
    { id: 'voice-license', labelVi: 'Giấy phép thương mại của giọng AI đã xác nhận', done: f.voicesAllLicensed, auto: true, detail: f.voicesAllLicensed ? undefined : 'Tích "Đã xác nhận giấy phép thương mại" ở Voice Studio sau khi kiểm tra điều khoản provider' },
    { id: 'sound-license', labelVi: 'Nhạc / SFX đều có giấy phép', done: f.soundAllLicensed, auto: true },
    { id: 'render', labelVi: 'Đã render video bản cuối', done: f.hasRender, auto: true },
    { id: 'thumbnail', labelVi: 'Đã chọn thumbnail / ảnh bìa', done: f.hasThumbnail, auto: true },
    { id: 'description', labelVi: 'Có tiêu đề / mô tả / caption', done: f.hasDescriptionOrCaption, auto: true },
    { id: 'fiction-note', labelVi: 'Mô tả nêu rõ phần truyền thuyết thật và phần hư cấu', done: f.fictionNoteInDescription, auto: true }
  ]
  if (f.isSeries) items.push({ id: 'part-label', labelVi: 'Nhãn "Phần X/N" có trên video và caption', done: f.partLabelInCaption, auto: true })
  items.push(
    { id: 'ai-label', labelVi: 'Bật nhãn nội dung AI khi đăng (YouTube: "Altered or synthetic content" · TikTok: "AI-generated content")', done: manual('ai-label') },
    { id: 'spelling', labelVi: 'Đã soát chính tả phụ đề và tên riêng tiếng Việt', done: manual('spelling') },
    { id: 'respect', labelVi: 'Đã xem lại: không chế giễu tín ngưỡng, không gắn với người thật / bi kịch có thật', done: manual('respect') }
  )
  return items
}

/** Video dùng giọng/ảnh/video AI trông như thật ⇒ cần khai báo nội dung AI */
export function aiDisclosureNeeded(release: Release): boolean {
  return release.voiceTrack?.mode !== 'recorded' || release.scenes.length > 0
}
