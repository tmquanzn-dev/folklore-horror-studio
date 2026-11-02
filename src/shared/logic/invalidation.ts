/**
 * Dữ liệu dùng chung của Story (dàn ý, ngân hàng cảnh, nhân vật) bị thay/sửa ⇒ dữ liệu phụ thuộc của các
 * bản phát hành (kịch bản, cảnh đã gán, ảnh, giọng…) phải được đặt lại cho đúng. Hàm thuần – dùng chung cho
 * main (áp dụng) và renderer (hộp xác nhận nêu trước tác động).
 *
 * LƯU Ý: id do LLM-task sinh là TẤT ĐỊNH (beat b1…bn, cảnh s01…sNN, nhân vật theo tên) ⇒ sau khi đề xuất lại,
 * id cũ thường VẪN TỒN TẠI nhưng trỏ tới nội dung khác. Vì vậy không thể chỉ kiểm tra "id còn không" –
 * phải đặt lại tường minh khi thay dữ liệu dùng chung.
 */
import type { Beat, CastMember, Character, CharacterRole, PipelineState, SceneBankItem } from '../types'

export interface ReleaseView {
  id: string
  title: string
  scenes: { sceneBankId: string }[]
  script: { lines: { speakerId: string; beatId: string }[] }
  pipelineState: PipelineState | null
}

/** Release đã chạy tới (hoặc qua) bước stepNo */
export function reachedStep(r: ReleaseView, stepNo: number): boolean {
  const st = r.pipelineState
  if (!st) return false
  return Object.entries(st.steps).some(([no, s]) => Number(no) >= stepNo && s.status !== 'pending')
}

// ============================================================================ Ngân hàng cảnh

export interface BankReplaceImpact {
  imagesLost: number
  /** Release sẽ bị xoá cảnh đã gán + chạy lại từ bước 6 */
  releases: string[]
}

export function sceneBankReplaceImpact(bank: SceneBankItem[], releases: ReleaseView[]): BankReplaceImpact {
  return {
    imagesLost: bank.filter((s) => s.media['16:9'] || s.media['9:16']).length,
    releases: releases.filter((r) => r.scenes.length > 0 || reachedStep(r, 6)).map((r) => r.title)
  }
}

// ============================================================================ Dàn ý

export interface BeatEditImpact {
  removed: string[]
  added: string[]
  reordered: boolean
  intensityChanged: string[]
  /** Bước release phải chạy lại (null = không ảnh hưởng release) */
  resetFrom: number | null
  /** Câu kịch bản thuộc beat đã xoá (theo release) */
  orphanLines: number
  /** Cảnh ngân hàng thuộc beat đã xoá */
  orphanScenes: number
}

/**
 * Sửa beat trong dàn ý:
 * - thêm / xoá / đổi thứ tự beat ⇒ khớp cảnh theo beat sai ⇒ chạy lại từ bước 14
 * - chỉ đổi cường độ cảm xúc ⇒ cảnh hero, chuyển động, âm thanh, teaser dựa vào cường độ ⇒ từ bước 16
 * - chỉ sửa chữ (tóm tắt, ghi chú) ⇒ không ảnh hưởng release
 */
export function beatEditImpact(oldBeats: Beat[], newBeats: Beat[], releases: ReleaseView[], bank: SceneBankItem[]): BeatEditImpact {
  const oldIds = oldBeats.map((b) => b.id)
  const newIds = newBeats.map((b) => b.id)
  const removed = oldIds.filter((id) => !newIds.includes(id))
  const added = newIds.filter((id) => !oldIds.includes(id))
  const common = newIds.filter((id) => oldIds.includes(id))
  const reordered = common.join('|') !== oldIds.filter((id) => newIds.includes(id)).join('|')
  const oldById = new Map(oldBeats.map((b) => [b.id, b]))
  const intensityChanged = newBeats.filter((b) => {
    const o = oldById.get(b.id)
    return o && Math.abs(o.emotionalIntensity - b.emotionalIntensity) > 1e-6
  }).map((b) => b.id)
  const structural = removed.length > 0 || added.length > 0 || reordered
  const resetFrom = structural ? 14 : intensityChanged.length ? 16 : null
  const gone = new Set(removed)
  return {
    removed,
    added,
    reordered,
    intensityChanged,
    resetFrom,
    orphanLines: releases.reduce((n, r) => n + r.script.lines.filter((l) => gone.has(l.beatId)).length, 0),
    orphanScenes: bank.filter((s) => gone.has(s.beatId)).length
  }
}

// ============================================================================ Nhân vật

/**
 * Nhân vật cũ (bị thay) → nhân vật mới cùng vai trò, theo thứ tự xuất hiện. Không còn nhân vật mới cùng vai ⇒ null.
 * Nhân vật mới trùng id với nhân vật cũ (cùng tên) ⇒ giữ nguyên (không cần ánh xạ).
 */
export function remapCast(removed: Character[], created: Character[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const createdIds = new Set(created.map((c) => c.id))
  const pool = new Map<CharacterRole, Character[]>()
  for (const c of created) {
    if (removed.some((r) => r.id === c.id)) continue
    pool.set(c.role, [...(pool.get(c.role) ?? []), c])
  }
  for (const r of removed) {
    if (createdIds.has(r.id)) continue
    const next = pool.get(r.role)?.shift()
    map.set(r.id, next ? next.id : null)
  }
  return map
}

/** Áp ánh xạ nhân vật lên cast của ngân hàng cảnh; trả về id các cảnh có cast đổi (ảnh cũ vẽ nhân vật cũ) */
export function applyCastRemap(bank: SceneBankItem[], map: Map<string, string | null>): { bank: SceneBankItem[]; changedScenes: string[] } {
  const changed: string[] = []
  const out = bank.map((s) => {
    if (!s.cast.some((m) => map.has(m.characterId))) return s
    changed.push(s.id)
    const cast: CastMember[] = []
    for (const m of s.cast) {
      if (!map.has(m.characterId)) cast.push(m)
      else {
        const to = map.get(m.characterId)
        // Trạng thái ngoại hình gắn với nhân vật cũ ⇒ bỏ
        if (to && !cast.some((x) => x.characterId === to)) cast.push({ ...m, characterId: to, stateId: null })
      }
    }
    return { ...s, cast }
  })
  return { bank: out, changedScenes: changed }
}

export interface CastReplaceImpact {
  /** Nhân vật cũ đổi sang nhân vật mới cùng vai / bị bỏ */
  remapped: number
  dropped: number
  scenesRedraw: number
  linesRespeaker: number
}

export function castReplaceImpact(map: Map<string, string | null>, bank: SceneBankItem[], releases: ReleaseView[]): CastReplaceImpact {
  const ids = new Set(map.keys())
  return {
    remapped: [...map.values()].filter(Boolean).length,
    dropped: [...map.values()].filter((v) => !v).length,
    scenesRedraw: bank.filter((s) => s.cast.some((m) => ids.has(m.characterId))).length,
    linesRespeaker: releases.reduce((n, r) => n + r.script.lines.filter((l) => ids.has(l.speakerId)).length, 0)
  }
}

/** Xoá ảnh và mọi thứ dựng từ ảnh của một cảnh (bản 9:16, depth, parallax, clip AI, biến thể, kiểm tra đồng nhất) */
export function clearSceneMedia(s: SceneBankItem): SceneBankItem {
  return {
    ...s,
    media: { '16:9': null, '9:16': null },
    heroClip: { '16:9': null, '9:16': null },
    depthMapPath: null,
    parallax: {},
    variants: [],
    consistency: null,
    approval: { status: 'pending' }
  }
}
