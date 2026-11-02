/**
 * Thay dữ liệu dùng chung của Story ⇒ bản phát hành được đặt lại đúng bước (không render với dữ liệu sai).
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockLlmProvider } from '../src/main/llm/mockLlm'
import { StoryService } from '../src/main/services/storyService'
import { StoryRepository } from '../src/main/storage/storyRepo'
import { applyCastRemap, beatEditImpact, remapCast } from '../src/shared/logic/invalidation'
import { createInitialPipelineState, RELEASE_PIPELINE } from '../src/shared/pipeline'
import { CHANNEL_NARRATOR_ID, SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, SAMPLE_YT_RELEASE_ID } from '../src/shared/sampleData'
import type { Character, MediaRef, Release } from '../src/shared/types'

const img = (p: string): MediaRef => ({ path: p, mediaType: 'image', source: 'ai', provider: 'mock', model: 'm', cost: 0, createdAt: '2026-01-01T00:00:00Z' })

let root: string
let repo: StoryRepository
let running = new Set<string>()
let svc: StoryService

/** Đánh dấu release đã chạy hết pipeline + có cảnh đã gán, ngân hàng cảnh có ảnh */
async function completeAll(): Promise<void> {
  await repo.updateStory(SAMPLE_STORY_ID, (s) => {
    s.outline.approval = { status: 'approved', at: '2026-01-01T00:00:00Z' }
    s.sceneBank.forEach((b, i) => (b.media['16:9'] = img(`bank/${b.id}.png`)) && i)
  })
  const story = await repo.loadStory(SAMPLE_STORY_ID)
  for (const rid of [SAMPLE_TT_RELEASE_ID, SAMPLE_YT_RELEASE_ID]) {
    await repo.updateRelease(SAMPLE_STORY_ID, rid, (r) => {
      const st = createInitialPipelineState('review')
      for (const d of RELEASE_PIPELINE) st.steps[d.no] = { status: 'done', progress: 1 }
      r.pipelineState = st
      r.scenes = story.sceneBank.slice(0, 3).map((b, i) => ({ ...(r.scenes[0] ?? {}), id: `rs${i}`, sceneBankId: b.id }) as Release['scenes'][number])
    })
  }
}

const steps = (r: Release): Record<number, string> => Object.fromEntries(RELEASE_PIPELINE.map((d) => [d.no, r.pipelineState?.steps[d.no]?.status ?? 'none']))
const pendingFrom = (r: Release): number | null => {
  const s = steps(r)
  const first = RELEASE_PIPELINE.find((d) => s[d.no] === 'pending')
  return first ? first.no : null
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-inv-'))
  repo = new StoryRepository(root)
  await repo.ensureSampleData()
  running = new Set()
  svc = new StoryService(repo, () => new MockLlmProvider(), (_s, r) => running.has(r))
  await completeAll()
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('đề xuất lại ngân hàng cảnh', () => {
  it('release bỏ cảnh đã gán, các bước từ 6 về "Chờ"; bước trước 6 không đụng', async () => {
    await svc.proposeSceneBank(SAMPLE_STORY_ID)
    for (const rid of [SAMPLE_TT_RELEASE_ID, SAMPLE_YT_RELEASE_ID]) {
      const r = await repo.loadRelease(SAMPLE_STORY_ID, rid)
      expect(r.scenes).toEqual([])
      expect(pendingFrom(r)).toBe(6)
      expect(RELEASE_PIPELINE.every((d) => steps(r)[d.no] === 'pending')).toBe(true)
      // kịch bản giữ nguyên (không phụ thuộc ngân hàng cảnh)
      expect(r.script.lines.length).toBeGreaterThan(0)
    }
    const story = await repo.loadStory(SAMPLE_STORY_ID)
    expect(story.sceneBank.every((b) => b.media['16:9'] === null)).toBe(true)
  })

  it('đang chạy pipeline ⇒ từ chối, không đổi gì', async () => {
    running.add(SAMPLE_YT_RELEASE_ID)
    const before = (await repo.loadStory(SAMPLE_STORY_ID)).sceneBank
    await expect(svc.proposeSceneBank(SAMPLE_STORY_ID)).rejects.toThrow(/đang chạy pipeline/)
    expect((await repo.loadStory(SAMPLE_STORY_ID)).sceneBank).toEqual(before)
    expect((await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID)).scenes.length).toBe(3)
  })
})

describe('tạo lại dàn ý', () => {
  it('bỏ ngân hàng cảnh + kịch bản/cảnh/giọng của release, chạy lại từ bước 6', async () => {
    await svc.generateOutline(SAMPLE_STORY_ID)
    const story = await repo.loadStory(SAMPLE_STORY_ID)
    expect(story.outline.approval.status).toBe('pending')
    expect(story.sceneBank).toEqual([])
    const r = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    expect(r.script.lines).toEqual([])
    expect(r.scenes).toEqual([])
    expect(r.voiceTrack).toBeNull()
    expect(pendingFrom(r)).toBe(6)
  })
})

describe('sửa beat trong dàn ý', () => {
  it('chỉ sửa chữ ⇒ release không bị đặt lại', async () => {
    const s = await repo.loadStory(SAMPLE_STORY_ID)
    await svc.updateStory(SAMPLE_STORY_ID, { beats: s.outline.beats.map((b) => ({ ...b, summaryVi: b.summaryVi + ' (sửa)' })) })
    expect(pendingFrom(await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID))).toBeNull()
  })

  it('đổi cường độ ⇒ từ bước 16; giữ cảnh đã gán', async () => {
    const s = await repo.loadStory(SAMPLE_STORY_ID)
    await svc.updateStory(SAMPLE_STORY_ID, { beats: s.outline.beats.map((b, i) => (i === 0 ? { ...b, emotionalIntensity: b.emotionalIntensity > 0.5 ? 0.1 : 0.9 } : b)) })
    const r = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    expect(pendingFrom(r)).toBe(16)
    expect(steps(r)[14]).toBe('done')
    expect(r.scenes.length).toBe(3)
  })

  it('xoá / đổi thứ tự beat ⇒ từ bước 14', async () => {
    const s = await repo.loadStory(SAMPLE_STORY_ID)
    await svc.updateStory(SAMPLE_STORY_ID, { beats: s.outline.beats.slice(0, -1) })
    expect(pendingFrom(await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID))).toBe(14)
  })
})

describe('đề xuất lại nhân vật', () => {
  it('nhân vật cũ → nhân vật mới cùng vai; cảnh có nhân vật đổi bị xoá ảnh; câu thoại đổi người nói; release từ bước 6', async () => {
    const lib = await repo.loadLibrary()
    const before = lib.characters.filter((c) => c.storyId === SAMPLE_STORY_ID && c.scope === 'story' && !c.locked)
    expect(before.length).toBeGreaterThan(0)
    await svc.proposeCast(SAMPLE_STORY_ID)
    const after = (await repo.loadLibrary()).characters
    const valid = new Set(after.map((c) => c.id))
    const story = await repo.loadStory(SAMPLE_STORY_ID)
    // Không còn tham chiếu tới nhân vật không tồn tại
    expect(story.sceneBank.every((s) => s.cast.every((m) => valid.has(m.characterId)))).toBe(true)
    for (const rid of [SAMPLE_TT_RELEASE_ID, SAMPLE_YT_RELEASE_ID]) {
      const r = await repo.loadRelease(SAMPLE_STORY_ID, rid)
      expect(r.script.lines.every((l) => valid.has(l.speakerId) || l.speakerId === CHANNEL_NARRATOR_ID)).toBe(true)
    }
    const renamed = before.filter((c) => !valid.has(c.id))
    if (renamed.length) {
      // có nhân vật đổi ⇒ cảnh của họ phải vẽ lại, release chạy lại từ 6
      expect(story.sceneBank.some((b) => b.media['16:9'] === null)).toBe(true)
      expect(pendingFrom(await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID))).toBe(6)
    }
  })
})

describe('hàm thuần', () => {
  const beat = (id: string, x = 0.5): { id: string; order: number; emotionalIntensity: number; summaryVi: string } => ({ id, order: 0, emotionalIntensity: x, summaryVi: id })
  it('beatEditImpact phân loại thay đổi', () => {
    const old = [beat('b1'), beat('b2'), beat('b3')] as never[]
    expect(beatEditImpact(old, old, [], []).resetFrom).toBeNull()
    expect(beatEditImpact(old, [beat('b1', 0.9), beat('b2'), beat('b3')] as never[], [], []).resetFrom).toBe(16)
    expect(beatEditImpact(old, [beat('b2'), beat('b1'), beat('b3')] as never[], [], []).reordered).toBe(true)
    const rel = { id: 'r', title: 'R', scenes: [], pipelineState: null, script: { lines: [{ speakerId: 'x', beatId: 'b3' }, { speakerId: 'x', beatId: 'b1' }] } }
    const i = beatEditImpact(old, [beat('b1'), beat('b2'), beat('b4')] as never[], [rel], [])
    expect(i).toMatchObject({ removed: ['b3'], added: ['b4'], resetFrom: 14, orphanLines: 1 })
  })

  it('remapCast theo vai; trùng id (cùng tên) giữ nguyên; hết người cùng vai ⇒ null', () => {
    const ch = (id: string, role: Character['role']): Character => ({ id, role }) as Character
    const m = remapCast([ch('a', 'character'), ch('b', 'character'), ch('g', 'entity'), ch('same', 'character')], [ch('x', 'character'), ch('same', 'character'), ch('y', 'entity')])
    expect([...m.entries()]).toEqual([['a', 'x'], ['b', null], ['g', 'y']])
    const bank = [{ id: 's1', cast: [{ characterId: 'a', stateId: 'st1', expression: 'sợ' }, { characterId: 'b', stateId: null, expression: '' }] }, { id: 's2', cast: [{ characterId: 'z', stateId: null, expression: '' }] }] as never[]
    const r = applyCastRemap(bank, m)
    expect(r.changedScenes).toEqual(['s1'])
    expect((r.bank[0] as { cast: unknown[] }).cast).toEqual([{ characterId: 'x', stateId: null, expression: 'sợ' }])
    expect(r.bank[1]).toBe(bank[1])
  })
})
