import { describe, expect, it } from 'vitest'
import { OpenAiLlmProvider } from '../src/main/llm/openaiLlm'
import { MockLlmProvider } from '../src/main/llm/mockLlm'
import {
  adaptScriptTask,
  castTask,
  outlineTask,
  rewriteLineTask,
  sceneBankTask,
  seriesHooksTask,
  type AdaptInput
} from '../src/main/llm/tasks'
import { toScript } from '../src/main/services/scriptService'
import { charactersForStory } from '../src/shared/logic/voices'
import { CHANNEL_NARRATOR_ID, createSampleLibrary, createSampleStory } from '../src/shared/sampleData'

const story = createSampleStory()
const lib = createSampleLibrary()
const chars = charactersForStory(story.id, lib.characters)
const mock = new MockLlmProvider()

function adaptInput(over: Partial<AdaptInput> = {}): AdaptInput {
  return {
    story,
    folklore: lib.folklore,
    characters: chars,
    narratorId: CHANNEL_NARRATOR_ID,
    platform: 'youtube',
    language: 'en',
    structure: ['coldOpen', 'context', 'story', 'folkloreExplainer', 'outro'],
    targetSec: 120,
    glossary: lib.pronunciations.filter((p) => p.language === 'en'),
    ...over
  }
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Mock LLM – mọi tác vụ trả output hợp lệ theo schema', () => {
  it('dàn ý, nhân vật, ngân hàng cảnh, kịch bản, móc series, viết lại', async () => {
    expect((await mock.generateJson(outlineTask(story, lib.folklore))).data.beats.length).toBeGreaterThanOrEqual(5)
    expect((await mock.generateJson(castTask(story, lib.folklore, chars.filter((c) => c.scope === 'channel')))).data.characters.length).toBeGreaterThan(0)
    const bank = (await mock.generateJson(sceneBankTask(story, chars, lib.channelPresets[0]))).data
    expect(bank.scenes.some((s) => s.cast.some((c) => c.characterId === CHANNEL_NARRATOR_ID))).toBe(true)
    const yt = (await mock.generateJson(adaptScriptTask(adaptInput()))).data
    expect(yt.lines.every((l) => l.translationVi)).toBe(true)
    expect(yt.lines.some((l) => l.speakerId !== CHANNEL_NARRATOR_ID)).toBe(true)
    const tt = (await mock.generateJson(adaptScriptTask(adaptInput({ platform: 'tiktok', language: 'vi', structure: ['story'] })))).data
    expect(tt.lines.every((l) => l.translationVi === undefined)).toBe(true)
    const hooks = await mock.generateJson(seriesHooksTask('vi', [1, 2].map((i) => ({ index: i, summary: 's', firstLine: 'a', lastLine: 'b' }))))
    expect(hooks.data.parts.length).toBe(2)
    const rw = await mock.generateJson(rewriteLineTask({ language: 'en', platform: 'youtube', before: [], after: [], line: { text: 'Hi', speakerName: 'N', tags: [] }, instruction: '' }))
    expect(rw.data.translationVi).toBeTruthy()
  })
})

describe('Kiểm tra tham chiếu trong output LLM', () => {
  const base = {
    sections: [{ kind: 'story', title: 'S' }],
    lines: [{ sectionKind: 'story', beatId: 'b1', speakerId: CHANNEL_NARRATOR_ID, text: 'x', translationVi: 'x', tags: [], instructions: '', pace: 1, pauseBeforeMs: 0, pauseAfterMs: 0 }]
  }
  const parse = adaptScriptTask(adaptInput({ structure: ['story'] })).parse
  const line0 = (patch: object) => ({ ...base, lines: [base.lines[0], base.lines[0], { ...base.lines[0], ...patch }] })

  it('từ chối speakerId / beatId không tồn tại, section ngoài cấu trúc, thiếu bản dịch', () => {
    expect(() => parse(line0({ speakerId: 'char-x' }))).toThrow(/speakerId/)
    expect(() => parse(line0({ beatId: 'b99' }))).toThrow(/beatId/)
    expect(() => parse({ ...line0({}), sections: [{ kind: 'outro', title: 'o' }, { kind: 'story', title: 's' }] })).toThrow(/cấu trúc/)
    expect(() => parse(line0({ translationVi: undefined }))).toThrow(/translationVi/)
  })

  it('bỏ audio tag không hợp lệ thay vì báo lỗi', () => {
    const out = parse(line0({ tags: ['[Whispers]', 'screams-loudly'] }))
    expect(out.lines[2].tags).toEqual(['whispers'])
  })

  it('ngân hàng cảnh: từ chối characterId / stateId lạ', () => {
    const p = sceneBankTask(story, chars, lib.channelPresets[0]).parse
    const scene = { beatId: 'b1', description: 'mô tả cảnh', shotType: 'wide', cameraAngle: 'eye', imagePrompt: 'a prompt here', focusX: 0.5, focusY: 0.5, needsVerticalVersion: false, cast: [] as object[] }
    const four = (c: object[]) => ({ scenes: [scene, scene, scene, { ...scene, cast: c }] })
    expect(() => p(four([{ characterId: 'nope', stateId: null, expression: '', position: 'center', action: '' }]))).toThrow(/characterId/)
    expect(() => p(four([{ characterId: 'char-lan', stateId: 'st-x', expression: '', position: 'center', action: '' }]))).toThrow(/stateId/)
    expect(p(four([{ characterId: 'char-lan', stateId: 'st-lan-uot', expression: '', position: 'left', action: '' }])).scenes.length).toBe(4)
  })

  it('toScript: id ổn định, sắp theo thứ tự section', async () => {
    const out = (await mock.generateJson(adaptScriptTask(adaptInput()))).data
    const s = toScript('rel-x', out, 'en')
    expect(s.lines[0].id).toBe('rel-x-l01')
    const order = s.sections.map((x) => x.id)
    const idx = s.lines.map((l) => order.indexOf(l.sectionId))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
})

describe('OpenAiLlmProvider', () => {
  it('JSON sai schema ⇒ gửi lỗi lại cho model và thử lại; cộng dồn token + chi phí', async () => {
    const bodies: { messages: { role: string; content: string }[] }[] = []
    const queue = [chatResponse('{"beats": []}'), chatResponse(JSON.stringify((outlineTask(story, lib.folklore).mockResponse as () => unknown)()))]
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return queue.shift()!
    }) as unknown as typeof fetch
    const llm = new OpenAiLlmProvider(() => 'sk-test', fetchImpl)
    const res = await llm.generateJson(outlineTask(story, lib.folklore))
    expect(res.data.beats.length).toBe(7)
    expect(res.inputTokens).toBe(2000)
    expect(res.cost).toBeGreaterThan(0)
    expect(bodies[1].messages.at(-1)?.content).toMatch(/did not match/)
  })

  it('thiếu API key ⇒ thông báo tiếng Việt', async () => {
    const llm = new OpenAiLlmProvider(() => null)
    await expect(llm.generateJson(outlineTask(story, lib.folklore))).rejects.toThrow(/Chưa có API key OpenAI/)
  })

  it('sai mãi ⇒ dừng sau maxRetries', async () => {
    const fetchImpl = (async () => chatResponse('not json')) as unknown as typeof fetch
    const llm = new OpenAiLlmProvider(() => 'k', fetchImpl)
    await expect(llm.generateJson({ ...outlineTask(story, lib.folklore), maxRetries: 1 })).rejects.toThrow(/sau 2 lần thử/)
  })
})
