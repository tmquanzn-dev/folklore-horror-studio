/**
 * Câu hỏi xác nhận trước khi thay dữ liệu dùng chung của Story – nêu cụ thể tác động lên các bản phát hành.
 * Trả về undefined khi không có gì bị ảnh hưởng (không cần hỏi).
 */
import { beatEditImpact, reachedStep, sceneBankReplaceImpact } from '../../../shared/logic/invalidation'
import type { Beat, Character, Release, Story } from '../../../shared/types'

const list = (names: string[]): string => (names.length > 3 ? `${names.slice(0, 3).join(', ')} và ${names.length - 3} bản khác` : names.join(', '))

export function sceneBankConfirm(story: Story, releases: Release[]): string | undefined {
  if (!story.sceneBank.length) return undefined
  const i = sceneBankReplaceImpact(story.sceneBank, releases)
  return [
    `Đề xuất lại sẽ THAY toàn bộ ${story.sceneBank.length} cảnh trong ngân hàng.`,
    i.imagesLost ? `${i.imagesLost} cảnh đã có ảnh – ảnh cũ không còn được dùng.` : '',
    i.releases.length ? `Cảnh đã gán của ${list(i.releases)} sẽ bị xoá, các bản này chạy lại từ bước 6 (tạo ảnh, gán cảnh).` : '',
    'Tiếp tục?'
  ].filter(Boolean).join(' ')
}

export function outlineRegenerateConfirm(story: Story, releases: Release[]): string | undefined {
  if (!story.outline.beats.length) return undefined
  const withScript = releases.filter((r) => r.script.lines.length > 0 || r.scenes.length > 0).map((r) => r.title)
  return [
    'Tạo lại dàn ý sẽ thay dàn ý hiện tại (cần duyệt lại).',
    story.sceneBank.length ? `Ngân hàng cảnh (${story.sceneBank.length} cảnh) dựng theo dàn ý cũ sẽ bị bỏ – phải đề xuất lại.` : '',
    withScript.length ? `Kịch bản, giọng và cảnh của ${list(withScript)} sẽ bị xoá để chuyển thể lại từ dàn ý mới.` : '',
    'Tiếp tục?'
  ].filter(Boolean).join(' ')
}

export function beatEditConfirm(story: Story, newBeats: Beat[], releases: Release[]): string | undefined {
  const i = beatEditImpact(story.outline.beats, newBeats, releases, story.sceneBank)
  if (i.resetFrom == null) return undefined
  const affected = releases.filter((r) => reachedStep(r, i.resetFrom as number)).map((r) => r.title)
  if (!affected.length && !i.orphanLines) return undefined
  const what = i.removed.length || i.added.length || i.reordered ? 'Thêm/xoá/đổi thứ tự beat làm việc gán cảnh theo beat thay đổi.' : 'Đổi cường độ cảm xúc ảnh hưởng cảnh hero, chuyển động, âm thanh.'
  return [
    what,
    affected.length ? `${list(affected)} sẽ chạy lại từ bước ${i.resetFrom}.` : '',
    i.orphanLines ? `${i.orphanLines} câu kịch bản thuộc beat bị xoá – nên chuyển thể lại.` : '',
    'Lưu?'
  ].filter(Boolean).join(' ')
}

export function castConfirm(story: Story, storyChars: Character[], releases: Release[]): string | undefined {
  const unlocked = storyChars.filter((c) => !c.locked)
  if (!unlocked.length) return undefined
  const ids = new Set(unlocked.map((c) => c.id))
  const scenes = story.sceneBank.filter((s) => s.cast.some((m) => ids.has(m.characterId)) && (s.media['16:9'] || s.media['9:16'])).length
  const lines = releases.reduce((n, r) => n + r.script.lines.filter((l) => ids.has(l.speakerId)).length, 0)
  return [
    `Đề xuất lại sẽ thay ${unlocked.length} nhân vật truyện CHƯA khoá (${unlocked.map((c) => c.name).join(', ')}).`,
    'Nhân vật mới cùng vai thế chỗ nhân vật cũ (tên khác thì ảnh và giọng phải tạo lại).',
    scenes ? `Tối đa ${scenes} cảnh có ảnh vẽ các nhân vật này sẽ phải vẽ lại (chạy lại từ bước 6).` : '',
    lines ? `${lines} câu thoại của họ chuyển sang nhân vật mới (tạo lại giọng).` : '',
    'Khoá nhân vật ưng ý trước để giữ nguyên. Tiếp tục?'
  ].filter(Boolean).join(' ')
}
