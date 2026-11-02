/**
 * Xuất CapCut theo "template mode" (hàm thuần – có unit test).
 *
 * Người dùng tự làm 1 draft MẪU trong CapCut có: 1 ảnh trên track video, 1 file âm thanh trên track audio,
 * 1 dòng chữ trên track text (đã chỉnh font/màu/vị trí/animation theo ý). App đọc draft_content.json của mẫu,
 * NHÂN BẢN đoạn mẫu cho từng cảnh / từng cụm phụ đề (giữ nguyên style, transform, animation của mẫu)
 * và ghi ra một draft mới. App không tự "đoán" định dạng CapCut từ đầu.
 *
 * CapCut bản mới có thể MÃ HOÁ draft_content.json ⇒ không phải JSON ⇒ báo lỗi rõ ràng, KHÔNG cố giải mã.
 * Đơn vị thời gian của CapCut: micro giây.
 */

export class CapcutTemplateError extends Error {}

type Json = Record<string, unknown>
type Segment = Json & { id: string; material_id: string; extra_material_refs?: string[]; target_timerange?: { start: number; duration: number }; source_timerange?: { start: number; duration: number } | null }
type Track = Json & { id: string; type: string; segments: Segment[] }

export interface CapcutTimeline {
  width: number
  height: number
  fps: number
  totalSec: number
  /** Ảnh/clip theo cảnh – path tuyệt đối */
  visuals: { path: string; kind: 'image' | 'video'; start: number; end: number; width?: number; height?: number; name: string }[]
  /** Bản mix (giọng + âm thanh) – path tuyệt đối */
  audio: { path: string; durationSec: number; name: string } | null
  captions: { start: number; end: number; text: string }[]
}

export interface CapcutResult {
  draft: Json
  warnings: string[]
}

const US = 1_000_000
const us = (sec: number): number => Math.max(0, Math.round(sec * US))

/** Đọc nội dung draft: không phải JSON ⇒ lỗi rõ ràng (CapCut bản mới mã hoá draft) */
export function parseCapcutDraft(text: string, fileName = 'draft_content.json'): Json {
  const t = text.replace(/^﻿/, '').trim()
  if (!t.startsWith('{')) {
    throw new CapcutTemplateError(
      `${fileName} của draft mẫu không phải JSON đọc được (CapCut bản mới đã mã hoá file draft). App không giải mã file này. ` +
        'Cách xử lý: tạo draft mẫu bằng bản CapCut còn lưu draft dạng JSON, hoặc dùng "Xuất FCPXML" / "Xuất SRT" để dựng trong DaVinci Resolve / Final Cut.'
    )
  }
  try {
    const j = JSON.parse(t) as unknown
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('không phải object')
    return j as Json
  } catch (e) {
    throw new CapcutTemplateError(`${fileName} của draft mẫu hỏng hoặc không phải JSON (${e instanceof Error ? e.message : String(e)}).`)
  }
}

/** Đường dẫn kiểu CapCut trên Windows: dấu gạch chéo xuôi */
export const capcutPath = (p: string): string => p.replace(/\\/g, '/')

function materialsOf(draft: Json): Record<string, Json[]> {
  const m = draft['materials']
  if (!m || typeof m !== 'object') throw new CapcutTemplateError('Draft mẫu không có "materials" – không đúng cấu trúc draft CapCut')
  return m as Record<string, Json[]>
}

function findMaterial(mats: Record<string, Json[]>, id: string): { key: string; item: Json } | null {
  for (const [key, arr] of Object.entries(mats)) {
    if (!Array.isArray(arr)) continue
    const item = arr.find((x) => x && (x as Json)['id'] === id)
    if (item) return { key, item }
  }
  return null
}

/** Đổi nội dung chữ của material text, giữ style của mẫu */
export function setTextContent(mat: Json, text: string): boolean {
  const content = mat['content']
  if (typeof content === 'string') {
    if (content.trim().startsWith('{')) {
      try {
        const c = JSON.parse(content) as { text?: string; styles?: (Json & { range?: number[] })[] }
        if (typeof c.text === 'string') {
          c.text = text
          if (Array.isArray(c.styles) && c.styles.length) c.styles = [{ ...c.styles[0], range: [0, text.length] }]
          mat['content'] = JSON.stringify(c)
          if (mat['words'] && typeof mat['words'] === 'object') mat['words'] = { start_time: [], end_time: [], text: [] }
          return true
        }
      } catch {
        /* rơi xuống dạng thẻ */
      }
    }
    // Bản cũ: <font ...>[Nội dung]</font>
    if (/\[[^\]]*\]/.test(content)) {
      mat['content'] = content.replace(/\[[^\]]*\]/, `[${text.replace(/[[\]]/g, '')}]`)
      return true
    }
  }
  return false
}

export function fillCapcutTemplate(template: Json, t: CapcutTimeline, newId: () => string): CapcutResult {
  const draft = structuredClone(template)
  const warnings: string[] = []
  const mats = materialsOf(draft)
  const tracks = draft['tracks']
  if (!Array.isArray(tracks)) throw new CapcutTemplateError('Draft mẫu không có "tracks"')
  const trackOf = (type: string): Track | undefined => (tracks as Track[]).find((x) => x && x.type === type && Array.isArray(x.segments) && x.segments.length > 0)

  const vTrack = trackOf('video')
  if (!vTrack) throw new CapcutTemplateError('Draft mẫu cần ít nhất 1 ảnh hoặc video trên track hình (kéo 1 ảnh bất kỳ vào timeline rồi lưu)')
  const aTrack = trackOf('audio')
  const tTrack = trackOf('text')
  if (!aTrack) warnings.push('Draft mẫu không có track âm thanh – draft xuất ra sẽ không có tiếng (thêm 1 file nhạc bất kỳ vào mẫu để sửa)')
  if (!tTrack && t.captions.length) warnings.push('Draft mẫu không có dòng chữ – bỏ qua phụ đề (thêm 1 text vào mẫu để có phụ đề cùng kiểu chữ)')

  const replaced = new Set<string>()
  const rebuild = (track: Track, items: { material: (m: Json) => void; start: number; end: number; source?: number }[]): void => {
    const proto = track.segments[0]
    for (const s of track.segments) {
      replaced.add(s.material_id)
      for (const r of s.extra_material_refs ?? []) replaced.add(r)
    }
    const protoMat = findMaterial(mats, proto.material_id)
    if (!protoMat) throw new CapcutTemplateError(`Không tìm thấy material ${proto.material_id} của đoạn mẫu trên track ${track.type}`)
    track.segments = items.map((it) => {
      const mat = structuredClone(protoMat.item)
      mat['id'] = newId()
      it.material(mat)
      mats[protoMat.key].push(mat)
      const seg = structuredClone(proto)
      seg.id = newId()
      seg.material_id = mat['id'] as string
      seg.extra_material_refs = (proto.extra_material_refs ?? []).map((ref) => {
        const found = findMaterial(mats, ref)
        if (!found) return ref
        const copy = structuredClone(found.item)
        copy['id'] = newId()
        mats[found.key].push(copy)
        return copy['id'] as string
      })
      seg.target_timerange = { start: us(it.start), duration: Math.max(1, us(it.end) - us(it.start)) }
      if ('source_timerange' in proto) seg.source_timerange = proto.source_timerange === null && track.type === 'text' ? null : { start: us(it.source ?? 0), duration: Math.max(1, us(it.end) - us(it.start)) }
      return seg
    })
  }

  rebuild(
    vTrack,
    t.visuals.map((v) => ({
      start: v.start,
      end: v.end,
      material: (m) => {
        m['path'] = capcutPath(v.path)
        m['material_name'] = v.name
        m['type'] = v.kind === 'image' ? 'photo' : 'video'
        // Ảnh tĩnh: CapCut đặt thời lượng nguồn rất dài (3 giờ); video: thời lượng thật của đoạn dùng
        m['duration'] = v.kind === 'image' ? 10_800_000_000 : us(v.end - v.start)
        if (v.width) m['width'] = v.width
        if (v.height) m['height'] = v.height
      }
    }))
  )
  if (aTrack && t.audio) {
    const a = t.audio
    rebuild(aTrack, [
      {
        start: 0,
        end: Math.min(t.totalSec, a.durationSec),
        material: (m) => {
          m['path'] = capcutPath(a.path)
          m['name'] = a.name
          m['duration'] = us(a.durationSec)
        }
      }
    ])
  }
  if (tTrack && t.captions.length) {
    let ok = true
    rebuild(
      tTrack,
      t.captions.map((c) => ({
        start: c.start,
        end: c.end,
        material: (m) => {
          if (!setTextContent(m, c.text.replace(/\n/g, ' '))) ok = false
        }
      }))
    )
    if (!ok) warnings.push('Không nhận ra định dạng nội dung chữ của mẫu – phụ đề có thể hiện chữ của mẫu thay vì lời thoại')
  }

  // Dọn material của đoạn mẫu cũ không còn ai dùng
  const used = new Set<string>()
  for (const tr of tracks as Track[]) for (const s of tr.segments ?? []) {
    used.add(s.material_id)
    for (const r of s.extra_material_refs ?? []) used.add(r)
  }
  for (const key of Object.keys(mats)) {
    if (Array.isArray(mats[key])) mats[key] = mats[key].filter((x) => !(replaced.has(x['id'] as string) && !used.has(x['id'] as string)))
  }

  const others = (tracks as Track[]).filter((x) => x !== vTrack && x !== aTrack && x !== tTrack && x.segments?.length)
  if (others.length) warnings.push(`Giữ nguyên ${others.length} track khác của mẫu (sticker/hiệu ứng) – kiểm tra lại thời lượng`)

  draft['id'] = newId()
  draft['duration'] = us(t.totalSec)
  draft['fps'] = t.fps
  const canvas = (draft['canvas_config'] as Json | undefined) ?? {}
  draft['canvas_config'] = { ...canvas, width: t.width, height: t.height, ratio: t.width > t.height ? '16:9' : '9:16' }
  return { draft, warnings }
}

/** Cập nhật draft_meta_info.json (tên, id, đường dẫn) – thiếu trường nào bỏ qua trường đó */
export function updateCapcutMeta(meta: Json, o: { id: string; name: string; folder: string; root: string; durationSec: number; nowUs: number }): Json {
  const m = structuredClone(meta)
  m['draft_id'] = o.id
  m['draft_name'] = o.name
  m['draft_fold_path'] = capcutPath(o.folder)
  m['draft_root_path'] = capcutPath(o.root)
  m['tm_duration'] = us(o.durationSec)
  m['tm_draft_create'] = o.nowUs
  m['tm_draft_modified'] = o.nowUs
  return m
}
