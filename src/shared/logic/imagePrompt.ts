/**
 * DỰNG PROMPT ẢNH (hàm thuần, có test)
 * prompt cảnh = artStyle + culturalVisualBible + mô tả cảnh + shot/góc máy + nhân vật (ngoại hình, trang phục,
 *               trạng thái, biểu cảm, hành động) + thực thể (thiết kế từ FolkloreEntry, chỉ gợi qua bóng tối)
 * Gemini không có tham số negative prompt ⇒ nối "Avoid: …" vào cuối prompt.
 */
import type { AspectRatio, ChannelPreset, Character, FolkloreEntry, ImageAspect, SceneBankItem } from '../types'

export const MAX_CLEAR_FACES = 3

export type SheetView = 'front' | 'threeQuarter' | 'profile' | 'fullBody'
export const SHEET_VIEWS: SheetView[] = ['front', 'threeQuarter', 'profile', 'fullBody']
export const SHEET_VIEW_LABEL: Record<SheetView, string> = {
  front: 'chính diện',
  threeQuarter: '3/4',
  profile: 'nghiêng',
  fullBody: 'toàn thân'
}
export const SHEET_VIEW_ASPECT: Record<SheetView, ImageAspect> = { front: '1:1', threeQuarter: '1:1', profile: '1:1', fullBody: '9:16' }

export interface PromptContext {
  channel: ChannelPreset
  folklore: FolkloreEntry[]
  characters: Character[]
}

const SHOT_TEXT: Record<SceneBankItem['shotType'], string> = {
  wide: 'wide establishing shot',
  medium: 'medium shot',
  closeUp: 'close-up shot',
  overShoulder: 'over-the-shoulder shot',
  topDown: 'top-down overhead shot',
  insert: 'insert detail shot'
}

const SAFETY =
  'Horror through atmosphere, darkness, fog, shadows and suggestion only. No gore, no blood, no wounds, no corpses. No text, letters, captions, logos or watermarks anywhere in the image.'

function genderText(c: Character): string {
  return c.gender === 'female' ? 'woman' : c.gender === 'male' ? 'man' : 'person'
}

function describePerson(c: Character, stateId: string | null, expression: string, action: string, position: string): string {
  const st = c.states.find((s) => s.id === stateId)
  return [
    `${c.name} (${position}${c.age ? `, ${c.age}-year-old Vietnamese ${genderText(c)}` : ''}): ${c.appearance}`,
    c.defaultOutfit ? `wearing ${c.defaultOutfit}` : '',
    st ? `current state: ${st.name} – ${st.description}` : '',
    expression ? `expression: ${expression}` : '',
    action ? `action: ${action}` : '',
    c.locked ? `keep face, hair and outfit identical to the reference images of ${c.name}` : ''
  ]
    .filter(Boolean)
    .join('; ')
}

function describeEntity(c: Character, ctx: PromptContext, stateId: string | null, action: string): string {
  const st = c.states.find((s) => s.id === stateId)
  const design = ctx.folklore.map((f) => f.visualDesign).filter(Boolean).join(' ')
  return [
    `The supernatural entity "${c.name}" must NEVER be fully shown – only suggested through darkness, shadows, reflections and small details`,
    design ? `folklore design: ${design}` : '',
    c.appearance ? `story-specific design: ${c.appearance}` : '',
    st ? `visible as: ${st.name} – ${st.description}` : '',
    action ? `action: ${action}` : ''
  ]
    .filter(Boolean)
    .join('; ')
}

/** Cast hợp lệ để đưa vào prompt: tối đa MAX_CLEAR_FACES người rõ mặt (không tính hậu cảnh và thực thể) */
export function castForPrompt(scene: SceneBankItem, characters: Character[]): SceneBankItem['cast'] {
  const known = scene.cast.filter((m) => characters.some((c) => c.id === m.characterId))
  let faces = 0
  return known.filter((m) => {
    const c = characters.find((x) => x.id === m.characterId)
    if (!c || c.role === 'entity' || m.position === 'background') return true
    faces++
    return faces <= MAX_CLEAR_FACES
  })
}

export function buildScenePrompt(scene: SceneBankItem, ctx: PromptContext, aspect: AspectRatio): { prompt: string; negativePrompt: string } {
  const ch = ctx.channel
  const people = castForPrompt(scene, ctx.characters)
    .map((m) => {
      const c = ctx.characters.find((x) => x.id === m.characterId)
      if (!c) return ''
      return c.role === 'entity' ? describeEntity(c, ctx, m.stateId, m.action) : describePerson(c, m.stateId, m.expression, m.action, m.position)
    })
    .filter(Boolean)
  const parts = [
    `Art style: ${ch.artStyle}.`,
    `Setting must follow Vietnamese visual culture: ${ch.culturalVisualBible.join('; ')}.`,
    `Scene: ${scene.imagePrompt}.`,
    `Camera: ${SHOT_TEXT[scene.shotType]}, ${scene.cameraAngle}. Frame ${aspect}${aspect === '9:16' ? ' vertical composition, main subject centered with headroom' : ' cinematic widescreen composition'}.`,
    ...people.map((p) => `${p}.`),
    `Colour palette: ${ch.palette.join(', ')}.`,
    SAFETY,
    `Avoid: ${ch.negativePrompt}.`
  ]
  return { prompt: parts.join('\n'), negativePrompt: ch.negativePrompt }
}

export function buildCharacterViewPrompt(c: Character, view: SheetView, ctx: PromptContext): string {
  const viewText: Record<SheetView, string> = {
    front: 'front view portrait, head and shoulders, looking at camera',
    threeQuarter: 'three-quarter view portrait, head and shoulders',
    profile: 'side profile portrait, head and shoulders',
    fullBody: 'full body standing pose, head to toe visible'
  }
  const who =
    c.role === 'entity'
      ? `${describeEntity(c, ctx, null, '')}. Concept reference image, partially hidden in darkness`
      : `Character reference sheet image. ${describePerson(c, null, 'neutral', '', 'center')}`
  return [
    `Art style: ${ctx.channel.artStyle}.`,
    who + '.',
    `${viewText[view]}, plain dark neutral background, soft even lighting, consistent identity for later scenes.`,
    SAFETY,
    `Avoid: ${ctx.channel.negativePrompt}.`
  ].join('\n')
}

export function buildExpressionPrompt(c: Character, expression: string, ctx: PromptContext): string {
  return [
    `Art style: ${ctx.channel.artStyle}.`,
    `Same character as the reference image: ${c.name}, ${c.appearance}, wearing ${c.defaultOutfit}.`,
    `Head and shoulders portrait showing the expression: ${expression}. Plain dark neutral background.`,
    SAFETY,
    `Avoid: ${ctx.channel.negativePrompt}.`
  ].join('\n')
}

export function buildStatePrompt(c: Character, stateId: string, ctx: PromptContext): string {
  const st = c.states.find((s) => s.id === stateId)
  return [
    `Art style: ${ctx.channel.artStyle}.`,
    c.role === 'entity'
      ? describeEntity(c, ctx, stateId, '') + '.'
      : `Same character as the reference image: ${c.name}, ${c.appearance}, wearing ${c.defaultOutfit}. Appearance state: ${st?.name ?? ''} – ${st?.description ?? ''}.`,
    'Three-quarter body view, plain dark neutral background.',
    SAFETY,
    `Avoid: ${ctx.channel.negativePrompt}.`
  ].join('\n')
}

/** Prompt chuyển động cho video AI (image-to-video) – chuyển động tinh tế, giữ nguyên bố cục và nhân vật */
export function buildVideoPrompt(scene: SceneBankItem, ctx: PromptContext, seconds: number): string {
  const entity = scene.cast.some((m) => ctx.characters.find((c) => c.id === m.characterId)?.role === 'entity')
  return [
    `Animate this still image into a ${seconds}-second cinematic shot. Scene: ${scene.imagePrompt}.`,
    'Motion: very slow camera push-in; drifting fog; flickering oil-lamp light; gentle water ripples and floating leaves; characters move minimally (breathing, hair and cloth stirring in the wind, a slow head turn).',
    entity ? 'The supernatural presence only shifts subtly in the shadows or under the water – never fully revealed.' : '',
    'Keep the composition, faces, outfits and Vietnamese setting exactly as in the image. No cuts, no new characters, no text.',
    SAFETY
  ]
    .filter(Boolean)
    .join(' ')
}

export interface RefImage {
  characterId: string
  kind: SheetView | 'expression' | 'state'
  /** Đường dẫn tương đối trong thư mục _characters */
  path: string
}

/**
 * Chọn ảnh tham chiếu cho cảnh: CHỈ nhân vật đã khoá; ưu tiên ảnh trạng thái → ảnh biểu cảm → chính diện → 3/4.
 * Chia đều giữa các nhân vật (round-robin) cho tới tối đa max ảnh.
 */
export function pickReferences(scene: SceneBankItem, characters: Character[], max: number): RefImage[] {
  const order = { center: 0, left: 1, right: 1, background: 2 } as const
  const members = [...castForPrompt(scene, characters)].sort((a, b) => order[a.position] - order[b.position])
  const perChar: RefImage[][] = []
  for (const m of members) {
    const c = characters.find((x) => x.id === m.characterId)
    if (!c?.locked) continue
    const list: RefImage[] = []
    const st = c.states.find((s) => s.id === m.stateId)
    if (st?.referenceImage) list.push({ characterId: c.id, kind: 'state', path: st.referenceImage })
    const ex = c.expressionSheet.find((e) => e.expression === m.expression && e.imagePath)
    if (ex?.imagePath) list.push({ characterId: c.id, kind: 'expression', path: ex.imagePath })
    for (const v of ['front', 'threeQuarter'] as const) {
      const p = c.characterSheet[v]
      if (p) list.push({ characterId: c.id, kind: v, path: p })
    }
    if (list.length) perChar.push(list)
  }
  const out: RefImage[] = []
  for (let round = 0; out.length < max && perChar.some((l) => l.length > round); round++) {
    for (const l of perChar) {
      if (out.length >= max) break
      if (l[round]) out.push(l[round])
    }
  }
  return out
}
