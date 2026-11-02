/**
 * SMOKE TEST: chạy TOÀN BỘ pipeline (Mock LLM + Mock TTS + ảnh placeholder + video Mock) và render MP4 thật.
 * Dữ liệu ghi vào thư mục có dấu tiếng Việt + khoảng trắng để kiểm tra đường dẫn Unicode.
 * Chạy: npm run smoke
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DepthEstimator } from '../../src/main/media/depth'
import { ffprobePath, probeDuration } from '../../src/main/media/ffmpeg'
import { measureLufs } from '../../src/main/media/mix'
import { startMediaServer, type MediaServer } from '../../src/main/media/mediaServer'
import { PipelineRunner } from '../../src/main/pipeline/runner'
import { createProviderRegistry, type ProviderRegistry } from '../../src/main/providers/registry'
import { MockVideoProvider } from '../../src/main/providers/video/mockVideo'
import { createAppQueue } from '../../src/main/queue/appQueue'
import { renderVideo } from '../../src/main/render/renderCore'
import { ImageService } from '../../src/main/services/imageService'
import { MotionService } from '../../src/main/services/motionService'
import { SoundService } from '../../src/main/services/soundService'
import { PublishService } from '../../src/main/services/publishService'
import { StoryService } from '../../src/main/services/storyService'
import { StoryRepository } from '../../src/main/storage/storyRepo'
import { RELEASE_PIPELINE } from '../../src/shared/pipeline'
import { CHANNEL_NARRATOR_ID, SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, SAMPLE_YT_RELEASE_ID } from '../../src/shared/sampleData'

const ROOT = path.resolve('.smoke-output', 'Dữ liệu thử nghiệm')
let repo: StoryRepository
let server: MediaServer
let runner: PipelineRunner
let paidRunner: PipelineRunner
const providers = createProviderRegistry({ isMock: () => true, getKey: () => null })

/** Video "có tính phí" giả lập ⇒ kiểm tra luồng báo giá + chờ quyết định ở bước 16 */
class PaidMockVideo extends MockVideoProvider {
  override estimateCost(d: number): number {
    return d * 0.1
  }
}

function makeRunner(p: ProviderRegistry): PipelineRunner {
  const queue = createAppQueue({ repo, concurrency: 8, getMonthlyBudget: () => 0 })
  return new PipelineRunner({
    repo,
    providers: p,
    images: new ImageService(repo, p, queue),
    motion: new MotionService(repo, p, queue, new DepthEstimator(path.resolve('.smoke-output', 'models'))),
    sound: new SoundService(repo, p, () => path.join(ROOT, 'Âm thanh')),
    publish: new PublishService({ repo, providers: p, renderer: { render: renderVideo }, remotionEntry: path.resolve('src/remotion/index.ts'), mediaBaseUrl: server.baseUrl, getRenderScale: () => 0.5 }),
    renderer: { render: renderVideo },
    remotionEntry: path.resolve('src/remotion/index.ts'),
    mediaBaseUrl: server.baseUrl,
    getRenderScale: () => 0.5,
    emitProgress: () => undefined,
    emitDataChanged: () => undefined
  })
}

beforeAll(async () => {
  await fs.rm(ROOT, { recursive: true, force: true })
  repo = new StoryRepository(ROOT)
  await repo.ensureSampleData()
  server = await startMediaServer(() => repo.storiesRoot)
  runner = makeRunner(providers)
  paidRunner = makeRunner(createProviderRegistry({ isMock: () => true, getKey: () => null, overrides: { video: new PaidMockVideo() } }))
})

afterAll(async () => {
  await server?.close()
})

function streams(file: string): string[] {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

/** Chạy tới hết; decide(stepNo) quyết định cho bước duyệt có điều kiện */
async function runToEnd(r: PipelineRunner, storyId: string, releaseId: string, mode: 'review' | 'fullAuto', decide: (no: number) => 'approved' | 'declined' = () => 'approved'): Promise<string[]> {
  const seen: string[] = []
  await r.start(storyId, releaseId, mode)
  await r.waitIdle(storyId, releaseId)
  for (let guard = 0; guard < 12; guard++) {
    const rel = await repo.loadRelease(storyId, releaseId)
    const failed = RELEASE_PIPELINE.find((d) => rel.pipelineState?.steps[d.no].status === 'failed')
    if (failed) throw new Error(`Bước ${failed.no} lỗi: ${rel.pipelineState?.steps[failed.no].error}`)
    const waiting = RELEASE_PIPELINE.find((d) => rel.pipelineState?.steps[d.no].status === 'waitingApproval')
    if (!waiting) return seen
    seen.push(`${waiting.no}:${rel.pipelineState?.steps[waiting.no].message ?? ''}`)
    await r.continue(storyId, releaseId, waiting.approval ? 'approved' : decide(waiting.no))
    await r.waitIdle(storyId, releaseId)
  }
  return seen
}

async function exportedMp4(storyId: string, releaseId: string): Promise<string> {
  const dir = path.join(repo.releaseDir(storyId, releaseId), 'exports')
  const mp4 = (await fs.readdir(dir)).filter((f) => f.endsWith('.mp4') && !f.includes('_shorts_teaser_'))
  expect(mp4.length).toBe(1)
  return path.join(dir, mp4[0])
}

describe('Pipeline end-to-end (Mock)', () => {
  it('TikTok VI mẫu: điểm duyệt, câu thoại nhân vật, parallax + video AI (Mock), sound design + mix ≈ -14 LUFS, MP4 9:16', async () => {
    await runner.start(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, 'review')
    await runner.waitIdle(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    expect((await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)).pipelineState?.steps[7].status).toBe('waitingApproval')
    const waits = await runToEnd(runner, SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, 'review')
    // Video Mock miễn phí ⇒ không dừng báo giá ở bước 16
    expect(waits.some((w) => w.startsWith('16:'))).toBe(false)

    const rel = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    const dialog = rel.script.lines.filter((l) => l.speakerId !== CHANNEL_NARRATOR_ID)
    expect(dialog.length).toBeGreaterThanOrEqual(3)
    expect(rel.scenes.some((s) => s.motion.level === 'parallax')).toBe(true)
    expect(rel.scenes.some((s) => s.motion.level === 'aiVideo')).toBe(true)
    expect(rel.soundCues.some((c) => c.kind === 'ambience')).toBe(true)
    expect(rel.soundCues.some((c) => c.kind === 'stinger')).toBe(true)
    expect(rel.voiceTrack?.mixedPath).toMatch(/mix\.wav$/)
    expect(Math.abs((rel.voiceTrack?.mixLufs ?? 0) + 14)).toBeLessThan(1.5)

    const file = await exportedMp4(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    expect(Math.abs((await probeDuration(file)) - (rel.voiceTrack?.duration ?? 0))).toBeLessThan(0.5)
    expect(streams(file).sort()).toEqual(['audio', 'video'])
    expect(Math.abs((await measureLufs(file)) + 14)).toBeLessThan(2)
    const sources = JSON.parse(await fs.readFile(path.join(repo.releaseDir(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID), 'sources.json'), 'utf8'))
    expect(sources.sound.every((s: { kind: string; asset: { licenseConfirmed: boolean } | null }) => s.kind === 'silence' || s.asset?.licenseConfirmed)).toBe(true)
    // GĐ5 – bước 22: gói TikTok + ảnh bìa 9:16 + checklist
    const pub = rel.publishing!
    expect(pub.tiktok?.captionVi.length).toBeGreaterThan(10)
    expect(pub.tiktok?.hashtags.every((h) => h.startsWith('#'))).toBe(true)
    expect(pub.selectedThumbnail).toBeTruthy()
    expect(pub.checklist.find((c) => c.id === 'render')?.done).toBe(true)
    expect(pub.checklist.find((c) => c.id === 'no-mock')?.done).toBe(false)
    expect(rel.pipelineState?.steps[23].status).toBe('skipped')
    console.log(`TikTok MP4: ${file}`)
  })

  it('YouTube EN mẫu: video AI có phí ⇒ báo giá ★16, Bỏ qua ⇒ cảnh hero dùng Mức 1/2; cảnh người kể; MP4 16:9', async () => {
    const waits = await runToEnd(paidRunner, SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID, 'review', () => 'declined')
    const quote = waits.find((w) => w.startsWith('16:'))
    expect(quote).toMatch(/Báo giá video AI/)
    const rel = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID)
    expect(rel.pipelineState?.steps[16].message).toMatch(/bỏ qua/i)
    expect(rel.scenes.some((s) => s.isHero)).toBe(true)
    expect(rel.scenes.every((s) => s.motion.level !== 'aiVideo')).toBe(true)
    const story = await repo.loadStory(SAMPLE_STORY_ID)
    const narratorScenes = rel.scenes.filter((s) => story.sceneBank.find((b) => b.id === s.sceneBankId)?.cast.some((c) => c.characterId === CHANNEL_NARRATOR_ID))
    expect(narratorScenes.length).toBeGreaterThanOrEqual(2)
    // GĐ5 – bước 22: gói YouTube (mô tả có chapters + nguồn truyền thuyết), thumbnail 1280×720
    const pub = rel.publishing!
    expect(pub.youtube?.titleOptions.length).toBeGreaterThanOrEqual(3)
    expect(pub.youtube?.titleOptionsVi.length).toBe(pub.youtube?.titleOptions.length)
    expect(pub.youtube?.description).toMatch(/0:00/)
    expect(pub.youtube?.description).toMatch(/legend/i)
    expect(pub.aiDisclosureNeeded).toBe(true)
    const thumb = repo.resolveInStory(SAMPLE_STORY_ID, pub.selectedThumbnail!)
    expect(await sharp(thumb).metadata()).toMatchObject({ width: 1280, height: 720 })
    // bước 23: Shorts teaser 9:16, 30–60s, có tiếng
    expect(pub.shorts?.path).toBeTruthy()
    const teaser = repo.resolveInStory(SAMPLE_STORY_ID, pub.shorts!.path!)
    const tlen = await probeDuration(teaser)
    expect(tlen).toBeGreaterThanOrEqual(25)
    expect(tlen).toBeLessThanOrEqual(61)
    expect(streams(teaser).sort()).toEqual(['audio', 'video'])
    const mp4s = (await fs.readdir(path.dirname(teaser))).filter((f) => f.endsWith('.mp4'))
    const file = path.join(path.dirname(teaser), mp4s.find((f) => !f.includes('_shorts_teaser_'))!)
    expect(streams(file).sort()).toEqual(['audio', 'video'])
    console.log(`YouTube MP4: ${file}
Shorts teaser: ${teaser} (${tlen.toFixed(1)}s)`)
  })

  it('Story mới bằng Mock LLM: dàn ý → nhân vật → cảnh → TikTok chia 2 phần → MP4', async () => {
    const svc = new StoryService(repo, () => providers.llm())
    const lib = await repo.loadLibrary()
    let story = await svc.createStory({
      name: 'Bùa ngải thử nghiệm',
      channelPresetId: lib.channelPresets[0].id,
      folkloreIds: [lib.folklore[0].id],
      premiseVi: 'Một chàng trai về quê dự đám giỗ, phát hiện chiếc bùa lạ dưới gối và những giấc mơ lặp lại mỗi đêm.',
      budgetUsd: 5
    })
    await expect(svc.proposeCast(story.id)).rejects.toThrow(/duyệt dàn ý/)
    story = await svc.generateOutline(story.id)
    expect(story.outline.beats.length).toBeGreaterThanOrEqual(5)
    await svc.approveOutline(story.id)
    await svc.proposeCast(story.id)
    const cast = (await repo.loadLibrary()).characters.filter((c) => c.storyId === story.id)
    expect(cast.find((c) => c.role === 'entity')?.voiceProfileIdByLanguage.vi).toBe('voice-vi-ma-da')
    story = await svc.proposeSceneBank(story.id)
    expect(story.sceneBank.some((s) => s.cast.some((c) => c.characterId === CHANNEL_NARRATOR_ID))).toBe(true)

    const rel = await svc.createRelease(story.id, { platform: 'tiktok', language: 'vi', targetDurationSec: 90, plannedParts: 2 })
    await runToEnd(runner, story.id, rel.id, 'fullAuto')
    const bundle = await repo.loadBundle(story.id)
    const parts = bundle.releases.filter((r) => r.seriesGroupId === `series-${rel.id}`)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const p of parts) {
      expect(p.partCount).toBe(parts.length)
      expect(p.script.sections.map((s) => s.kind)[0]).toBe('hook')
    }
    await exportedMp4(story.id, rel.id)
    const p2 = parts.find((p) => p.partIndex === 2)!
    await runToEnd(runner, story.id, p2.id, 'fullAuto')
    const p2file = await exportedMp4(story.id, p2.id)
    expect(streams(p2file).sort()).toEqual(['audio', 'video'])
    console.log(`Series phần 2 MP4: ${p2file}`)
  })
})
