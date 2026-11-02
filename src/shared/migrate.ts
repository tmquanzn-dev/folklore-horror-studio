/**
 * Nâng cấp dữ liệu đã lưu từ phiên bản cũ (GĐ1) lên data model hiện tại – chạy mỗi lần đọc file, idempotent.
 */
import type { CastMember, Character, CostLedger, Library, PublishingPackage, Release, SceneBankItem, SoundAsset, Story, ThumbnailConcept } from './types'

type Legacy<T> = Partial<T> & Record<string, unknown>

export function isLegacyLibrary(lib: Library): boolean {
  return lib.characters.some((c) => (c as Legacy<Character>).scope === undefined)
}

export function migrateCharacter(c: Legacy<Character>, fallbackStoryId: string | null): Character {
  const scope = c.scope ?? (c.role === 'narrator' ? 'channel' : 'story')
  return {
    id: String(c.id),
    name: String(c.name ?? ''),
    role: c.role ?? 'character',
    scope,
    storyId: scope === 'story' ? (c.storyId ?? fallbackStoryId) : null,
    age: c.age ?? null,
    gender: c.gender ?? 'unknown',
    appearance: c.appearance ?? String(c.description ?? ''),
    defaultOutfit: c.defaultOutfit ?? '',
    description: String(c.description ?? ''),
    referenceImages: c.referenceImages ?? [],
    characterSheet: c.characterSheet ?? { front: null, threeQuarter: null, profile: null, fullBody: null },
    expressionSheet: c.expressionSheet ?? [],
    states: c.states ?? [],
    voiceProfileIdByLanguage: c.voiceProfileIdByLanguage ?? {},
    locked: c.locked ?? false,
    approval: c.approval ?? { status: 'pending' }
  }
}

export function migrateSceneItem(s: Legacy<SceneBankItem>): SceneBankItem {
  const legacyIds = (s['characterIds'] as string[] | undefined) ?? []
  const cast: CastMember[] =
    s.cast ?? legacyIds.map((id) => ({ characterId: id, stateId: null, expression: String(s.expression ?? ''), position: 'center', action: '' }))
  const item = { ...s, cast, needsVerticalVersion: s.needsVerticalVersion ?? false } as SceneBankItem & { characterIds?: string[] }
  delete item.characterIds
  return item
}

/** GĐ5: gói xuất bản có thêm thumbnail, Shorts; ý tưởng thumbnail thành dạng có cấu trúc */
export function migrateRelease(r: Release): Release {
  const p = r.publishing as (PublishingPackage & Record<string, unknown>) | null
  if (p) {
    p.thumbnails ??= []
    p.selectedThumbnail ??= null
    p.generatedAt ??= new Date(0).toISOString()
    const fix = (arr: unknown[] | undefined): ThumbnailConcept[] =>
      (arr ?? []).map((x) => (typeof x === 'string' ? { text: x, visual: x } : (x as ThumbnailConcept)))
    if (p.youtube) p.youtube.thumbnailConcepts = fix(p.youtube.thumbnailConcepts as unknown[])
    if (p.tiktok) p.tiktok.coverConcepts = fix(p.tiktok.coverConcepts as unknown[])
  }
  return r
}

export function migrateStory(story: Story): Story {
  const s = story as Story & { costs?: CostLedger }
  s.costs ??= { estimated: 0, actual: 0, budgetLimit: story.budget?.limitUsd ?? 0, entries: [] }
  s.performanceNotes ??= []
  s.fictionNoteVi ??= ''
  s.sceneBank = (s.sceneBank ?? []).map((x) => migrateSceneItem(x as Legacy<SceneBankItem>))
  return s
}

export function migrateLibrary(lib: Library): Library {
  lib.characters = lib.characters.map((c) => migrateCharacter(c as Legacy<Character>, null))
  for (const ch of lib.channelPresets) {
    for (const pd of Object.values(ch.platformDefaults)) pd.narratorSections ??= []
    ch.motionProfile.parallaxRatio ??= 0.3
  }
  // GĐ4: SoundAsset có thêm loại, thời lượng, xác nhận giấy phép
  lib.soundAssets = (lib.soundAssets ?? []).map((a) => {
    const x = a as Legacy<SoundAsset>
    return {
      id: String(x.id),
      path: String(x.path ?? ''),
      name: x.name ?? String(x.path ?? '').split(/[\\/]/).pop() ?? 'sound',
      kind: x.kind ?? 'sfx',
      tags: x.tags ?? [],
      durationSec: x.durationSec ?? 0,
      license: x.license ?? '',
      licenseConfirmed: x.licenseConfirmed ?? false,
      source: x.source ?? ''
    }
  })
  return lib
}
