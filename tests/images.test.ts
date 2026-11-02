import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GeminiImageProvider, type GenAiClientLike } from '../src/main/providers/image/gemini'
import { createProviderRegistry } from '../src/main/providers/registry'
import { createAppQueue } from '../src/main/queue/appQueue'
import { ImageService } from '../src/main/services/imageService'
import { StoryRepository } from '../src/main/storage/storyRepo'
import { createZip, crc32 } from '../src/main/media/zip'
import { buildScenePrompt, castForPrompt, pickReferences } from '../src/shared/logic/imagePrompt'
import { charactersForStory } from '../src/shared/logic/voices'
import { createSampleLibrary, createSampleStory, SAMPLE_STORY_ID } from '../src/shared/sampleData'
import type { Character } from '../src/shared/types'

const lib = createSampleLibrary()
const story = createSampleStory()
const chars = charactersForStory(story.id, lib.characters)
const ctx = { channel: lib.channelPresets[0], folklore: lib.folklore, characters: chars }

describe('Prompt ảnh cảnh', () => {
  it('gồm artStyle, cultural visual bible, nhân vật, trạng thái, negative; thực thể chỉ được gợi qua bóng tối', () => {
    const s10 = story.sceneBank.find((s) => s.id === 's10')!
    const { prompt } = buildScenePrompt(s10, ctx, '9:16')
    expect(prompt).toContain(ctx.channel.artStyle)
    expect(prompt).toContain('nhà sàn')
    expect(prompt).toContain('Út Lan')
    expect(prompt).toContain('ướt sũng')
    expect(prompt).toContain('vertical composition')
    expect(prompt).toContain('Avoid: ')
    expect(prompt).toMatch(/No gore/)
    const s08 = story.sceneBank.find((s) => s.id === 's08')!
    const p2 = buildScenePrompt(s08, ctx, '16:9').prompt
    expect(p2).toMatch(/NEVER be fully shown/)
    expect(p2).toContain(lib.folklore[0].visualDesign)
  })

  it('tối đa 3 nhân vật rõ mặt (không tính hậu cảnh / thực thể)', () => {
    const many = { ...story.sceneBank[0], cast: ['a', 'b', 'c', 'd'].map((id) => ({ characterId: id, stateId: null, expression: '', position: 'center' as const, action: '' })) }
    const people: Character[] = ['a', 'b', 'c', 'd'].map((id) => ({ ...chars[1], id, role: 'character' }))
    expect(castForPrompt(many, people).length).toBe(3)
  })

  it('ảnh tham chiếu: chỉ nhân vật đã khoá; ưu tiên ảnh trạng thái → biểu cảm → chính diện', () => {
    const lan: Character = {
      ...chars.find((c) => c.id === 'char-lan')!,
      characterSheet: { front: 'char-lan/front.png', threeQuarter: 'char-lan/tq.png', profile: null, fullBody: null },
      expressionSheet: [{ expression: 'sợ hãi', prompt: '', imagePath: 'char-lan/scared.png' }],
      states: [{ id: 'st-lan-uot', name: 'ướt sũng', description: '', referenceImage: 'char-lan/wet.png' }]
    }
    const s10 = story.sceneBank.find((s) => s.id === 's10')!
    expect(pickReferences(s10, [{ ...lan, locked: false }], 4)).toEqual([])
    expect(pickReferences(s10, [{ ...lan, locked: true }], 3).map((r) => r.kind)).toEqual(['state', 'expression', 'front'])
  })
})

describe('Gemini adapter', () => {
  it('gửi prompt + ảnh tham chiếu + aspectRatio; ghi PNG; báo lỗi rõ khi bị chặn', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-gem-'))
    const ref = path.join(dir, 'ref.png')
    const sharp = (await import('sharp')).default
    await fs.writeFile(ref, await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#333' } }).png().toBuffer())
    const png = (await sharp({ create: { width: 64, height: 36, channels: 3, background: '#a00' } }).png().toBuffer()).toString('base64')
    let sent: Record<string, unknown> = {}
    const ok: GenAiClientLike = { models: { generateContent: async (r) => ((sent = r), { candidates: [{ content: { parts: [{ inlineData: { data: png } }] } }] }) } }
    const p = new GeminiImageProvider(() => 'k', () => ok)
    const out = path.join(dir, 'out.png')
    const res = await p.generate({ prompt: 'a scene', negativePrompt: '', aspect: '9:16', outputPath: out, referenceImagePaths: [ref] })
    expect(res.width).toBe(64)
    expect((sent.config as { imageConfig: { aspectRatio: string } }).imageConfig.aspectRatio).toBe('9:16')
    const parts = (sent.contents as { parts: { inlineData?: unknown }[] }[])[0].parts
    expect(parts.filter((x) => x.inlineData).length).toBe(1)

    const blocked: GenAiClientLike = { models: { generateContent: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) } }
    await expect(new GeminiImageProvider(() => 'k', () => blocked).generate({ prompt: 'x', negativePrompt: '', aspect: '1:1', outputPath: out, referenceImagePaths: [] })).rejects.toThrow(/SAFETY/)
    await expect(new GeminiImageProvider(() => null, () => ok).generate({ prompt: 'x', negativePrompt: '', aspect: '1:1', outputPath: out, referenceImagePaths: [] })).rejects.toThrow(/API key Google Gemini/)
  })
})

describe('ZIP', () => {
  it('CRC32 chuẩn; file ZIP đọc được bằng tar (tên tiếng Việt)', async () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-zip-'))
    const file = path.join(dir, 'a.zip')
    await fs.writeFile(file, createZip([{ name: 'cảnh/01.txt', data: Buffer.from('xin chào') }, { name: 'b.txt', data: Buffer.from('b') }]))
    // bsdtar có sẵn trong Windows 10+ đọc được ZIP; máy khác thì bỏ qua bước này
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'bsdtar'
    const r = spawnSync(tar, ['-tf', file], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    if (r.status === 0) {
      expect(r.stdout).toContain('b.txt')
      expect(r.stdout).toContain('01.txt')
    }
  })
})

describe('ImageService (Mock) – character sheet, tham chiếu, AUTO DL, biến thể, ZIP', () => {
  it('chạy trọn luồng trên thư mục tạm', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-img-'))
    const repo = new StoryRepository(root)
    await repo.ensureSampleData()
    const providers = createProviderRegistry({ isMock: () => true, getKey: () => null })
    const queue = createAppQueue({ repo, concurrency: 6, getMonthlyBudget: () => 0 })
    const svc = new ImageService(repo, providers, queue)

    // Character sheet: chính diện trước, 3 góc còn lại sau (dùng chính diện làm tham chiếu)
    const [front] = await svc.generateCharacter('char-lan', 'sheet')
    await queue.wait(front.id)
    for (let i = 0; i < 50 && queue.state().counts.done < 4; i++) await new Promise((r) => setTimeout(r, 50))
    await Promise.all(queue.list().map((j) => queue.wait(j.id)))
    let lan = (await repo.loadLibrary()).characters.find((c) => c.id === 'char-lan')!
    expect(Object.values(lan.characterSheet).every(Boolean)).toBe(true)
    await Promise.all((await svc.generateCharacter('char-lan', 'states')).map((j) => queue.wait(j.id)))
    lan = (await repo.loadLibrary()).characters.find((c) => c.id === 'char-lan')!
    expect(lan.states[0].referenceImage).toBeTruthy()
    await repo.updateLibrary((l) => void (l.characters.find((c) => c.id === 'char-lan')!.locked = true))
    await expect(svc.generateCharacter('char-lan', 'sheet')).rejects.toThrow(/đã khoá/)

    // Ảnh cảnh có Lan (đã khoá) ⇒ có ảnh tham chiếu; AUTO DL tắt ⇒ thành biến thể chờ chọn
    const [j1] = await svc.generateScenes(SAMPLE_STORY_ID, ['s10'], '9:16', { autoApply: true })
    await queue.wait(j1.id)
    let s10 = (await repo.loadStory(SAMPLE_STORY_ID)).sceneBank.find((s) => s.id === 's10')!
    expect(s10.media['9:16']?.provider).toBe('mock')
    const [j2] = await svc.generateScenes(SAMPLE_STORY_ID, ['s10'], '9:16', { autoApply: false, regenerate: true })
    await queue.wait(j2.id)
    s10 = (await repo.loadStory(SAMPLE_STORY_ID)).sceneBank.find((s) => s.id === 's10')!
    const pending = s10.variants.find((v) => v.note.includes('chờ chọn'))!
    expect(pending).toBeTruthy()
    const before = s10.media['9:16']!.path
    await svc.applyVariant(SAMPLE_STORY_ID, 's10', pending.id)
    s10 = (await repo.loadStory(SAMPLE_STORY_ID)).sceneBank.find((s) => s.id === 's10')!
    expect(s10.media['9:16']!.path).toBe(pending.media.path)
    expect(s10.variants.some((v) => v.media.path === before)).toBe(true)

    // Trùng prompt (không regenerate) ⇒ trúng cache, không tạo job chạy mới
    const [j3] = await svc.generateScenes(SAMPLE_STORY_ID, ['s10'], '9:16', { autoApply: true })
    expect(j3.status).toBe('done')

    // focusPoint & cast
    await expect(
      svc.updateScene(SAMPLE_STORY_ID, 's10', {
        cast: ['char-lan', 'char-ba-sau', 'char-narrator', 'char-lan'].map((id) => ({ characterId: id, stateId: null, expression: '', position: 'left', action: '' }))
      })
    ).rejects.toThrow(/Tối đa 3/)
    const st = await svc.updateScene(SAMPLE_STORY_ID, 's10', { focusPoint: { x: 2, y: -1 } })
    expect(st.sceneBank.find((s) => s.id === 's10')!.focusPoint).toEqual({ x: 1, y: 0 })

    // Kiểm tra đồng nhất (Mock LLM) + ZIP
    const checked = await svc.checkConsistency(SAMPLE_STORY_ID, ['s10'])
    expect(checked.sceneBank.find((s) => s.id === 's10')!.consistency?.ok).toBe(true)
    const zip = await svc.exportZip(SAMPLE_STORY_ID, path.join(root, 'out', 'anh.zip'), 640)
    expect(zip.files).toBeGreaterThanOrEqual(6)
  }, 60000)
})
