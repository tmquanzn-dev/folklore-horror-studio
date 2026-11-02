/**
 * Chọn giọng cho câu: người nói là nhân vật có giọng riêng theo ngôn ngữ ⇒ dùng giọng đó;
 * không có ⇒ giọng mặc định của kênh cho ngôn ngữ đó (người kể).
 */
import type { ChannelPreset, Character, Language, Library, VoiceProfile } from '../types'

export function resolveVoiceId(
  speakerId: string,
  language: Language,
  characters: Character[],
  channel: ChannelPreset | undefined
): string | null {
  const ch = characters.find((c) => c.id === speakerId)
  return ch?.voiceProfileIdByLanguage[language] ?? channel?.defaultVoiceByLanguage[language] ?? null
}

export function resolveVoice(
  speakerId: string,
  language: Language,
  library: Library,
  channelPresetId: string
): VoiceProfile | null {
  const channel = library.channelPresets.find((c) => c.id === channelPresetId)
  const id = resolveVoiceId(speakerId, language, library.characters, channel)
  return library.voiceProfiles.find((v) => v.id === id) ?? null
}

const RE = {
  ghost: /ghost|whisper|drown|ma da|thì thầm|\bma\b|hồn/i,
  old: /\bold\b|elder|grand|\bbà\b|\bông\b|\bcụ\b|khàn/i,
  young: /young|teen|thiếu|cô gái|chàng|\b1\d\b/i,
  female: /female|woman|girl|\bbà\b|\bcô\b|chị|thiếu nữ|-f\b/i,
  male: /\bmale\b|\bman\b|\bông\b|\banh\b|chàng|-m\b/i
}

/**
 * Gợi ý giọng cho nhân vật mới theo vai (thực thể), tuổi, giới tính – chấm điểm theo từ khoá trong tên/chỉ dẫn giọng.
 * Không gán giọng rõ ràng khác giới. Không chắc ⇒ null (dùng giọng mặc định kênh, người dùng tự chọn).
 */
export function suggestVoiceId(c: Character, voices: VoiceProfile[], language: Language, excludeIds: Set<string>): string | null {
  let best: { id: string; score: number } | null = null
  for (const v of voices) {
    if (v.language !== language || excludeIds.has(v.id)) continue
    const t = `${v.name} ${v.baseInstructions} ${v.providerVoiceId}`
    const isGhost = RE.ghost.test(t)
    const isFemale = RE.female.test(t)
    const isMale = RE.male.test(t) && !isFemale
    if ((c.gender === 'male' && isFemale) || (c.gender === 'female' && isMale)) continue
    let score = 0
    if (c.role === 'entity') score += isGhost ? 6 : -3
    else if (isGhost) score -= 6
    if (c.age != null && c.age >= 55) score += RE.old.test(t) ? 3 : -1
    if (c.age != null && c.age < 30) score += RE.young.test(t) ? 3 : RE.old.test(t) ? -3 : 0
    if (c.gender === 'female' && isFemale) score += 1
    if (c.gender === 'male' && isMale) score += 1
    if (score > 0 && (!best || score > best.score)) best = { id: v.id, score }
  }
  return best?.id ?? null
}

/** Nhân vật kênh (người kể thương hiệu) */
export function isChannelCharacter(characterId: string, characters: Character[]): boolean {
  return characters.find((c) => c.id === characterId)?.scope === 'channel'
}

/** Nhân vật hiển thị trong một Story: nhân vật kênh + nhân vật thuộc Story đó */
export function charactersForStory(storyId: string, characters: Character[]): Character[] {
  return characters.filter((c) => c.scope === 'channel' || c.storyId === storyId)
}
