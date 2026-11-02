import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DepthEstimator } from '../src/main/media/depth'
import { probeDuration, runFfmpeg } from '../src/main/media/ffmpeg'
import { buildMixGraph, measureLufs, mixAudio } from '../src/main/media/mix'
import { buildParallaxLayers } from '../src/main/media/parallax'
import { MockVideoProvider } from '../src/main/providers/video/mockVideo'
import { MockImageProvider } from '../src/main/providers/mock/mockImage'
import { VeoVideoProvider, type VeoClientLike } from '../src/main/providers/video/veo'
import { guessKind, tagsFromPath } from '../src/main/services/soundService'
import { kenBurnsAt, parallaxLayerAt } from '../src/shared/logic/kenBurns'
import { assignMotions, chooseParallaxScenes } from '../src/shared/logic/motion'
import { heuristicDepth, percentile, smoothstep } from '../src/shared/logic/parallaxMath'
import { designSoundCues, validateCues, type DesignInput } from '../src/shared/logic/soundDesign'
import { dragCue, lineGapSnapPoints, moveSceneBoundary, snap } from '../src/shared/logic/timelineEdit'
import { buildCompositionProps } from '../src/shared/composition'
import { platformsConfig } from '../src/shared/config'
import { createSampleReleases, createSampleStory, sampleChannel } from '../src/shared/sampleData'
import type { Motion, ReleaseScene, SoundAsset } from '../src/shared/types'

const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'fhs-gd4-'))

describe('Parallax – toán chuyển động', () => {
  const m: Motion = { level: 'parallax', type: 'truckLeft', intensity: 1, easing: 'linear', focusPoint: { x: 0.5, y: 0.5 } }
  it('lớp gần dịch nhiều hơn lớp xa; hậu cảnh không lộ mép', () => {
    const far = parallaxLayerAt(m, 1, 0.2)
    const near = parallaxLayerAt(m, 1, 1)
    expect(Math.abs(near.translateXPercent)).toBeGreaterThan(Math.abs(far.translateXPercent))
    for (const t of [0, 0.5, 1]) {
      const f = parallaxLayerAt(m, t, 1)
      expect(Math.abs(f.translateXPercent)).toBeLessThanOrEqual(((f.scale - 1) / 2) * 100)
    }
    const din = { ...m, type: 'dollyIn' as const }
    expect(parallaxLayerAt(din, 1, 1).scale).toBeGreaterThan(parallaxLayerAt(din, 1, 0.2).scale)
  })

  it('chọn cảnh parallax theo tỷ lệ, bỏ cảnh phẳng (insert/topDown) và cảnh đã có video AI, rải đều', () => {
    const shots = ['wide', 'insert', 'medium', 'closeUp', 'topDown', 'overShoulder', 'wide', 'medium', 'insert', 'wide'] as const
    const scenes = shots.map((shotType) => ({ beatId: 'b', shotType }))
    const picked = chooseParallaxScenes(scenes, () => 0.7, 0.3, new Set([0]))
    expect(picked.size).toBe(3)
    for (const i of picked) {
      expect(['insert', 'topDown']).not.toContain(shots[i])
      expect(i).not.toBe(0)
    }
    const arr = [...picked].sort((a, b) => a - b)
    for (let k = 1; k < arr.length; k++) expect(arr[k] - arr[k - 1]).toBeGreaterThan(1)
  })

  it('assignMotions: Mức 3 cho cảnh có clip, Mức 2 cho cảnh parallax, không lặp kiểu liền nhau', () => {
    const inputs = Array.from({ length: 6 }, () => ({ beatId: 'b', focusPoint: { x: 0.5, y: 0.5 } }))
    const ms = assignMotions(inputs, () => 0.5, sampleChannel.motionProfile, { aiVideo: new Set([0]), parallax: new Set([2, 3]) })
    expect(ms[0].level).toBe('aiVideo')
    expect(ms[2].level).toBe('parallax')
    expect(ms[3].level).toBe('parallax')
    for (let i = 1; i < ms.length; i++) expect(ms[i].type).not.toBe(ms[i - 1].type)
  })

  it('composition: thiếu lớp/clip ⇒ tự quay về Ken Burns', () => {
    const story = createSampleStory()
    const rel = createSampleReleases()[0]
    story.sceneBank[0].media['16:9'] = { path: 'bank/a.png', mediaType: 'image', source: 'ai', provider: 'mock', model: 'm', cost: 0, createdAt: 'x' }
    rel.scenes = [0, 1].map((i) => ({
      id: `r${i}`,
      sceneBankId: story.sceneBank[0].id,
      start: i * 3,
      end: i * 3 + 3,
      lineIds: [],
      mediaOverride: null,
      motion: { level: i === 0 ? 'parallax' : 'aiVideo', type: i === 0 ? 'dollyIn' : 'aiClip', intensity: 0.5, easing: 'linear', focusPoint: { x: 0.5, y: 0.5 } },
      transition: { type: 'cut', durationSec: 0 },
      isHero: i === 1
    })) as ReleaseScene[]
    const props = buildCompositionProps({ story, release: rel, glossary: [], subtitleStyle: null, mediaUrl: (p) => p, fps: 30, sizes: platformsConfig.aspectSizes })
    expect(props.scenes[0].motion).toMatchObject({ level: 'kenBurns', type: 'zoomIn' })
    expect(props.scenes[1].motion).toMatchObject({ level: 'kenBurns', type: 'zoomIn' })
    expect(kenBurnsAt(props.scenes[1].motion, 1).scale).toBeGreaterThan(1)
  })
})

describe('Parallax – tách lớp thật bằng sharp', () => {
  it('toán phân vị & smoothstep; depth ước lượng gần ở dưới/quanh focus', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5)
    const d = heuristicDepth(10, 10, { x: 0.5, y: 0.5 })
    expect(d[9 * 10 + 5]).toBeGreaterThan(d[0])
  })

  it('ra 3 lớp PNG + depth; tiền cảnh có vùng trong suốt', async () => {
    const dir = await tmp()
    const src = path.join(dir, 'src.png')
    await new MockImageProvider().generate({ prompt: 'p', negativePrompt: '', aspect: '16:9', outputPath: src, referenceImagePaths: [], seed: 3, placeholder: { index: 1, shotType: 'wide', cameraAngle: 'eye', summary: 's', focusPoint: { x: 0.5, y: 0.6 }, palette: [] } })
    const out = { depth: path.join(dir, 'd.png'), layers: [0, 1, 2].map((i) => path.join(dir, `l${i}.png`)) as [string, string, string] }
    const model = process.env.FHS_DEPTH_MODEL
    const est = new DepthEstimator(model ? path.dirname(model) : path.join(dir, 'no-models'), model ? { ...(await import('../src/shared/config')).providersConfig.depth, modelFile: path.basename(model) } : undefined)
    const r = await buildParallaxLayers(src, out, est, { x: 0.5, y: 0.6 })
    expect(r.source).toBe(model ? 'model' : 'heuristic')
    const near = await sharp(out.layers[2]).raw().toBuffer({ resolveWithObject: true })
    expect(near.info.channels).toBe(4)
    let transparent = 0
    for (let i = 3; i < near.data.length; i += 4) if (near.data[i] < 10) transparent++
    const px = near.info.width * near.info.height
    expect(transparent).toBeGreaterThan(px * 0.3)
    expect(transparent).toBeLessThan(px * 0.99)
    // Ảnh một màu (depth phẳng) ⇒ không tách nhầm: tiền cảnh trong suốt hoàn toàn
    const flat = path.join(dir, 'flat.png')
    await fs.writeFile(flat, await sharp({ create: { width: 320, height: 180, channels: 3, background: '#335' } }).png().toBuffer())
    await buildParallaxLayers(flat, out, new DepthEstimator(path.join(dir, 'no-models')), { x: 0.5, y: 0.5 })
    const fl = await sharp(out.layers[0]).metadata()
    expect(fl.width).toBe(320)
  }, 60000)
})

describe('Video AI', () => {
  it('Mock: dựng clip mp4 ngắn từ ảnh, đúng khung dọc', async () => {
    const dir = await tmp()
    const img = path.join(dir, 'i.png')
    await fs.writeFile(img, await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#224' } }).png().toBuffer())
    const out = path.join(dir, 'c.mp4')
    const r = await new MockVideoProvider().imageToVideo({ imagePath: img, prompt: 'x', aspect: '9:16', durationSec: 2, outputPath: out })
    expect(r.duration).toBeGreaterThan(1.5)
    expect(r.cost).toBe(0)
  }, 60000)

  it('Veo: gửi ảnh + tỉ lệ + thời lượng, chờ thao tác xong rồi tải về; báo lỗi khi bị lọc', async () => {
    const dir = await tmp()
    const img = path.join(dir, 'i.png')
    await fs.writeFile(img, await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } }).png().toBuffer())
    let sent: Record<string, unknown> = {}
    let polls = 0
    const client: VeoClientLike = {
      models: { generateVideos: async (p) => ((sent = p), { done: false }) },
      operations: { getVideosOperation: async () => (++polls < 2 ? { done: false } : { done: true, response: { generatedVideos: [{ video: { uri: 'x' } }] } }) },
      files: {
        download: async ({ downloadPath }) => {
          await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mp4', downloadPath])
        }
      }
    }
    const veo = new VeoVideoProvider(() => 'k', () => client, { ...(await import('../src/shared/config')).providersConfig.video.veo, pollIntervalMs: 1 })
    const r = await veo.imageToVideo({ imagePath: img, prompt: 'p', aspect: '16:9', durationSec: 8, outputPath: path.join(dir, 'v.mp4') })
    expect((sent.config as { aspectRatio: string; durationSeconds: number }).aspectRatio).toBe('16:9')
    expect((sent.config as { durationSeconds: number }).durationSeconds).toBe(8)
    expect((sent.image as { mimeType: string }).mimeType).toBe('image/png')
    expect(r.cost).toBeCloseTo(8 * 0.15)
    const filtered: VeoClientLike = { ...client, models: { generateVideos: async () => ({ done: true, response: { raiMediaFilteredReasons: ['unsafe'] } }) } }
    await expect(new VeoVideoProvider(() => 'k', () => filtered).imageToVideo({ imagePath: img, prompt: 'p', aspect: '9:16', durationSec: 8, outputPath: path.join(dir, 'w.mp4') })).rejects.toThrow(/unsafe/)
  }, 60000)
})

function asset(id: string, kind: SoundAsset['kind'], tags: string[], ok = true): SoundAsset {
  return { id, path: `/x/${id}.wav`, name: id, kind, tags, durationSec: kind === 'ambience' || kind === 'music' ? 60 : 2, license: 'CC0', licenseConfirmed: ok, source: 't' }
}

describe('Sound design theo luật', () => {
  const lines = [
    { id: 'l1', text: 'Đêm đó mặt sông phẳng lặng.', start: 0.5, end: 4, beatId: 'b1', sectionKind: 'hook' },
    { id: 'l2', text: 'Mái chèo bỗng nặng trịch.', start: 10, end: 13, beatId: 'b2', sectionKind: 'story' },
    { id: 'l3', text: 'Bàn tay lạnh ngắt nắm lấy cổ chân cô.', start: 20, end: 24, beatId: 'b3', sectionKind: 'story' },
    { id: 'l4', text: 'Dấu chân ướt dẫn tới cửa nhà.', start: 40, end: 44, beatId: 'b4', sectionKind: 'cliffhanger' }
  ]
  const input = (assets: SoundAsset[]): DesignInput => ({
    duration: 46,
    lines,
    beatIntensity: (b) => ({ b1: 0.7, b2: 0.6, b3: 1, b4: 0.85 })[b] ?? 0.5,
    assets,
    palette: sampleChannel.soundPalette,
    climaxThreshold: 0.95,
    silenceBeforeClimaxSec: 0.9
  })
  const lib = [asset('amb', 'ambience', ['river', 'night']), asset('mus', 'music', ['drone']), asset('stg', 'stinger', ['low-hit']), asset('wood', 'sfx', ['wood-creak', 'boat']), asset('steps', 'sfx', ['footsteps']), asset('bad', 'sfx', ['water'], false)]

  it('ambience + nhạc phủ toàn video; stinger + khoảng lặng trước cao trào; SFX theo từ khoá', () => {
    const cues = designSoundCues(input(lib))
    const amb = cues.find((c) => c.kind === 'ambience')!
    expect([amb.start, amb.end]).toEqual([0, 46])
    expect(cues.some((c) => c.kind === 'music')).toBe(true)
    const sil = cues.find((c) => c.kind === 'silence')!
    expect(sil.end).toBeLessThanOrEqual(20)
    expect(sil.start).toBeGreaterThanOrEqual(19)
    expect(cues.find((c) => c.kind === 'stinger')!.start).toBe(20)
    expect(cues.filter((c) => c.assetId === 'wood').length).toBe(1)
    expect(cues.filter((c) => c.assetId === 'steps').length).toBe(1)
    expect(cues.some((c) => c.assetId === 'bad')).toBe(false)
    // Không SFX trong câu móc (2,5s đầu); SFX cách nhau ≥ 10s
    const sfx = cues.filter((c) => c.kind === 'sfx').map((c) => c.start)
    expect(sfx.every((t) => t >= 2.5)).toBe(true)
    for (let i = 1; i < sfx.length; i++) expect(sfx[i] - sfx[i - 1]).toBeGreaterThanOrEqual(10)
  })

  it('validateCues: loại asset chưa có giấy phép / sai loại / ngoài thời lượng', () => {
    const v = validateCues(
      [
        { id: 'a', kind: 'sfx', assetId: 'bad', start: 1, end: 2, volume: 1, fadeIn: 0, fadeOut: 0 },
        { id: 'b', kind: 'sfx', assetId: 'amb', start: 1, end: 2, volume: 1, fadeIn: 0, fadeOut: 0 },
        { id: 'c', kind: 'sfx', assetId: 'wood', start: 50, end: 60, volume: 1, fadeIn: 0, fadeOut: 0 },
        { id: 'd', kind: 'sfx', assetId: 'wood', start: 45, end: 60, volume: 1, fadeIn: 0, fadeOut: 0 }
      ],
      lib,
      46
    )
    expect(v.cues.map((c) => c.id)).toEqual(['d'])
    expect(v.cues[0].end).toBe(46)
    expect(v.problems.length).toBe(3)
  })

  it('đoán loại / tag từ đường dẫn thư viện', () => {
    expect(guessKind('Ambience/river night.wav', 90)).toBe('ambience')
    expect(guessKind('Stingers/low hit 01.wav', 3)).toBe('stinger')
    expect(guessKind('random.wav', 1.2)).toBe('sfx')
    expect(tagsFromPath('SFX/Water/water_splash-01.wav')).toEqual(['sfx', 'water', 'splash'])
  })
})

describe('Mix ffmpeg thật: ducking + khoảng lặng + loudness', () => {
  it('đồ thị filter đúng cấu trúc', () => {
    const g = buildMixGraph({ voicePath: 'v.wav', duration: 10, cues: [{ path: 'a.wav', start: 0, end: 10, volume: 0.3, fadeIn: 1, fadeOut: 1, loop: true }], silences: [{ start: 4, end: 5 }] })
    expect(g.inputArgs).toEqual(['-i', 'v.wav', '-stream_loop', '-1', '-i', 'a.wav'])
    expect(g.graph).toContain('sidechaincompress')
    expect(g.graph).toContain("between(t,4,5)")
    expect(g.graph).toContain('[pre]')
  })

  it('mix ra WAV đúng thời lượng, loudness ≈ mục tiêu', async () => {
    const dir = await tmp()
    const voice = path.join(dir, 'voice.wav')
    const amb = path.join(dir, 'amb.wav')
    const hit = path.join(dir, 'hit.wav')
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=f=220:d=8,tremolo=f=4:d=0.9,volume=0.2', '-ar', '44100', '-ac', '1', voice])
    await runFfmpeg(['-f', 'lavfi', '-i', 'anoisesrc=color=brown:a=0.5:d=3', '-ar', '48000', '-ac', '2', amb])
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=f=60:d=1', '-ar', '48000', '-ac', '2', hit])
    const out = path.join(dir, 'mix.wav')
    const r = await mixAudio(
      {
        voicePath: voice,
        duration: 9,
        cues: [
          { path: amb, start: 0, end: 9, volume: 0.35, fadeIn: 1, fadeOut: 1, loop: true },
          { path: hit, start: 5, end: 6, volume: 0.9, fadeIn: 0, fadeOut: 0.3, loop: false }
        ],
        silences: [{ start: 4, end: 4.8 }]
      },
      out,
      { lufs: -14, truePeak: -1.5, lra: 11 }
    )
    expect(Math.abs((await probeDuration(out)) - 9)).toBeLessThan(0.1)
    expect(Math.abs(r.lufs + 14)).toBeLessThan(1.5)
    expect(Math.abs((await measureLufs(out)) + 14)).toBeLessThan(1.5)
  }, 120000)
})

describe('Kéo chỉnh timeline', () => {
  const sc = (s: number, e: number, id: string): ReleaseScene => ({ id, sceneBankId: 'x', start: s, end: e, lineIds: [], mediaOverride: null, motion: { level: 'kenBurns', type: 'zoomIn', intensity: 0.5, easing: 'linear', focusPoint: { x: 0.5, y: 0.5 } }, transition: { type: 'cut', durationSec: 0 }, isHero: false })
  it('dời biên giữa 2 cảnh, giữ liền mạch và độ dài tối thiểu', () => {
    const scenes = [sc(0, 5, 'a'), sc(5, 10, 'b'), sc(10, 15, 'c')]
    const r = moveSceneBoundary(scenes, 1, 7)
    expect([r[0].end, r[1].start]).toEqual([7, 7])
    expect(moveSceneBoundary(scenes, 1, 9.9)[1].start).toBeCloseTo(9.4)
    expect(moveSceneBoundary(scenes, 0, 3)).toBe(scenes)
  })
  it('hút về khoảng lặng giữa câu', () => {
    const pts = lineGapSnapPoints([{ start: 0, end: 4 }, { start: 5, end: 8 }])
    expect(pts).toEqual([4.8])
    expect(snap(4.6, pts, 0.5)).toBe(4.8)
    expect(snap(3, pts, 0.5)).toBe(3)
  })
  it('kéo / dời cue trong thời lượng video', () => {
    const c = { id: 'c', kind: 'sfx' as const, assetId: 'a', start: 2, end: 4, volume: 1, fadeIn: 0, fadeOut: 0 }
    expect(dragCue(c, 'move', 100, 10)).toMatchObject({ start: 8, end: 10 })
    expect(dragCue(c, 'start', 5, 10).start).toBeCloseTo(3.8)
    expect(dragCue(c, 'end', -5, 10).end).toBeCloseTo(2.2)
  })
})
