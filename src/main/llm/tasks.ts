/**
 * CÁC TÁC VỤ LLM: prompt + schema zod + kiểm tra tham chiếu (beatId, speakerId, characterId…) + output Mock.
 * Mọi output LLM đều là JSON, sai schema ⇒ ném lỗi ⇒ adapter gửi lỗi lại cho model và thử lại.
 * Nguyên tắc nội dung (văn hoá, thân thiện quảng cáo, thật/hư cấu) được nhúng vào system prompt.
 */
import { z } from 'zod'
import { platformsConfig, providersConfig } from '../../shared/config'
import type {
  Beat,
  ChannelPreset,
  Character,
  FolkloreEntry,
  Language,
  Platform,
  PronunciationEntry,
  SceneBankItem,
  ScriptSectionKind,
  ShotType,
  Story
} from '../../shared/types'
import type { LlmJsonRequest } from '../providers/interfaces'
import { designSoundCues, validateCues, type DesignInput } from '../../shared/logic/soundDesign'
import type { SoundCue } from '../../shared/types'

const SHOTS = ['wide', 'medium', 'closeUp', 'overShoulder', 'topDown', 'insert'] as const
const KINDS = ['hook', 'coldOpen', 'context', 'story', 'folkloreExplainer', 'cliffhanger', 'outro'] as const
const POSITIONS = ['left', 'center', 'right', 'background'] as const

export const PRINCIPLES = `You write for a YouTube/TikTok channel telling Vietnamese & Southeast Asian folk horror stories.
Hard rules:
- Respect beliefs: never mock religion, rituals, ancestors or folk practices.
- Clearly separate documented folklore from the channel's fiction. Never attach stories to real people, recent real tragedies or real specific places in a misleading way; use fictional village names.
- Advertiser-friendly horror: dread through atmosphere, darkness, sound, suggestion. No gore, no blood detail, no graphic violence, no self-harm detail.
- Visual culture is Vietnamese (Mekong delta / northern villages, stilt houses, altars, incense, áo bà ba, banyan trees, oil lamps). Never Japanese/Chinese architecture, torii, kimono.
- Keep Vietnamese folklore terms in Vietnamese with diacritics (ma da, cây đa…).`

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'x'
  )
}

function folkloreBlock(folklore: FolkloreEntry[]): string {
  return folklore
    .map(
      (f) =>
        `- ${f.nameVi} / ${f.nameEn} (${f.region}) – ${f.isDocumentedFolklore ? 'documented folklore' : 'channel fiction'}\n  ${f.summaryEn}\n  Fixed visual design: ${f.visualDesign}`
    )
    .join('\n')
}

function characterBlock(chars: Character[]): string {
  return chars
    .map(
      (c) =>
        `- id="${c.id}" | ${c.name} | role=${c.role} | scope=${c.scope}${c.age ? ` | age ${c.age}` : ''} | ${c.appearance} | outfit: ${c.defaultOutfit}` +
        (c.states.length ? ` | states: ${c.states.map((s) => `${s.id}="${s.name}"`).join(', ')}` : '')
    )
    .join('\n')
}

function beatBlock(beats: Beat[]): string {
  return beats
    .map((b) => `- beatId="${b.id}" order=${b.order} intensity=${b.emotionalIntensity}: ${b.summaryEn} / ${b.summaryVi}`)
    .join('\n')
}

// ============================================================================
// 1. DÀN Ý THEO BEAT (song ngữ)
// ============================================================================

export const OutlineSchema = z.object({
  fictionNoteVi: z.string().min(10),
  beats: z
    .array(
      z.object({
        summaryVi: z.string().min(5),
        summaryEn: z.string().min(5),
        emotionalIntensity: z.number().min(0).max(1),
        mustShow: z.array(z.string()).max(6)
      })
    )
    .min(5)
    .max(10)
})
export type OutlineOut = z.infer<typeof OutlineSchema>

export function outlineTask(story: Story, folklore: FolkloreEntry[]): LlmJsonRequest<OutlineOut> {
  const name = folklore[0]?.nameVi ?? 'thực thể'
  return {
    task: 'outline',
    system: `${PRINCIPLES}\nYou are a story editor. Build a bilingual beat outline (6–8 beats) for one horror story. Each beat has a Vietnamese and an English summary, an emotionalIntensity 0..1 (rising tension, climax = 1.0, a quiet beat before the climax), and up to 4 concrete things that must be shown on screen. Also write fictionNoteVi: one Vietnamese sentence stating what is documented folklore and what is fiction.`,
    user: `Folklore:\n${folkloreBlock(folklore)}\n\nPremise (Vietnamese): ${story.premiseVi}\n\nReturn JSON: {"fictionNoteVi": string, "beats": [{"summaryVi": string, "summaryEn": string, "emotionalIntensity": number, "mustShow": string[]}]}`,
    parse: (raw) => OutlineSchema.parse(raw),
    mockResponse: () => ({
      fictionNoteVi: `${name} là tín ngưỡng dân gian; ngôi làng, nhân vật và sự kiện trong truyện là hư cấu.`,
      beats: [
        { summaryVi: `Mở đầu: dấu hiệu đầu tiên của ${name} xuất hiện trong đêm.`, summaryEn: `Opening: the first sign of the ${name} appears at night.`, emotionalIntensity: 0.7, mustShow: ['đêm tối', 'đèn dầu'] },
        { summaryVi: `Ngôi làng hư cấu và lời dặn của người già về ${name}.`, summaryEn: `A fictional village and the elders' warning about the ${name}.`, emotionalIntensity: 0.3, mustShow: ['làng quê', 'bàn thờ'] },
        { summaryVi: `Nhân vật chính và nỗi niềm kéo họ vào chuyện: ${story.premiseVi.slice(0, 120)}`, summaryEn: 'The protagonist and what draws them into the story.', emotionalIntensity: 0.5, mustShow: ['nhân vật chính'] },
        { summaryVi: 'Lần chạm trán đầu tiên, điều bất thường leo thang.', summaryEn: 'The first encounter; strange events escalate.', emotionalIntensity: 0.75, mustShow: ['dấu hiệu lạ'] },
        { summaryVi: `Người lớn tuổi giải thích truyền thuyết ${name} và cách đối phó.`, summaryEn: `An elder explains the ${name} legend and how to survive it.`, emotionalIntensity: 0.45, mustShow: ['người già', 'nhang khói'] },
        { summaryVi: 'Cao trào: đối mặt trực tiếp, nhân vật làm đúng lời dặn trong sợ hãi.', summaryEn: 'Climax: a direct confrontation; the protagonist follows the warning in terror.', emotionalIntensity: 1, mustShow: ['khoảnh khắc đối mặt'] },
        { summaryVi: 'Kết treo: tưởng đã yên, nhưng một dấu hiệu nhỏ cho thấy chưa kết thúc.', summaryEn: 'Open ending: it seems over, but a small sign says otherwise.', emotionalIntensity: 0.85, mustShow: ['dấu hiệu cuối'] }
      ]
    })
  }
}

export function toBeats(out: OutlineOut): Beat[] {
  return out.beats.map((b, i) => ({
    id: `b${i + 1}`,
    order: i + 1,
    summaryVi: b.summaryVi,
    summaryEn: b.summaryEn,
    emotionalIntensity: Math.round(b.emotionalIntensity * 100) / 100,
    mustShow: b.mustShow
  }))
}

// ============================================================================
// 2. DÀN NHÂN VẬT TỪ DÀN Ý (bước 3a)
// ============================================================================

export const CastSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.enum(['character', 'entity']),
        age: z.number().int().min(1).max(120).nullable(),
        gender: z.enum(['female', 'male', 'other', 'unknown']),
        appearance: z.string().min(10),
        defaultOutfit: z.string().min(3),
        description: z.string().min(5),
        expressions: z.array(z.string()).max(6),
        states: z.array(z.object({ name: z.string().min(1), description: z.string().min(3) })).max(5)
      })
    )
    .min(1)
    .max(6)
})
export type CastOut = z.infer<typeof CastSchema>

export function castTask(story: Story, folklore: FolkloreEntry[], channelChars: Character[]): LlmJsonRequest<CastOut> {
  const entity = folklore[0]
  return {
    task: 'cast',
    system: `${PRINCIPLES}\nYou are a character designer. From the outline, propose the story's cast: 2–4 human characters (main + supporting) and the supernatural entity (role "entity", based on the folklore's fixed visual design but customised to this story). For each: Vietnamese name, age, gender, appearance (face, body, hair) and default outfit appropriate to the Vietnamese setting and era, a short description, 2–4 key expressions, and appearance states needed by the plot (e.g. "ướt sũng", "bị thương nhẹ", "bị nhập"). Write descriptions in Vietnamese. Do NOT include the channel narrator (already exists).`,
    user: `Folklore:\n${folkloreBlock(folklore)}\n\nChannel characters (do not repeat):\n${characterBlock(channelChars)}\n\nPremise: ${story.premiseVi}\n\nOutline:\n${beatBlock(story.outline.beats)}\n\nReturn JSON: {"characters":[{"name","role","age","gender","appearance","defaultOutfit","description","expressions":[],"states":[{"name","description"}]}]}`,
    parse: (raw) => CastSchema.parse(raw),
    mockResponse: () => ({
      characters: [
        { name: 'Thảo', role: 'character', age: 19, gender: 'female', appearance: 'Cô gái gầy, tóc dài buộc thấp, mắt một mí, da ngăm.', defaultOutfit: 'Áo bà ba trắng, quần đen, nón lá.', description: 'Nhân vật chính, gan dạ nhưng đa nghi.', expressions: ['bình thường', 'sợ hãi', 'quyết tâm'], states: [{ name: 'ướt sũng', description: 'Tóc và áo ướt đẫm.' }] },
        { name: 'Ông Bảy', role: 'character', age: 72, gender: 'male', appearance: 'Ông cụ gầy, râu bạc lưa thưa, lưng hơi còng.', defaultOutfit: 'Áo bà ba nâu, khăn rằn quấn cổ.', description: 'Người già trong xóm, hiểu chuyện tâm linh.', expressions: ['nghiêm', 'lo âu'], states: [] },
        { name: entity ? `${entity.nameVi} của truyện` : 'Thực thể', role: 'entity', age: null, gender: 'unknown', appearance: entity?.visualDesign ?? 'Không lộ toàn thân, chỉ thấy bóng tối và chi tiết nhỏ.', defaultOutfit: 'Không rõ – chìm trong bóng tối.', description: 'Thực thể của truyện, chỉ được gợi qua bóng tối và chi tiết nhỏ.', expressions: [], states: [{ name: 'chỉ thấy bóng', description: 'Chỉ thấy bóng mờ.' }] }
      ]
    })
  }
}

export function toCharacters(out: CastOut, storyId: string, existingIds: Set<string>): Character[] {
  const short = slug(storyId.replace(/^story-/, '')).slice(0, 12)
  return out.characters.map((c) => {
    let id = `char-${short}-${slug(c.name)}`
    let k = 2
    while (existingIds.has(id)) id = `char-${short}-${slug(c.name)}-${k++}`
    existingIds.add(id)
    return {
      id,
      name: c.name,
      role: c.role,
      scope: 'story',
      storyId,
      age: c.age,
      gender: c.gender,
      appearance: c.appearance,
      defaultOutfit: c.defaultOutfit,
      description: c.description,
      referenceImages: [],
      characterSheet: { front: null, threeQuarter: null, profile: null, fullBody: null },
      expressionSheet: c.expressions.map((e) => ({ expression: e, prompt: e, imagePath: null })),
      states: c.states.map((s, i) => ({ id: `st-${slug(c.name)}-${i + 1}`, name: s.name, description: s.description, referenceImage: null })),
      voiceProfileIdByLanguage: {},
      locked: false,
      approval: { status: 'pending' }
    }
  })
}

// ============================================================================
// 3. NGÂN HÀNG CẢNH THEO BEAT (bước 4)
// ============================================================================

const CastMemberSchema = z.object({
  characterId: z.string(),
  stateId: z.string().nullable(),
  expression: z.string(),
  position: z.enum(POSITIONS),
  action: z.string()
})

export const SceneBankSchema = z.object({
  scenes: z
    .array(
      z.object({
        beatId: z.string(),
        description: z.string().min(5),
        shotType: z.enum(SHOTS),
        cameraAngle: z.string(),
        imagePrompt: z.string().min(10),
        focusX: z.number().min(0).max(1),
        focusY: z.number().min(0).max(1),
        needsVerticalVersion: z.boolean(),
        cast: z.array(CastMemberSchema).max(3)
      })
    )
    .min(4)
    .max(40)
})
export type SceneBankOut = z.infer<typeof SceneBankSchema>

export function sceneBankTask(story: Story, chars: Character[], channel: ChannelPreset): LlmJsonRequest<SceneBankOut> {
  const beatIds = new Set(story.outline.beats.map((b) => b.id))
  const byId = new Map(chars.map((c) => [c.id, c]))
  const narrator = chars.find((c) => c.scope === 'channel')
  const parse = (raw: unknown): SceneBankOut => {
    const out = SceneBankSchema.parse(raw)
    for (const [i, s] of out.scenes.entries()) {
      if (!beatIds.has(s.beatId)) throw new Error(`scenes[${i}].beatId "${s.beatId}" không tồn tại`)
      for (const m of s.cast) {
        const c = byId.get(m.characterId)
        if (!c) throw new Error(`scenes[${i}].cast characterId "${m.characterId}" không tồn tại`)
        if (m.stateId && !c.states.some((st) => st.id === m.stateId)) throw new Error(`scenes[${i}] stateId "${m.stateId}" không thuộc ${c.id}`)
      }
    }
    return out
  }
  return {
    task: 'sceneBank',
    system: `${PRINCIPLES}\nYou are a storyboard artist. Propose a scene bank: 2–3 scenes per beat. Diversity rule: vary shotType (wide, medium, closeUp, overShoulder, topDown, insert) and camera angle; never two consecutive scenes with the same shotType. Max 2–3 clearly visible characters per scene (use cast with exact characterId and optional stateId). Frightening entities are suggested through darkness, shadows, small details – never fully shown, no gore. imagePrompt in English describes only the scene action/composition (art style is added later). focusX/focusY (0..1) mark the main subject for vertical cropping. Set needsVerticalVersion=true for key scenes that need a dedicated 9:16 composition. ${narrator ? `Also add exactly 2 scenes of the channel narrator (characterId "${narrator.id}") for intro/transition/outro, attached to the 2nd and last beat.` : ''}`,
    user: `Visual bible: ${channel.culturalVisualBible.join('; ')}\n\nCharacters:\n${characterBlock(chars)}\n\nOutline:\n${beatBlock(story.outline.beats)}\n\nReturn JSON: {"scenes":[{"beatId","description" (Vietnamese),"shotType","cameraAngle","imagePrompt","focusX","focusY","needsVerticalVersion","cast":[{"characterId","stateId","expression","position","action"}]}]}`,
    parse,
    mockResponse: () => {
      const story_chars = chars.filter((c) => c.scope === 'story')
      const human = story_chars.find((c) => c.role === 'character')
      const entity = story_chars.find((c) => c.role === 'entity')
      const scenes: unknown[] = []
      let k = 0
      for (const b of story.outline.beats) {
        for (let j = 0; j < 2; j++) {
          const shot = SHOTS[k % SHOTS.length]
          const who = j === 0 ? human : b.emotionalIntensity >= 0.7 ? entity : undefined
          scenes.push({
            beatId: b.id,
            description: `${j === 0 ? 'Cảnh chính' : 'Cảnh phụ'} – ${b.summaryVi.slice(0, 80)}`,
            shotType: shot,
            cameraAngle: j === 0 ? 'eye level' : 'low angle',
            imagePrompt: `${b.summaryEn} – ${shot} shot`,
            focusX: 0.4 + (k % 3) * 0.1,
            focusY: 0.45,
            needsVerticalVersion: b.emotionalIntensity >= 0.9,
            cast: who ? [{ characterId: who.id, stateId: null, expression: who.expressionSheet[0]?.expression ?? '', position: 'center', action: '' }] : []
          })
          k++
        }
      }
      if (narrator) {
        const beats = story.outline.beats
        for (const b of [beats[1] ?? beats[0], beats[beats.length - 1]]) {
          scenes.push({
            beatId: b.id,
            description: `${narrator.name} kể chuyện bên đèn dầu`,
            shotType: 'medium',
            cameraAngle: 'eye level',
            imagePrompt: 'the channel storyteller sitting by an oil lamp on a stilt-house porch at night',
            focusX: 0.5,
            focusY: 0.42,
            needsVerticalVersion: false,
            cast: [{ characterId: narrator.id, stateId: null, expression: narrator.expressionSheet[0]?.expression ?? '', position: 'center', action: 'kể chuyện' }]
          })
        }
      }
      return { scenes }
    }
  }
}

export function toSceneBank(out: SceneBankOut): SceneBankItem[] {
  return out.scenes.map((s, i) => ({
    id: `s${pad(i + 1)}`,
    beatId: s.beatId,
    description: s.description,
    shotType: s.shotType as ShotType,
    cameraAngle: s.cameraAngle,
    cast: s.cast,
    folkloreIds: [],
    expression: s.cast[0]?.expression ?? '',
    imagePrompt: s.imagePrompt,
    needsVerticalVersion: s.needsVerticalVersion,
    media: { '16:9': null, '9:16': null },
    focusPoint: { x: s.focusX, y: s.focusY },
    depthMapPath: null,
    heroClip: { '16:9': null, '9:16': null },
    variants: [],
    approval: { status: 'pending' }
  }))
}

// ============================================================================
// 4. CHUYỂN THỂ KỊCH BẢN THEO RELEASE (bước 8)
// ============================================================================

const LineSchema = z.object({
  sectionKind: z.enum(KINDS),
  beatId: z.string(),
  speakerId: z.string(),
  text: z.string().min(1),
  translationVi: z.string().optional(),
  tags: z.array(z.string()).max(4),
  instructions: z.string(),
  pace: z.number().min(0.6).max(1.3),
  pauseBeforeMs: z.number().int().min(0).max(3000),
  pauseAfterMs: z.number().int().min(0).max(3000)
})
export type RawScriptLine = z.infer<typeof LineSchema>

export const ScriptSchema = z.object({
  sections: z.array(z.object({ kind: z.enum(KINDS), title: z.string().min(1), titleVi: z.string().optional() })).min(1),
  lines: z.array(LineSchema).min(3)
})
export type ScriptOut = z.infer<typeof ScriptSchema>

export interface AdaptInput {
  story: Story
  folklore: FolkloreEntry[]
  characters: Character[]
  narratorId: string
  platform: Platform
  language: Language
  /** Cấu trúc section yêu cầu (TikTok series: chỉ 'story', hook/cliffhanger thêm sau) */
  structure: ScriptSectionKind[]
  targetSec: number
  glossary: PronunciationEntry[]
}

const PLATFORM_GUIDE: Record<Platform, Record<Language, string>> = {
  youtube: {
    en: 'International English-speaking audience unfamiliar with Vietnamese culture. Long-form, slow, dark, atmospheric narration. coldOpen: a gripping 20–40s scene. context: the channel narrator welcomes and gives cultural background (explain Vietnamese terms once). story: the full tale. folkloreExplainer: what is documented folklore vs the channel\'s fiction. outro: the channel narrator closes gently (no begging for likes).',
    vi: 'Khán giả Việt trên YouTube, video dài, giọng kể chậm, u ám. Mở đầu cuốn hút, phần bối cảnh do người kể của kênh dẫn, phần giải thích truyền thuyết nêu rõ đâu là dân gian, đâu là hư cấu.'
  },
  tiktok: {
    vi: 'Khán giả Việt trên TikTok. Giọng kể gần gũi kiểu "chuyện kể đêm khuya", câu ngắn, nhịp nhanh, khẩu ngữ miền Nam vừa phải. KHÔNG giải thích những điều khán giả Việt đã biết (ma da, cây đa, thắp nhang…).',
    en: 'English TikTok audience: short punchy sentences, immediate tension.'
  },
  youtubeShorts: {
    en: 'YouTube Shorts, English: hook in the first 2 seconds, fast pace, end on a hanging line.',
    vi: 'YouTube Shorts tiếng Việt: móc trong 2 giây đầu, nhịp nhanh, kết lửng.'
  }
}

export function scriptParser(input: AdaptInput): (raw: unknown) => ScriptOut {
  const beatIds = new Set(input.story.outline.beats.map((b) => b.id))
  const speakers = new Set(input.characters.map((c) => c.id))
  const allowedTags = new Set(providersConfig.tts.elevenlabs.audioTags ?? [])
  const structure = new Set(input.structure)
  return (raw) => {
    const out = ScriptSchema.parse(raw)
    out.sections = out.sections.filter((s, i, arr) => arr.findIndex((x) => x.kind === s.kind) === i)
    const sectionKinds = new Set(out.sections.map((s) => s.kind))
    for (const k of sectionKinds) if (!structure.has(k)) throw new Error(`section "${k}" không thuộc cấu trúc ${[...structure].join(', ')}`)
    out.lines.forEach((l, i) => {
      if (!beatIds.has(l.beatId)) throw new Error(`lines[${i}].beatId "${l.beatId}" không tồn tại`)
      if (!speakers.has(l.speakerId)) throw new Error(`lines[${i}].speakerId "${l.speakerId}" không tồn tại`)
      if (!sectionKinds.has(l.sectionKind)) throw new Error(`lines[${i}].sectionKind "${l.sectionKind}" không có trong sections`)
      if (input.language !== 'vi' && !l.translationVi) throw new Error(`lines[${i}] thiếu translationVi`)
      // Bỏ tag không hợp lệ thay vì bắt LLM làm lại
      l.tags = l.tags.map((t) => t.replace(/[[\]]/g, '').trim().toLowerCase()).filter((t) => allowedTags.has(t))
    })
    return out
  }
}

export function adaptScriptTask(input: AdaptInput): LlmJsonRequest<ScriptOut> {
  const rate = providersConfig.tts.mock.unitsPerSecond[input.language]
  const units = Math.round(input.targetSec * rate * 0.85)
  const unitWord = input.language === 'vi' ? 'Vietnamese syllables' : 'English words'
  const tags = (providersConfig.tts.elevenlabs.audioTags ?? []).join(', ')
  const glossary = input.glossary.map((g) => `${g.term}${g.glossEn ? ` (${g.glossEn})` : ''}`).join('; ')
  const narrator = input.characters.find((c) => c.id === input.narratorId)
  const langName = input.language === 'vi' ? 'Vietnamese' : 'English'
  return {
    task: 'adaptScript',
    system: `${PRINCIPLES}
You are a scriptwriter ADAPTING (not translating) a story outline for one release.
Language: ${langName}. Platform: ${input.platform}. ${PLATFORM_GUIDE[input.platform][input.language]}
Section structure, in order: ${input.structure.join(' → ')}.
Length: about ${input.targetSec} seconds of narration ≈ ${units} ${unitWord} in total.
Speakers: the narrator (speakerId "${input.narratorId}"${narrator ? `, ${narrator.name}` : ''}) tells the story and speaks ALL intro/transition/outro lines. Characters may have SHORT dialogue lines (their own voice) interleaved with narration – at most ~15% of lines. Use exact speakerId values from the list.
Every line has: beatId from the outline, delivery tags from [${tags}] (0–2 per line), short acting instructions in English, pace 0.8–1.1 (1 = normal), pauseBeforeMs / pauseAfterMs (use longer silences before reveals).
${input.language !== 'vi' ? 'Every line MUST include translationVi: a faithful Vietnamese translation for the Vietnamese reviewer.' : 'Do not include translationVi.'}
Keep lines short (one or two sentences) so each can be re-recorded independently.`,
    user: `Folklore:\n${folkloreBlock(input.folklore)}\n\nFiction note: ${input.story.fictionNoteVi}\nGlossary terms to keep in Vietnamese: ${glossary || '(none)'}\n\nSpeakers:\n${characterBlock(input.characters)}\n\nOutline:\n${beatBlock(input.story.outline.beats)}\n\nReturn JSON: {"sections":[{"kind","title","titleVi"}],"lines":[{"sectionKind","beatId","speakerId","text",${input.language !== 'vi' ? '"translationVi",' : ''}"tags":[],"instructions","pace","pauseBeforeMs","pauseAfterMs"}]}`,
    parse: scriptParser(input),
    mockResponse: () => mockScript(input)
  }
}

function mockScript(input: AdaptInput): ScriptOut {
  const vi = input.language === 'vi'
  const beats = input.story.outline.beats
  const human = input.characters.find((c) => c.scope === 'story' && c.role === 'character')
  const entity = input.characters.find((c) => c.role === 'entity')
  const titles: Record<ScriptSectionKind, [string, string]> = {
    hook: ['Hook', 'Móc mở đầu'],
    coldOpen: ['Cold open', 'Mở đầu lạnh'],
    context: ['Background', 'Bối cảnh'],
    story: ['The story', 'Câu chuyện'],
    folkloreExplainer: ['About the legend', 'Về truyền thuyết'],
    cliffhanger: ['Cliffhanger', 'Câu treo'],
    outro: ['Outro', 'Kết']
  }
  const sections = input.structure.map((k) => ({ kind: k, title: vi ? titles[k][1] : titles[k][0], titleVi: titles[k][1] }))
  const lines: RawScriptLine[] = []
  const add = (kind: ScriptSectionKind, beat: Beat, speakerId: string, text: string, textVi: string, tags: string[] = []): void => {
    lines.push({
      sectionKind: kind,
      beatId: beat.id,
      speakerId,
      text: vi ? textVi : text,
      ...(vi ? {} : { translationVi: textVi }),
      tags,
      instructions: 'Mock delivery',
      pace: 0.95,
      pauseBeforeMs: 250,
      pauseAfterMs: 450
    })
  }
  const first = beats[0]
  const last = beats[beats.length - 1]
  for (const kind of input.structure) {
    if (kind === 'story') {
      // Lặp lời kể theo beat cho tới khi đủ độ dài mục tiêu
      const rate = providersConfig.tts.mock.unitsPerSecond[input.language]
      const perBeatUnits = Math.max(15, Math.round((input.targetSec * rate * 0.6) / beats.length))
      for (const b of beats) {
        let units = 0
        let k = 0
        while (units < perBeatUnits) {
          const textVi = k === 0 ? b.summaryVi : `Chi tiết ${k + 1} của đoạn này: không khí càng lúc càng nặng nề.`
          const text = k === 0 ? b.summaryEn : `Detail ${k + 1}: the air grows heavier with every breath.`
          add('story', b, input.narratorId, text, textVi, k === 0 ? ['softly'] : [])
          units += (vi ? textVi : text).split(/\s+/).length
          k++
        }
        if (b.emotionalIntensity >= 0.7 && entity) add('story', b, entity.id, 'Come to me…', 'Lại đây…', ['whispers'])
        else if (b.emotionalIntensity >= 0.45 && human) add('story', b, human.id, 'Who is there?', 'Ai đó?', ['nervous'])
      }
    } else {
      const b = kind === 'outro' || kind === 'cliffhanger' || kind === 'folkloreExplainer' ? last : first
      const texts: Record<string, [string, string]> = {
        hook: ['If someone calls your name tonight… do not answer.', 'Nếu đêm nay có ai gọi tên bạn… đừng trả lời.'],
        coldOpen: ['Some nights, the darkness listens back.', 'Có những đêm, bóng tối cũng lắng nghe.'],
        context: ['Come closer to the lamp. This story comes from a village by the river.', 'Lại gần ngọn đèn đi. Chuyện này xảy ra ở một làng ven sông.'],
        folkloreExplainer: [input.story.fictionNoteVi, input.story.fictionNoteVi],
        cliffhanger: ['But the next morning… it was not over.', 'Nhưng sáng hôm sau… mọi chuyện chưa hết.'],
        outro: ['The lamp is low now. Sleep well, and stay away from the water.', 'Đèn sắp tắt rồi. Ngủ ngon nhé.']
      }
      const [t, tv] = texts[kind] ?? ['…', '…']
      add(kind, b, input.narratorId, t, tv, ['softly'])
    }
  }
  return { sections, lines }
}

// ============================================================================
// 5. MÓC MỞ ĐẦU + CÂU TREO CHO TỪNG PHẦN TIKTOK
// ============================================================================

const ShortLine = z.object({ text: z.string().min(1), tags: z.array(z.string()).max(3), instructions: z.string() })
export const HooksSchema = z.object({ parts: z.array(z.object({ hook: ShortLine, ending: ShortLine })).min(1) })
export type HooksOut = z.infer<typeof HooksSchema>

export function seriesHooksTask(
  language: Language,
  parts: { index: number; summary: string; firstLine: string; lastLine: string }[]
): LlmJsonRequest<HooksOut> {
  const n = parts.length
  const hookSec = platformsConfig.series.hookSec
  return {
    task: 'seriesHooks',
    system: `${PRINCIPLES}\nYou write hooks and endings for a ${n}-part ${language === 'vi' ? 'Vietnamese' : 'English'} TikTok series. For EACH part: "hook" = the very first line, readable in ${hookSec - 1}–${hookSec} seconds (≤ 12 ${language === 'vi' ? 'syllables' : 'words'}), grabs attention immediately (parts > 1 may briefly recall the previous part). "ending" = the last line: a hanging line that makes viewers want the next part; for the final part, a chilling closing line instead. Do not say "Part X" in the text (a label is added on screen). Write in ${language === 'vi' ? 'Vietnamese, intimate late-night storytelling tone' : 'English'}.`,
    user: `Parts:\n${parts.map((p) => `Part ${p.index}/${n}: ${p.summary}\n  starts: "${p.firstLine}"\n  ends: "${p.lastLine}"`).join('\n')}\n\nReturn JSON: {"parts":[{"hook":{"text","tags":[],"instructions"},"ending":{"text","tags":[],"instructions"}}]} with exactly ${n} items.`,
    parse: (raw) => {
      const out = HooksSchema.parse(raw)
      if (out.parts.length !== n) throw new Error(`Cần đúng ${n} phần, nhận ${out.parts.length}`)
      return out
    },
    mockResponse: () => ({
      parts: parts.map((p) => ({
        hook: {
          text: p.index === 1 ? (language === 'vi' ? 'Có ai gọi tên bạn từ dưới sông chưa?' : 'Has the river ever called your name?') : language === 'vi' ? 'Tiếng gọi đêm đó vẫn chưa dứt…' : 'The voice did not stop that night…',
          tags: ['whispers'],
          instructions: 'hook'
        },
        ending: {
          text: p.index === n ? (language === 'vi' ? 'Và từ đó, không ai dám qua sông ban đêm nữa.' : 'Since then, no one crosses the river at night.') : language === 'vi' ? 'Nhưng thứ đang chờ ở phía trước… còn đáng sợ hơn.' : 'But what waited ahead was worse.',
          tags: ['softly'],
          instructions: 'hanging ending'
        }
      }))
    })
  }
}

// ============================================================================
// 5b. KIỂM TRA ĐỒNG NHẤT NHÂN VẬT (LLM nhìn ảnh)
// ============================================================================

export const ConsistencySchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.object({ characterName: z.string(), problem: z.string() })).max(10)
})
export type ConsistencyOut = z.infer<typeof ConsistencySchema>

export function consistencyTask(
  sceneDescription: string,
  chars: { name: string; appearance: string; outfit: string; state: string }[],
  images: { mimeType: string; base64: string; label: string }[]
): LlmJsonRequest<ConsistencyOut> {
  return {
    task: 'consistency',
    system:
      'You are a continuity supervisor for an illustrated story. Compare the SCENE image with each character\'s REFERENCE image(s). Flag only clear identity mismatches: wrong outfit or colours, wrong hairstyle/length, wrong age/gender, missing signature items, wrong appearance state. Ignore pose, lighting, framing and art-style differences. A supernatural entity that is only suggested by shadows is fine. Answer in Vietnamese for "problem".',
    user: `Scene: ${sceneDescription}\nCharacters expected:\n${chars.map((c) => `- ${c.name}: ${c.appearance}; outfit: ${c.outfit}${c.state ? `; state: ${c.state}` : ''}`).join('\n')}\n\nReturn JSON: {"ok": boolean, "issues":[{"characterName","problem"}]}`,
    images,
    temperature: 0,
    parse: (raw) => ConsistencySchema.parse(raw),
    mockResponse: () => ({ ok: true, issues: [] })
  }
}

// ============================================================================
// 5c. SOUND DESIGN (bước 18)
// ============================================================================

const CueSchema = z.object({
  kind: z.enum(['ambience', 'sfx', 'stinger', 'music', 'silence']),
  assetId: z.string().nullable(),
  start: z.number(),
  end: z.number(),
  volume: z.number().min(0).max(1.5),
  fadeIn: z.number().min(0).max(10),
  fadeOut: z.number().min(0).max(10),
  reason: z.string()
})
export const SoundDesignSchema = z.object({ cues: z.array(CueSchema).max(80) })

export function soundDesignTask(input: DesignInput, language: Language): LlmJsonRequest<SoundCue[]> {
  const lines = input.lines
    .map((l) => `[${l.start.toFixed(1)}–${l.end.toFixed(1)}] (${l.sectionKind}, beat ${l.beatId}, intensity ${input.beatIntensity(l.beatId).toFixed(2)}) ${l.text}`)
    .join('\n')
  const assets = input.assets
    .filter((a) => a.licenseConfirmed)
    .map((a) => `- id="${a.id}" kind=${a.kind} ${a.durationSec.toFixed(1)}s tags=[${a.tags.join(', ')}] "${a.name}"`)
    .join('\n')
  return {
    task: 'soundDesign',
    system: `You are a horror sound designer for a ${language === 'vi' ? 'Vietnamese' : 'English'} narrated folk-horror video. Place SoundCues using ONLY the listed assets (exact assetId, matching kind). Rules: one continuous ambience bed fitting the setting; optional very quiet music drone; SFX only at key story moments that the narration mentions (not every line, at least ~10s apart, at most one per ~15s, none in the first 2.5s); a stinger at the climax; an intentional "silence" cue (assetId null) of ~0.5–1.2s right before the biggest reveal; never cover the hook's first 2 seconds with loud sounds. Volumes are relative 0..1 (1 = normal for that kind). Keep ad-friendly: no screams or gore sounds. Times in seconds within 0..${input.duration.toFixed(1)}.`,
    user: `Sound palette tags: ambience=[${input.palette.ambienceTags.join(', ')}], sfx=[${input.palette.sfxTags.join(', ')}], stinger=[${input.palette.stingerTags.join(', ')}], music=[${input.palette.musicTags.join(', ')}]\n\nAvailable licensed assets:\n${assets || '(none)'}\n\nNarration timeline:\n${lines}\n\nReturn JSON: {"cues":[{"kind","assetId","start","end","volume","fadeIn","fadeOut","reason" (Vietnamese)}]}`,
    parse: (raw) => {
      const out = SoundDesignSchema.parse(raw)
      const cues: SoundCue[] = out.cues.map((c, i) => ({ id: `cue-${i + 1}`, ...c }))
      const v = validateCues(cues, input.assets, input.duration)
      if (v.problems.length) throw new Error(v.problems.slice(0, 5).join('; '))
      return v.cues
    },
    mockResponse: () => ({ cues: designSoundCues(input).map(({ id: _id, ...c }) => ({ ...c, reason: c.reason ?? '' })) })
  }
}

// ============================================================================
// 5d. GÓI XUẤT BẢN (bước 22)
// ============================================================================

const Concept = z.object({ text: z.string().min(1).max(60), textVi: z.string().optional(), visual: z.string().min(5) })
export const YoutubePackSchema = z.object({
  titleOptions: z.array(z.object({ title: z.string().min(5).max(100), titleVi: z.string().min(3) })).min(3).max(6),
  descriptionIntro: z.string().min(40),
  descriptionIntroVi: z.string().min(20),
  tags: z.array(z.string()).min(5).max(25),
  thumbnailConcepts: z.array(Concept).min(2).max(5),
  shortsHook: z.string().min(5).max(90),
  shortsHookVi: z.string().min(3),
  shortsCta: z.string().min(5).max(60),
  shortsCtaVi: z.string().min(3)
})
export const TiktokPackSchema = z.object({
  captionVi: z.string().min(10).max(220),
  hashtags: z.array(z.string()).min(3).max(10),
  coverConcepts: z.array(Concept).min(2).max(5)
})
export type YoutubePack = z.infer<typeof YoutubePackSchema>
export type TiktokPack = z.infer<typeof TiktokPackSchema>

export interface PublishInput {
  platform: Platform
  language: Language
  storyName: string
  premiseVi: string
  folkloreNames: string[]
  scriptExcerpt: string
  partIndex: number
  partCount: number
}

export function youtubePackTask(i: PublishInput): LlmJsonRequest<YoutubePack> {
  const en = i.language === 'en'
  return {
    task: 'publishYoutube',
    system: `${PRINCIPLES}\nYou are a YouTube packaging expert for a ${en ? 'English-speaking international' : 'Vietnamese'} folk-horror channel. Write curiosity-driven but HONEST titles (no fake "true story" claims, no clickbait lies, no real tragedies), ${en ? 'English' : 'Vietnamese'}, ≤ 70 characters, with the Vietnamese folklore term kept in Vietnamese when it helps. Each title has a Vietnamese translation (titleVi) for the reviewer. descriptionIntro: 2–3 sentence hook paragraph (chapters, glossary and source notes are appended by the app). Tags: specific, mixing English and Vietnamese terms. Thumbnail concepts: 2–4 BIG words on the image + the visual (dark, atmospheric, a face or hand in shadow, no gore). shortsHook: the first spoken-like line of a 30–60s teaser (≤ 12 words). shortsCta: end card text inviting viewers to watch the full story (≤ 8 words).`,
    user: `Story: ${i.storyName}\nPremise (vi): ${i.premiseVi}\nFolklore: ${i.folkloreNames.join(', ')}\nScript excerpt:\n${i.scriptExcerpt}\n\nReturn JSON: {"titleOptions":[{"title","titleVi"}],"descriptionIntro","descriptionIntroVi","tags":[],"thumbnailConcepts":[{"text","textVi","visual"}],"shortsHook","shortsHookVi","shortsCta","shortsCtaVi"}`,
    parse: (raw) => YoutubePackSchema.parse(raw),
    mockResponse: () => {
      const f = i.folkloreNames[0] ?? 'ghost'
      return {
        titleOptions: [
          { title: en ? `The ${f} of the Banyan Bend | Vietnamese Folk Horror` : `${i.storyName} | Chuyện ma dân gian`, titleVi: `${i.storyName} | Kinh dị dân gian Việt Nam` },
          { title: en ? `Never Answer When the River Calls Your Name` : `Đừng trả lời khi sông gọi tên bạn`, titleVi: 'Đừng bao giờ trả lời khi dòng sông gọi tên bạn' },
          { title: en ? `${f}: The Vietnamese Water Ghost Legend` : `Truyền thuyết ${f} miền sông nước`, titleVi: `${f}: truyền thuyết hồn ma dưới nước của Việt Nam` }
        ],
        descriptionIntro: en ? `In a fictional Mekong Delta village, a ferry girl hears her drowned friend calling from beneath the boat. This is a story built on the Vietnamese legend of the ${f}.` : `Ở một làng ven sông hư cấu, cô gái chèo đò nghe giọng người bạn đã mất gọi từ dưới đáy đò.`,
        descriptionIntroVi: `Ở một ngôi làng hư cấu miền Tây, cô gái chèo đò nghe người bạn đã chết đuối gọi tên mình từ dưới đáy đò. Câu chuyện dựa trên truyền thuyết ${f}.`,
        tags: ['vietnamese folklore', 'folk horror', f, 'ma da', 'water ghost', 'mekong delta', 'scary stories', 'truyện ma', 'kinh dị dân gian'],
        thumbnailConcepts: [
          { text: en ? 'DON’T ANSWER' : 'ĐỪNG TRẢ LỜI', textVi: 'ĐỪNG TRẢ LỜI', visual: 'pale hand gripping a wooden boat at night, oil lamp glow' },
          { text: en ? 'IT KNOWS YOUR NAME' : 'NÓ BIẾT TÊN BẠN', textVi: 'NÓ BIẾT TÊN BẠN', visual: 'girl in conical hat looking down into black water, fog' }
        ],
        shortsHook: en ? 'If the river calls your name tonight… don’t answer.' : 'Nếu đêm nay sông gọi tên bạn… đừng trả lời.',
        shortsHookVi: 'Nếu đêm nay sông gọi tên bạn… đừng trả lời.',
        shortsCta: en ? 'Full story on the channel' : 'Xem trọn truyện trên kênh',
        shortsCtaVi: 'Xem trọn truyện trên kênh'
      }
    }
  }
}

export function tiktokPackTask(i: PublishInput): LlmJsonRequest<TiktokPack> {
  return {
    task: 'publishTiktok',
    system: `${PRINCIPLES}\nYou write TikTok captions for a Vietnamese late-night folk-horror storytelling account. captionVi: Vietnamese, ≤ 150 characters, intimate tone, ends with a question or a teaser for the next part, must contain "Phần ${i.partIndex}/${i.partCount}" when there are multiple parts. hashtags: 5–8 relevant Vietnamese/English hashtags (no banned or misleading tags). coverConcepts: 2–3 cover ideas with ≤ 5 big Vietnamese words + the visual.`,
    user: `Story: ${i.storyName}\nPremise: ${i.premiseVi}\nFolklore: ${i.folkloreNames.join(', ')}\nThis part's script:\n${i.scriptExcerpt}\n\nReturn JSON: {"captionVi","hashtags":[],"coverConcepts":[{"text","visual"}]}`,
    parse: (raw) => TiktokPackSchema.parse(raw),
    mockResponse: () => ({
      captionVi: `${i.partCount > 1 ? `Phần ${i.partIndex}/${i.partCount} · ` : ''}Nếu có ai gọi tên bạn từ dưới sông… bạn có dám trả lời không? 🌙`,
      hashtags: ['truyenma', 'kinhdi', 'chuyenmadem', i.folkloreNames[0]?.replace(/\s+/g, '') ?? 'mada', 'dangian', 'storytime'],
      coverConcepts: [
        { text: 'ĐỪNG TRẢ LỜI', visual: 'bàn tay trắng bệch bám mạn đò, ánh đèn dầu' },
        { text: `PHẦN ${i.partIndex}`, visual: 'cô gái nón lá nhìn xuống mặt sông đen' }
      ]
    })
  }
}

// ============================================================================
// 6. VIẾT LẠI MỘT CÂU
// ============================================================================

export const RewriteSchema = z.object({
  text: z.string().min(1),
  translationVi: z.string().optional(),
  tags: z.array(z.string()).max(3),
  instructions: z.string()
})
export type RewriteOut = z.infer<typeof RewriteSchema>

export function rewriteLineTask(args: {
  language: Language
  platform: Platform
  before: string[]
  line: { text: string; speakerName: string; tags: string[] }
  after: string[]
  instruction: string
}): LlmJsonRequest<RewriteOut> {
  const allowed = new Set(providersConfig.tts.elevenlabs.audioTags ?? [])
  return {
    task: 'rewriteLine',
    system: `${PRINCIPLES}\nRewrite ONE script line for a ${args.platform} release in ${args.language === 'vi' ? 'Vietnamese' : 'English'}, keeping continuity with the surrounding lines and the same speaker. Follow the user's instruction. Delivery tags from [${[...allowed].join(', ')}].${args.language !== 'vi' ? ' Include translationVi (Vietnamese translation).' : ''}`,
    user: `Previous lines:\n${args.before.join('\n') || '(none)'}\n\nLINE TO REWRITE (speaker: ${args.line.speakerName}): "${args.line.text}"\n\nNext lines:\n${args.after.join('\n') || '(none)'}\n\nInstruction: ${args.instruction || 'Make it more atmospheric and natural to read aloud.'}\n\nReturn JSON: {"text","translationVi","tags":[],"instructions"}`,
    parse: (raw) => {
      const out = RewriteSchema.parse(raw)
      if (args.language !== 'vi' && !out.translationVi) throw new Error('thiếu translationVi')
      out.tags = out.tags.map((t) => t.replace(/[[\]]/g, '').trim().toLowerCase()).filter((t) => allowed.has(t))
      return out
    },
    mockResponse: () => ({
      text: `${args.line.text.replace(/\s*\(viết lại – Mock\)$/, '')} (viết lại – Mock)`,
      ...(args.language !== 'vi' ? { translationVi: '(bản dịch – Mock)' } : {}),
      tags: args.line.tags,
      instructions: args.instruction || 'Mock rewrite'
    })
  }
}
