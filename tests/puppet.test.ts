/**
 * GĐ7.1 – rối Mock, validateRig, MouthCue từ voice track thật, dữ liệu composition cho cảnh rối, migrate.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runFfmpeg } from '../src/main/media/ffmpeg'
import { RIG_REGIONS } from '../src/main/media/mockRig'
import { completeMouthSet, PuppetService, validateRig } from '../src/main/services/puppetService'
import { StoryRepository } from '../src/main/storage/storyRepo'
import { applyWindow, buildCompositionProps, type CompositionWindow } from '../src/shared/composition'
import { platformsConfig } from '../src/shared/config'
import { migrateLibrary } from '../src/shared/migrate'
import { CHANNEL_NARRATOR_ID, SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID } from '../src/shared/sampleData'
import type { Library } from '../src/shared/types'

let root: string
let repo: StoryRepository
let svc: PuppetService

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-puppet-'))
  repo = new StoryRepository(root)
  await repo.ensureSampleData()
  svc = new PuppetService(repo)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('rối Mock', () => {
  it('người kể mẫu: ảnh gốc + 4 mắt + 9 miệng đúng kích thước vùng, validateRig đạt; bối cảnh 16:9 + 9:16 gán cho kênh', async () => {
    await svc.ensureSampleRig()
    const lib = await repo.loadLibrary()
    const narrator = lib.characters.find((c) => c.id === CHANNEL_NARRATOR_ID)!
    const rig = lib.puppetRigs.find((r) => r.id === narrator.puppetRigId)!
    expect(rig.validated).toBe(true)
    expect(Object.keys(rig.mouthSet).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'])
    const m = await sharp(repo.resolveCharacterPath(rig.mouthSet.D)).metadata()
    expect([m.width, m.height]).toEqual([RIG_REGIONS.mouth.w, RIG_REGIONS.mouth.h])
    const e = await sharp(repo.resolveCharacterPath(rig.eyeSet.closed)).metadata()
    expect([e.width, e.height]).toEqual([RIG_REGIONS.eyes.w, RIG_REGIONS.eyes.h])
    const stage = lib.puppetStages[0]
    expect((await sharp(repo.resolveCharacterPath(stage.backgroundPath['9:16'])).metadata()).height).toBe(1920)
    expect(lib.channelPresets[0].puppetStageId).toBe(stage.id)
    // gọi lại không tạo lại (đã đủ file)
    const before = rig.createdAt
    await svc.ensureSampleRig()
    expect((await repo.loadLibrary()).puppetRigs.find((r) => r.id === rig.id)!.createdAt).toBe(before)
  })

  it('9 hình miệng khác nhau thật (không phải 9 ảnh giống hệt)', async () => {
    await svc.ensureSampleRig()
    const rig = (await repo.loadLibrary()).puppetRigs[0]
    const hashes = await Promise.all(Object.values(rig.mouthSet).map(async (p) => (await sharp(repo.resolveCharacterPath(p)).raw().toBuffer()).toString('base64')))
    expect(new Set(hashes).size).toBe(9)
  })

  it('thực thể ma không được tạo rối khớp môi', async () => {
    const lib = await repo.loadLibrary()
    const ghost = lib.characters.find((c) => c.role === 'entity')!
    await expect(svc.createMockRig(ghost.id)).rejects.toThrow(/Thực thể ma/)
  })

  it('validateRig báo thiếu mắt/miệng bắt buộc; miệng phụ thiếu ⇒ cảnh báo + ánh xạ hình gần nhất', async () => {
    await svc.ensureSampleRig()
    const rig = structuredClone((await repo.loadLibrary()).puppetRigs[0])
    const exists = async (rel: string): Promise<boolean> => fs.access(repo.resolveCharacterPath(rel)).then(() => true, () => false)
    delete (rig.eyeSet as Partial<typeof rig.eyeSet>).half
    delete (rig.mouthSet as Partial<typeof rig.mouthSet>).D
    delete (rig.mouthSet as Partial<typeof rig.mouthSet>).G
    const issues = await validateRig(rig, exists)
    expect(issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | ')).toMatch(/mắt "half".*miệng D/)
    expect(issues.some((i) => i.level === 'warn' && /G/.test(i.message))).toBe(true)
    const full = completeMouthSet({ X: 'x', A: 'a', B: 'b', C: 'c', F: 'f' })
    expect(full.D).toBe('c')
    expect(full.G).toBe('b')
    expect(full.E).toBe('f')
  })
})

describe('hình miệng từ voice track + composition', () => {
  it('câu người kể có MouthCue; khép (X) khi im lặng; composition cảnh rối tất định, mốc tính từ đầu cảnh', async () => {
    await svc.ensureSampleRig()
    const lib = await repo.loadLibrary()
    const story = await repo.loadStory(SAMPLE_STORY_ID)
    const rel = await repo.loadRelease(SAMPLE_STORY_ID, SAMPLE_TT_RELEASE_ID)
    // Voice track giả: 0–1s im, 1–4s có tiếng, 4–5s im
    const wav = path.join(repo.releaseDir(SAMPLE_STORY_ID, rel.id), 'voice', 'voice_processed.wav')
    await fs.mkdir(path.dirname(wav), { recursive: true })
    await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav])
    const line = rel.script.lines.find((l) => l.speakerId === CHANNEL_NARRATOR_ID)!
    line.start = 0.5
    line.end = 4.5
    rel.voiceTrack = { mode: 'tts', processedPath: `releases/${rel.id}/voice/voice_processed.wav`, mixedPath: `releases/${rel.id}/voice/voice_processed.wav`, duration: 5 }
    const n = await svc.computeMouthCuesInto(story, rel, lib)
    expect(n).toBeGreaterThan(0)
    const cues = line.mouthCues!
    expect(cues.some((c) => c.shape !== 'X')).toBe(true)
    const at = (t: number): string => cues.find((c) => t >= c.start && t < c.end)?.shape ?? 'X'
    expect(at(0.7)).toBe('X') // im lặng thật trong voice track
    expect(at(4.3)).toBe('X')
    // Câu của nhân vật không có rối ⇒ không có cue
    expect(rel.script.lines.filter((l) => l.speakerId !== CHANNEL_NARRATOR_ID).every((l) => !l.mouthCues)).toBe(true)

    rel.scenes = [
      {
        id: 'rs-p',
        sceneBankId: story.sceneBank[0].id,
        start: 0,
        end: 5,
        lineIds: [line.id],
        mediaOverride: null,
        motion: { level: 'kenBurns', type: 'zoomIn', intensity: 0.4, easing: 'easeInOut', focusPoint: { x: 0.5, y: 0.5 } },
        transition: { type: 'cut', durationSec: 0 },
        isHero: false,
        kind: 'puppet',
        puppet: { stageId: lib.puppetStages[0].id, actors: [{ rigId: lib.puppetRigs[0].id, characterId: CHANNEL_NARRATOR_ID, position: 'center', scale: 1, flipX: false, defaultExpression: 'calm' }], camera: 'pushIn', enter: 'fade' }
      }
    ]
    const build = (): ReturnType<typeof buildCompositionProps> =>
      buildCompositionProps({
        story,
        release: rel,
        glossary: [],
        subtitleStyle: null,
        mediaUrl: (r) => `story/${r}`,
        sharedUrl: (r) => `shared/${r}`,
        puppetLib: lib,
        fps: 30,
        sizes: platformsConfig.aspectSizes,
        aspect: '9:16'
      })
    const p = build()
    const pz = p.scenes[0].puppet!
    expect(pz.stageSrc).toBe(`shared/${lib.puppetStages[0].backgroundPath['9:16']}`)
    expect(pz.actors[0].mouths.D).toMatch(/^shared\/rigs\//)
    expect(pz.actors[0].mouthCues[0].start).toBeGreaterThanOrEqual(0)
    expect(pz.actors[0].blinks.length).toBeGreaterThan(0)
    expect(build()).toEqual(p) // tất định ⇒ xem trước = render

    // Shorts teaser cắt từ giây 2 ⇒ mốc miệng dời theo
    const w: CompositionWindow = { start: 2, end: 4.5, voiceRelPath: 'v.wav', hookText: '', ctaTitle: 'x', ctaSub: '', hookCardSec: 3, endCardSec: 3 }
    const win = applyWindow(p, w, 'v.wav').scenes[0].puppet!
    const orig = pz.actors[0].mouthCues.find((c) => c.end > 2.5 && c.shape !== 'X')!
    const moved = win.actors[0].mouthCues.find((c) => c.shape === orig.shape && Math.abs(c.end - (orig.end - 2)) < 1e-6)
    expect(moved).toBeTruthy()

    // Không truyền thư viện rối ⇒ cảnh rối hiện như ảnh thường (không lỗi)
    expect(buildCompositionProps({ story, release: rel, glossary: [], subtitleStyle: null, mediaUrl: (r) => r, fps: 30, sizes: platformsConfig.aspectSizes }).scenes[0].puppet).toBeNull()
  })
})

describe('migrate', () => {
  it('thư viện cũ (chưa có rối) vẫn chạy; giữ puppetRigId của nhân vật', () => {
    const old = { channelPresets: [], folklore: [], pronunciations: [], characters: [{ id: 'c1', name: 'A', role: 'narrator', puppetRigId: 'rig-c1' }], voiceProfiles: [], soundAssets: [] } as unknown as Library
    const lib = migrateLibrary(old)
    expect(lib.puppetRigs).toEqual([])
    expect(lib.puppetStages).toEqual([])
    expect(lib.characters[0].puppetRigId).toBe('rig-c1')
  })
})
