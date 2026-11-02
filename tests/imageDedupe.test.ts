/**
 * Hồi quy: 2 cảnh trùng prompt (LLM Mock hay sinh ra) và 2 Story trùng prompt phải được tạo ảnh RIÊNG.
 * Lỗi cũ: hàng đợi gộp theo cacheKey ⇒ cảnh thứ 2 không có ảnh; trúng cache Story cũ ⇒ ảnh ghi vào Story cũ;
 * bước 6 vẫn báo "Đã tạo 16 ảnh".
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProviderRegistry } from '../src/main/providers/registry'
import { createAppQueue } from '../src/main/queue/appQueue'
import { ImageService } from '../src/main/services/imageService'
import { StoryRepository } from '../src/main/storage/storyRepo'
import { SAMPLE_STORY_ID } from '../src/shared/sampleData'
import type { Story } from '../src/shared/types'

let root: string
let repo: StoryRepository
let images: ImageService

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-dedupe-'))
  repo = new StoryRepository(root)
  await repo.ensureSampleData()
  const providers = createProviderRegistry({ isMock: () => true, getKey: () => null })
  images = new ImageService(repo, providers, createAppQueue({ repo, concurrency: 4, getMonthlyBudget: () => 0 }))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** Sao chép Story mẫu thành Story mới (cùng id cảnh, cùng prompt) */
async function cloneStory(id: string): Promise<void> {
  const src = await repo.loadStory(SAMPLE_STORY_ID)
  const copy: Story = { ...structuredClone(src), id, name: `${src.name} (bản sao)`, releaseIds: [] }
  copy.sceneBank.forEach((s) => (s.media = { '16:9': null, '9:16': null }))
  await fs.mkdir(path.join(repo.storiesRoot, id), { recursive: true })
  await repo.saveStory(copy)
}

describe('tạo ảnh ngân hàng cảnh – không gộp nhầm job', () => {
  it('2 cảnh trùng mô tả/prompt trong cùng Story đều có ảnh riêng', async () => {
    await repo.updateStory(SAMPLE_STORY_ID, (s) => {
      // biến s02 thành bản sao y hệt s01 (khác id)
      const s01 = s.sceneBank[0]
      s.sceneBank[1] = { ...structuredClone(s01), id: s.sceneBank[1].id }
      s.sceneBank.forEach((b) => (b.media = { '16:9': null, '9:16': null }))
    })
    const r = await images.ensureSceneImages(SAMPLE_STORY_ID, new AbortController().signal, () => undefined)
    const story = await repo.loadStory(SAMPLE_STORY_ID)
    expect(story.sceneBank.every((b) => b.media['16:9'] !== null)).toBe(true)
    expect(story.sceneBank[0].media['16:9']!.path).not.toBe(story.sceneBank[1].media['16:9']!.path)
    expect(r.created).toBe(story.sceneBank.length)
  })

  it('Story thứ 2 trùng prompt với Story đã tạo ảnh: ảnh ghi vào ĐÚNG Story mới, Story cũ không đổi', async () => {
    await images.ensureSceneImages(SAMPLE_STORY_ID, new AbortController().signal, () => undefined)
    const firstBefore = JSON.stringify((await repo.loadStory(SAMPLE_STORY_ID)).sceneBank.map((b) => b.media['16:9']?.path))
    await cloneStory('story-ban-sao')
    await images.ensureSceneImages('story-ban-sao', new AbortController().signal, () => undefined)
    const second = await repo.loadStory('story-ban-sao')
    expect(second.sceneBank.every((b) => b.media['16:9'] !== null)).toBe(true)
    for (const b of second.sceneBank) {
      await expect(fs.access(repo.resolveInStory('story-ban-sao', b.media['16:9']!.path))).resolves.toBeUndefined()
    }
    expect(JSON.stringify((await repo.loadStory(SAMPLE_STORY_ID)).sceneBank.map((b) => b.media['16:9']?.path))).toBe(firstBefore)
  })
})
