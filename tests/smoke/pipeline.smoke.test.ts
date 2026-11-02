/**
 * SMOKE TEST: chạy TOÀN BỘ pipeline (Mock LLM + Mock TTS + ảnh placeholder + video Mock) và render MP4 thật.
 * Dữ liệu ghi vào thư mục có dấu tiếng Việt + khoảng trắng để kiểm tra đường dẫn Unicode.
 * Chạy: npm run smoke
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { RecordingService } from '../../src/main/services/recordingService'
import { ExportService } from '../../src/main/services/exportService'
import { PuppetService } from '../../src/main/services/puppetService'
import { StoryService } from '../../src/main/services/storyService'
import { StoryRepository } from '../../src/main/storage/storyRepo'
import { RELEASE_PIPELINE } from '../../src/shared/pipeline'
import { spoilerBeatIds } from '../../src/shared/logic/shorts'
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
    recording: new RecordingService(repo, p),
    puppet: new PuppetService(repo),
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
  await new PuppetService(repo).ensureSampleRig()
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
    // GĐ7.1: người kể có rối Mock ⇒ một phần cảnh người kể thành cảnh rối khớp môi (≤ 15% thời lượng)
    const puppetScenes = rel.scenes.filter((s) => s.kind === 'puppet')
    expect(puppetScenes.length).toBeGreaterThanOrEqual(1)
    expect(puppetScenes.reduce((a, s) => a + s.end - s.start, 0)).toBeLessThanOrEqual(0.15 * (rel.voiceTrack?.duration ?? 0) + 0.01)
    expect(puppetScenes.every((s) => !s.isHero && s.motion.level !== 'parallax')).toBe(true)
    const narratorLines = rel.script.lines.filter((l) => l.speakerId === CHANNEL_NARRATOR_ID)
    expect(narratorLines.every((l) => (l.mouthCues?.length ?? 0) > 0)).toBe(true)
    console.log(`Cảnh rối: ${puppetScenes.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)}s`).join(', ')}`)
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
    // Teaser không lộ cao trào: mọi câu trong đoạn teaser thuộc beat trước cao trào
    const spoilers = spoilerBeatIds(story.outline.beats)
    const inTeaser = rel.script.lines.filter((l) => l.start != null && l.end != null && l.start >= pub.shorts!.start - 0.01 && l.end <= pub.shorts!.end + 0.01)
    expect(inTeaser.length).toBeGreaterThan(3)
    expect(inTeaser.every((l) => !spoilers.has(l.beatId))).toBe(true)
    // Checklist: render mới ⇒ xong; sửa cảnh sau render ⇒ báo bản render đã cũ
    const publish = new PublishService({ repo, providers, renderer: { render: renderVideo }, remotionEntry: path.resolve('src/remotion/index.ts'), mediaBaseUrl: server.baseUrl, getRenderScale: () => 0.5 })
    expect(pub.checklist.find((c) => c.id === 'render')?.done).toBe(true)
    await repo.updateRelease(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID, (r) => {
      r.scenes[1].motion = { ...r.scenes[1].motion, intensity: Math.min(1, r.scenes[1].motion.intensity + 0.2) }
    })
    const staleItem = (await publish.refreshChecklist(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID)).publishing!.checklist.find((c) => c.id === 'render')!
    expect(staleItem.done).toBe(false)
    expect(staleItem.detail).toMatch(/đã cũ/)
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
    // Luật đa dạng: không 2 cảnh liền nhau cùng kiểu chuyển động (kể cả 2 clip video AI)
    const p1 = await repo.loadRelease(story.id, rel.id)
    expect(p1.scenes.every((s, i) => i === 0 || s.motion.type !== p1.scenes[i - 1].motion.type)).toBe(true)
    expect(p1.pipelineState?.steps[17].message).toMatch(/· 0 vi phạm đa dạng/)
    const p2 = parts.find((p) => p.partIndex === 2)!
    await runToEnd(runner, story.id, p2.id, 'fullAuto')
    const p2file = await exportedMp4(story.id, p2.id)
    expect(streams(p2file).sort()).toEqual(['audio', 'video'])
    console.log(`Series phần 2 MP4: ${p2file}`)
  })

  it('GĐ6 – giọng tự thu: nhập file đọc cả bài → chép lời (Mock) → căn mốc ≈ mốc thật → MP4 có phụ đề theo mốc từ', async () => {
    // "Bản tự thu" = voice track TTS đã có của bản TikTok (biết trước mốc đúng của từng câu)
    const before = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    const truth = new Map(before.script.lines.map((l) => [l.id, { start: l.start as number, end: l.end as number }]))
    const tmp = await fs.mkdtemp(path.join(ROOT, 'thu âm '))
    const recFile = path.join(tmp, 'Bản đọc của tôi.wav')
    await fs.copyFile(repo.resolveInStory(SAMPLE_STORY_ID, before.voiceTrack!.processedPath!), recFile)

    const recording = new RecordingService(repo, providers)
    await recording.importRecording(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, recFile)
    await runner.resetFrom(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, 11)
    await runToEnd(runner, SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID, 'review')

    const rel = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    expect(rel.voiceSource).toBe('recorded')
    expect(rel.voiceTrack?.mode).toBe('recorded')
    expect(rel.recording?.transcript?.provider).toBe('mock-stt')
    expect(rel.recording?.coverage ?? 0).toBeGreaterThan(0.85)
    expect(rel.pipelineState?.steps[11].message).toMatch(/Tự thu: căn mốc/)
    // Mốc căn được gần mốc thật (Mock rải từ theo độ dài ⇒ cho phép lệch ≤ 0,6 s)
    const errs = rel.script.lines.map((l) => Math.abs((l.start as number) - truth.get(l.id)!.start))
    expect(errs.filter((e) => e < 0.6).length / errs.length).toBeGreaterThan(0.8)
    expect(rel.script.lines.every((l) => l.wordTimings && l.wordTimings.length > 0)).toBe(true)
    // Phụ đề dùng mốc từ thật
    const first = rel.script.lines[0]
    const cue = rel.subtitles.find((c) => c.id.startsWith(first.id))!
    expect(cue.words[0].start).toBeCloseTo(first.wordTimings![0].start, 2)
    const file = await exportedMp4(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID).catch(async () => {
      const dir = path.join(repo.releaseDir(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID), 'exports')
      const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.mp4') && !f.includes('_shorts_teaser_')).sort()
      return path.join(dir, all[all.length - 1])
    })
    expect(streams(file).sort()).toEqual(['audio', 'video'])
    console.log(`Tự thu: khớp ${Math.round((rel.recording?.coverage ?? 0) * 100)}%, lệch TB ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2)}s → ${file}`)
  })

  it('GĐ6 – xuất SRT, FCPXML (đường dẫn Unicode, mọi file tồn tại), CapCut theo draft mẫu; draft mã hoá ⇒ lỗi rõ ràng', async () => {
    const exporter = new ExportService(repo)
    const srt = await exporter.exportSrt(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID)
    expect(srt.files.map((f) => path.basename(f))).toEqual(expect.arrayContaining([expect.stringMatching(/\.en\.srt$/), expect.stringMatching(/\.vi\.srt$/)]))
    const en = await fs.readFile(srt.files[0], 'utf8')
    expect(en).toMatch(/^\uFEFF1\r\n00:00:0\d,\d{3} --> /)

    const fx = await exporter.exportFcpxml(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID)
    const xmlText = await fs.readFile(fx.files[0], 'utf8')
    const srcs = [...xmlText.matchAll(/src="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
    expect(srcs.length).toBeGreaterThan(5)
    for (const s of srcs) expect(await fs.stat(fileURLToPath(s)).then(() => true, () => false)).toBe(true)
    expect(xmlText).toMatch(/<marker /)

    // Draft CapCut mẫu (giả lập cấu trúc) + thư mục draft riêng
    const draftsRoot = await fs.mkdtemp(path.join(ROOT, 'capcut drafts '))
    const tplDir = path.join(draftsRoot, 'Mẫu của tôi')
    await fs.mkdir(tplDir, { recursive: true })
    const tpl = {
      id: 'TPL', duration: 5_000_000, fps: 30, canvas_config: { width: 1080, height: 1920, ratio: 'original' },
      materials: {
        videos: [{ id: 'V1', path: 'C:/x.png', type: 'photo', duration: 10_800_000_000 }],
        audios: [{ id: 'A1', path: 'C:/x.mp3', duration: 5_000_000 }],
        texts: [{ id: 'T1', content: JSON.stringify({ text: 'Mẫu', styles: [{ range: [0, 3], size: 8 }] }) }],
        speeds: [{ id: 'S1', speed: 1 }, { id: 'S2', speed: 1 }]
      },
      tracks: [
        { id: 'TV', type: 'video', segments: [{ id: 'G1', material_id: 'V1', extra_material_refs: ['S1'], target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 0, duration: 5_000_000 } }] },
        { id: 'TA', type: 'audio', segments: [{ id: 'G2', material_id: 'A1', extra_material_refs: ['S2'], target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 0, duration: 5_000_000 } }] },
        { id: 'TT', type: 'text', segments: [{ id: 'G3', material_id: 'T1', extra_material_refs: [], target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: null }] }
      ]
    }
    await fs.writeFile(path.join(tplDir, 'draft_content.json'), JSON.stringify(tpl), 'utf8')
    await fs.writeFile(path.join(tplDir, 'draft_meta_info.json'), JSON.stringify({ draft_name: 'Mẫu của tôi', draft_id: 'TPL' }), 'utf8')
    const cc = await exporter.exportCapcut(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID, tplDir, draftsRoot)
    const out = JSON.parse(await fs.readFile(path.join(cc.files[0], 'draft_content.json'), 'utf8'))
    const meta = JSON.parse(await fs.readFile(path.join(cc.files[0], 'draft_meta_info.json'), 'utf8'))
    const rel = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID)
    const vSegs = out.tracks.find((t: { type: string }) => t.type === 'video').segments
    expect(vSegs.length).toBeGreaterThanOrEqual(rel.scenes.length)
    for (const m of out.materials.videos) expect(await fs.stat(m.path).then(() => true, () => false)).toBe(true)
    expect(out.tracks.find((t: { type: string }) => t.type === 'text').segments.length).toBeGreaterThan(5)
    expect(meta.draft_name).toBe(path.basename(cc.files[0]))
    expect(out.canvas_config).toMatchObject({ width: 1920, height: 1080 })
    // Xuất lần 2 không ghi đè draft cũ
    const cc2 = await exporter.exportCapcut(SAMPLE_STORY_ID, SAMPLE_YT_RELEASE_ID, tplDir, draftsRoot)
    expect(cc2.files[0]).not.toBe(cc.files[0])
    // Draft mã hoá
    const enc = path.join(draftsRoot, 'Mẫu mã hoá')
    await fs.mkdir(enc)
    await fs.writeFile(path.join(enc, 'draft_content.json'), Buffer.from([0x8a, 0x13, 0xff, 0x00, 0x42, 0x99]))
    await expect(exporter.readCapcutTemplate(enc)).rejects.toThrow(/mã hoá/)
    console.log(`Xuất: ${[...srt.files, fx.files[0], cc.files[0]].join('\n  ')}`)
  })
})
