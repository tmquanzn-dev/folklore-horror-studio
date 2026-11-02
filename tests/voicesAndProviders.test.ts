import { describe, expect, it } from 'vitest'
import { ElevenLabsTtsProvider } from '../src/main/providers/tts/elevenlabs'
import { OpenAiTtsProvider } from '../src/main/providers/tts/openaiTts'
import { createProviderRegistry } from '../src/main/providers/registry'
import { computePeaks } from '../src/main/services/voiceService'
import { checkBudget, storySpent } from '../src/shared/logic/costEstimate'
import { matchScenes } from '../src/shared/logic/sceneMatching'
import { charactersForStory, isChannelCharacter, resolveVoice, suggestVoiceId } from '../src/shared/logic/voices'
import { isLegacyLibrary, migrateLibrary, migrateStory } from '../src/shared/migrate'
import { CHANNEL_NARRATOR_ID, createSampleLibrary, createSampleStory, emptyLedger } from '../src/shared/sampleData'
import type { Delivery, Library, Story } from '../src/shared/types'

const lib = createSampleLibrary()
const story = createSampleStory()
const d: Delivery = { tags: ['whispers', 'nervous'], instructions: 'Very close to the mic.', pace: 0.8, pauseBeforeMs: 0, pauseAfterMs: 0 }

describe('Chọn giọng theo người nói', () => {
  it('nhân vật có giọng riêng theo ngôn ngữ; người kể dùng giọng kênh', () => {
    expect(resolveVoice('char-ma-da', 'vi', lib, story.channelPresetId)?.id).toBe('voice-vi-ma-da')
    expect(resolveVoice('char-ba-sau', 'en', lib, story.channelPresetId)?.id).toBe('voice-en-ba-sau')
    expect(resolveVoice(CHANNEL_NARRATOR_ID, 'en', lib, story.channelPresetId)?.id).toBe('voice-en-narrator')
  })
  it('nhân vật chưa có giọng ⇒ rơi về giọng mặc định của kênh', () => {
    const l2: Library = structuredClone(lib)
    l2.characters.find((c) => c.id === 'char-lan')!.voiceProfileIdByLanguage = {}
    expect(resolveVoice('char-lan', 'vi', l2, story.channelPresetId)?.id).toBe('voice-vi-narrator')
  })
  it('nhân vật kênh xuất hiện ở mọi Story, nhân vật truyện chỉ ở Story của nó', () => {
    expect(isChannelCharacter(CHANNEL_NARRATOR_ID, lib.characters)).toBe(true)
    expect(charactersForStory('story-khac', lib.characters).map((c) => c.id)).toEqual([CHANNEL_NARRATOR_ID])
    expect(charactersForStory(story.id, lib.characters).length).toBe(4)
  })
})

describe('Gợi ý giọng cho nhân vật mới', () => {
  const base = lib.characters.find((c) => c.id === 'char-lan')!
  const exclude = new Set(['voice-vi-narrator', 'voice-en-narrator'])
  it('thực thể ⇒ giọng ma; thiếu nữ ⇒ giọng trẻ; bà cụ ⇒ giọng già', () => {
    expect(suggestVoiceId({ ...base, role: 'entity', age: null }, lib.voiceProfiles, 'vi', exclude)).toBe('voice-vi-ma-da')
    expect(suggestVoiceId({ ...base, age: 19, gender: 'female' }, lib.voiceProfiles, 'vi', exclude)).toBe('voice-vi-lan')
    expect(suggestVoiceId({ ...base, age: 70, gender: 'female' }, lib.voiceProfiles, 'en', exclude)).toBe('voice-en-ba-sau')
  })
  it('không gán giọng nữ cho nhân vật nam; không chắc ⇒ null', () => {
    expect(suggestVoiceId({ ...base, age: 72, gender: 'male' }, lib.voiceProfiles, 'vi', exclude)).toBeNull()
  })
})

describe('Khớp cảnh: cảnh người kể', () => {
  const isNarr = { isNarratorScene: (s: Story['sceneBank'][number]) => s.cast.some((c) => c.characterId === CHANNEL_NARRATOR_ID) }
  const L = (id: string, beatId: string, start: number, narrator = false) => ({ id, beatId, start, end: start + 4, narrator })

  it('câu đánh dấu narrator dùng cảnh nhân vật kênh; câu khác KHÔNG dùng cảnh người kể', () => {
    const lines = [L('a', 'b2', 0.5, true), L('b', 'b2', 5), L('c', 'b2', 10), L('d', 'b7', 15, true)]
    const { scenes } = matchScenes(lines, story.sceneBank, story.outline.beats, 20, { minSec: 3, targetSec: 5, maxSec: 8, cutLeadSec: 0.2 }, isNarr)
    const bank = new Map(story.sceneBank.map((s) => [s.id, s]))
    const isN = (sid: string): boolean => isNarr.isNarratorScene(bank.get(sid)!)
    expect(isN(scenes.find((s) => s.lineIds.includes('a'))!.sceneBankId)).toBe(true)
    expect(isN(scenes.find((s) => s.lineIds.includes('b'))!.sceneBankId)).toBe(false)
    expect(scenes.find((s) => s.lineIds.includes('d'))!.sceneBankId).toBe('s15')
  })
})

describe('Payload provider TTS', () => {
  const voice = { ...lib.voiceProfiles.find((v) => v.id === 'voice-en-ma-da')!, providerVoiceId: 'abc', defaultTags: ['softly'] }

  it('ElevenLabs: audio tag hợp lệ đặt đầu câu, speed bị kẹp 0.7–1.2', () => {
    const p = new ElevenLabsTtsProvider(() => 'k').toProviderPayload('Come home.', d, { ...voice, speed: 0.8 })
    expect(p.text).toBe('[softly] [whispers] [nervous] Come home.')
    expect((p.voice_settings as { speed: number }).speed).toBe(0.7)
    expect(p.model_id).toBe('eleven_v3')
  })

  it('OpenAI: delivery chuyển thành instructions', () => {
    const p = new OpenAiTtsProvider(() => 'k').toProviderPayload('Come home.', d, voice)
    expect(p.instructions).toContain(voice.baseInstructions)
    expect(p.instructions).toContain('Very close to the mic.')
    expect(p.instructions).toContain('whispers')
    expect(p.instructions).toContain('Speak slowly.')
    expect(p.response_format).toBe('wav')
  })

  it('thiếu key ⇒ báo lỗi tiếng Việt trước khi gọi mạng', async () => {
    const p = new ElevenLabsTtsProvider(() => null)
    await expect(p.synthesize({ text: 'x', language: 'en', voice, delivery: d, outputPath: 'x.wav' })).rejects.toThrow(/API key ElevenLabs/)
  })

  it('registry: Mock bật ⇒ luôn Mock; tắt ⇒ theo providerId của giọng', () => {
    let mock = true
    const r = createProviderRegistry({ isMock: () => mock, getKey: () => 'k' })
    expect(r.tts('elevenlabs').id).toBe('mock')
    expect(r.llm().id).toBe('mock')
    mock = false
    expect(r.tts('elevenlabs').id).toBe('elevenlabs')
    expect(r.tts('openai').id).toBe('openai')
    expect(r.tts('mock').id).toBe('mock')
    expect(r.llm().id).toBe('openai')
    expect(() => r.tts('xyz')).toThrow()
  })
})

describe('Ngân sách & waveform', () => {
  it('tổng chi Story = cấp Story + mọi Release; chặn khi vượt', () => {
    const a = { ...emptyLedger(5), actual: 1 }
    const b = { ...emptyLedger(5), actual: 2.5 }
    expect(storySpent(a, [b])).toBe(3.5)
    expect(checkBudget(3.5, 1, 5).ok).toBe(true)
    expect(checkBudget(3.5, 2, 5).ok).toBe(false)
    expect(checkBudget(100, 100, 0).ok).toBe(true) // 0 = không giới hạn
  })
  it('peaks chuẩn hoá 0..1', () => {
    const s = new Int16Array([0, 16384, -32768, 100, 0, 0])
    expect(computePeaks(s, 3)).toEqual([0.5, 1, 0])
  })
})

describe('Nâng cấp dữ liệu GĐ1', () => {
  it('nhân vật cũ ⇒ có scope; cảnh cũ characterIds ⇒ cast', () => {
    const old = { ...lib, characters: [{ id: 'n', name: 'N', role: 'narrator', description: 'd', referenceImages: [], expressionSheet: [], voiceProfileIdByLanguage: {} }] } as unknown as Library
    expect(isLegacyLibrary(old)).toBe(true)
    const m = migrateLibrary(old)
    expect(m.characters[0].scope).toBe('channel')
    expect(isLegacyLibrary(m)).toBe(false)
    const s = createSampleStory() as unknown as Record<string, unknown>
    delete s.costs
    const scene = { ...createSampleStory().sceneBank[0], characterIds: ['char-lan'] } as Record<string, unknown>
    delete scene.cast
    s.sceneBank = [scene]
    const ms = migrateStory(s as unknown as Story)
    expect(ms.costs.actual).toBe(0)
    expect(ms.sceneBank[0].cast[0].characterId).toBe('char-lan')
    expect('characterIds' in ms.sceneBank[0]).toBe(false)
  })
})
