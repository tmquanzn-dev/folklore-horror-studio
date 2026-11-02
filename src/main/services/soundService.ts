/**
 * ÂM THANH (bước 18): thư viện âm thanh người dùng → thiết kế cue (LLM / luật) → mix (ducking + loudness).
 * Nguyên tắc 8: CHỈ asset đã xác nhận giấy phép mới được tự động đưa vào video.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { platformsConfig } from '../../shared/config'
import { designSoundCues, validateCues, type DesignInput } from '../../shared/logic/soundDesign'
import { toRelPath } from '../../shared/media'
import type { Library, Release, SoundAsset, SoundCue, SoundKind, Story } from '../../shared/types'
import { soundDesignTask } from '../llm/tasks'
import { logger } from '../logger'
import { probeDuration, runFfmpeg } from '../media/ffmpeg'
import { mixAudio, type MixCue } from '../media/mix'
import type { ProviderRegistry } from '../providers/registry'
import type { StoryRepository } from '../storage/storyRepo'

const AUDIO_EXT = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac']
const LICENSE_FILES = ['license.txt', 'LICENSE.txt', 'LICENSE', 'license.md', 'giay-phep.txt']

export function guessKind(rel: string, durationSec: number): SoundKind {
  const p = rel.toLowerCase()
  if (/stinger|hit|impact|riser|swell/.test(p)) return 'stinger'
  if (/music|nhac|nhạc|drone|score|theme/.test(p)) return 'music'
  if (/ambien|ambient|nen|nền|room|atmos|bg|background/.test(p)) return 'ambience'
  if (/sfx|fx|hieu-ung|hiệu ứng|foley/.test(p)) return 'sfx'
  return durationSec >= 20 ? 'ambience' : 'sfx'
}

export function tagsFromPath(rel: string): string[] {
  return [
    ...new Set(
      rel
        .replace(/\.[a-z0-9]+$/i, '')
        .split(/[\\/_\-.\s,()]+/)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length > 2 && !/^\d+$/.test(w))
    )
  ].slice(0, 12)
}

/** Bộ âm thanh mẫu tự tổng hợp bằng ffmpeg – không vướng bản quyền */
const STARTER: { file: string; kind: SoundKind; tags: string[]; d: number; src: string }[] = [
  { file: 'ambience_river-night.wav', kind: 'ambience', tags: ['river', 'night', 'water', 'insects'], d: 60, src: 'anoisesrc=color=brown:amplitude=0.5:d=60,lowpass=f=500,highpass=f=40,tremolo=f=0.2:d=0.4' },
  { file: 'ambience_wind.wav', kind: 'ambience', tags: ['wind', 'night', 'field'], d: 60, src: 'anoisesrc=color=pink:amplitude=0.35:d=60,bandpass=f=600:w=500,tremolo=f=0.12:d=0.7' },
  { file: 'music_dark-drone.wav', kind: 'music', tags: ['dark-ambient', 'drone', 'dan-bau-drone'], d: 60, src: "aevalsrc='0.25*sin(2*PI*55*t)+0.18*sin(2*PI*82.4*t+0.6*sin(2*PI*0.1*t))+0.08*sin(2*PI*110*t)':d=60,aecho=0.8:0.7:600|1100:0.35|0.25" },
  { file: 'stinger_low-hit.wav', kind: 'stinger', tags: ['low-hit', 'impact'], d: 3, src: "aevalsrc='0.9*sin(2*PI*(60-25*t)*t)*exp(-1.6*t)':d=3,aecho=0.8:0.8:300:0.4" },
  { file: 'stinger_reverse-swell.wav', kind: 'stinger', tags: ['reverse-swell', 'riser'], d: 3, src: "aevalsrc='0.6*sin(2*PI*220*t)*(t/3)^3+0.3*sin(2*PI*233*t)*(t/3)^3':d=3" },
  { file: 'sfx_water-splash.wav', kind: 'sfx', tags: ['water', 'splash', 'water-splash'], d: 1.6, src: 'anoisesrc=color=white:amplitude=0.7:d=1.6,bandpass=f=1400:w=1200,afade=t=out:st=0.15:d=1.4' },
  { file: 'sfx_wood-creak.wav', kind: 'sfx', tags: ['wood-creak', 'creak', 'boat', 'oar'], d: 2, src: "aevalsrc='0.5*sin(2*PI*(170+40*sin(2*PI*6*t))*t)*(1-t/2)':d=2" },
  { file: 'sfx_knock.wav', kind: 'sfx', tags: ['knock', 'door'], d: 1.4, src: "aevalsrc='0.9*sin(2*PI*95*t)*exp(-28*mod(t,0.4))*lt(t,1.15)':d=1.4" },
  { file: 'sfx_footsteps.wav', kind: 'sfx', tags: ['footsteps', 'footprint'], d: 3, src: "aevalsrc='0.7*sin(2*PI*70*t)*exp(-35*mod(t,0.55))':d=3" },
  { file: 'sfx_whisper.wav', kind: 'sfx', tags: ['whisper', 'breath'], d: 2.2, src: 'anoisesrc=color=pink:amplitude=0.4:d=2.2,highpass=f=2200,tremolo=f=7:d=0.9,afade=t=in:d=0.3,afade=t=out:st=1.6:d=0.6' }
]

export class SoundService {
  constructor(
    private readonly repo: StoryRepository,
    private readonly providers: ProviderRegistry,
    private readonly getLibraryDir: () => string
  ) {}

  private async findLicense(dir: string, root: string): Promise<string> {
    let cur = dir
    for (;;) {
      for (const f of LICENSE_FILES) {
        const txt = await fs.readFile(path.join(cur, f), 'utf8').catch(() => null)
        if (txt) return txt.trim().split(/\r?\n/)[0].slice(0, 200)
      }
      if (path.resolve(cur) === path.resolve(root)) return ''
      const up = path.dirname(cur)
      if (up === cur) return ''
      cur = up
    }
  }

  /** Quét thư mục thư viện; giữ lại chỉnh sửa của người dùng (loại, tag, giấy phép) theo đường dẫn */
  async scan(): Promise<Library> {
    const root = this.getLibraryDir()
    await fs.mkdir(root, { recursive: true })
    const lib = await this.repo.loadLibrary()
    const prev = new Map(lib.soundAssets.map((a) => [path.resolve(a.path), a]))
    const found: SoundAsset[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) await walk(abs)
        else if (AUDIO_EXT.includes(path.extname(e.name).toLowerCase())) {
          const old = prev.get(path.resolve(abs))
          if (old) {
            found.push(old)
            continue
          }
          const rel = path.relative(root, abs)
          const d = await probeDuration(abs).catch(() => 0)
          const license = await this.findLicense(dir, root)
          found.push({
            id: `snd-${createHash('sha1').update(path.resolve(abs)).digest('hex').slice(0, 10)}`,
            path: abs,
            name: e.name,
            kind: guessKind(rel, d),
            tags: tagsFromPath(rel),
            durationSec: Math.round(d * 100) / 100,
            license,
            licenseConfirmed: false,
            source: rel.split(path.sep)[0] === '_tu-tao' ? 'procedural' : 'thư viện người dùng'
          })
        }
      }
    }
    await walk(root)
    const updated = await this.repo.updateLibrary((l) => {
      l.soundAssets = found
    })
    logger.info(`Thư viện âm thanh: ${found.length} file (${found.filter((a) => a.licenseConfirmed).length} đã xác nhận giấy phép) – ${root}`, 'sound')
    return updated
  }

  /** Tạo bộ âm thanh mẫu tự tổng hợp (procedural, toàn quyền dùng thương mại) rồi quét lại */
  async generateStarterPack(): Promise<Library> {
    const dir = path.join(this.getLibraryDir(), '_tu-tao')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'license.txt'), 'Tự tạo bằng ffmpeg (procedural) – toàn quyền sử dụng thương mại\n', 'utf8')
    for (const s of STARTER) {
      const out = path.join(dir, s.file)
      const exists = await fs.access(out).then(() => true, () => false)
      if (!exists) await runFfmpeg(['-f', 'lavfi', '-i', s.src, '-t', String(s.d), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out])
    }
    await this.scan()
    return this.repo.updateLibrary((l) => {
      for (const a of l.soundAssets) {
        const st = STARTER.find((s) => path.resolve(dir, s.file) === path.resolve(a.path))
        if (st) Object.assign(a, { kind: st.kind, tags: st.tags, licenseConfirmed: true, source: 'procedural' })
      }
    })
  }

  private designInput(story: Story, release: Release, lib: Library): DesignInput {
    const ch = lib.channelPresets.find((c) => c.id === story.channelPresetId) ?? lib.channelPresets[0]
    const beats = new Map(story.outline.beats.map((b) => [b.id, b.emotionalIntensity]))
    const kindOf = new Map(release.script.sections.map((s) => [s.id, s.kind]))
    return {
      duration: release.voiceTrack?.duration ?? 0,
      lines: release.script.lines
        .filter((l) => l.start != null && l.end != null)
        .map((l) => ({ id: l.id, text: l.text, start: l.start as number, end: l.end as number, beatId: l.beatId, sectionKind: kindOf.get(l.sectionId) ?? 'story' })),
      beatIntensity: (id) => beats.get(id) ?? 0.5,
      assets: lib.soundAssets.filter((a) => a.licenseConfirmed),
      palette: ch.soundPalette,
      climaxThreshold: ch.motionProfile.climaxThreshold,
      silenceBeforeClimaxSec: platformsConfig.audio.silenceBeforeClimaxSec
    }
  }

  /** Thiết kế cue: LLM (hoặc luật khi Mock), kiểm tra asset + giấy phép; thư viện trống ⇒ tự tạo bộ mẫu */
  async design(storyId: string, releaseId: string, signal?: AbortSignal): Promise<{ cues: SoundCue[]; cost: number; note: string }> {
    const story = await this.repo.loadStory(storyId)
    const release = await this.repo.loadRelease(storyId, releaseId)
    if (!release.voiceTrack) throw new Error('Chưa có voice track – chạy lại bước 12')
    let lib = await this.repo.loadLibrary()
    let note = ''
    if (!lib.soundAssets.some((a) => a.licenseConfirmed)) {
      lib = await this.generateStarterPack()
      note = 'Thư viện chưa có âm thanh đã xác nhận giấy phép ⇒ đã tạo bộ âm thanh mẫu tự tổng hợp. '
    }
    const input = this.designInput(story, release, lib)
    const llm = this.providers.llm()
    try {
      const req = soundDesignTask(input, release.language)
      req.signal = signal
      const res = await llm.generateJson(req)
      return { cues: res.data, cost: res.cost, note: note + `${res.data.length} cue (${llm.id === 'mock' ? 'luật tự động' : 'LLM'})` }
    } catch (err) {
      if (signal?.aborted) throw err
      // LLM lỗi ⇒ dùng thiết kế theo luật, vẫn kiểm tra giấy phép
      const v = validateCues(designSoundCues(input), input.assets, input.duration)
      logger.warn(`LLM sound design lỗi (${err instanceof Error ? err.message : String(err)}) – dùng thiết kế theo luật`, releaseId)
      return { cues: v.cues, cost: 0, note: note + `${v.cues.length} cue (theo luật – LLM lỗi)` }
    }
  }

  /** Mix giọng + cue ⇒ voice/mix.wav, cập nhật voiceTrack.mixedPath + LUFS */
  async mix(storyId: string, releaseId: string, signal?: AbortSignal): Promise<Release> {
    const story = await this.repo.loadStory(storyId)
    const release = await this.repo.loadRelease(storyId, releaseId)
    const vt = release.voiceTrack
    if (!vt?.processedPath) throw new Error('Chưa có voice track – chạy lại bước 12')
    const lib = await this.repo.loadLibrary()
    const ch = lib.channelPresets.find((c) => c.id === story.channelPresetId) ?? lib.channelPresets[0]
    const a = platformsConfig.audio
    const sfxDir = path.join(this.repo.releaseDir(storyId, releaseId), 'sfx')
    await fs.mkdir(sfxDir, { recursive: true })
    const { cues } = validateCues(release.soundCues, lib.soundAssets, vt.duration)
    const mixCues: MixCue[] = []
    for (const c of cues) {
      if (c.kind === 'silence') continue
      const asset = lib.soundAssets.find((x) => x.id === c.assetId) as SoundAsset
      // Chép asset vào thư mục Release (minh bạch nguồn + mang đi được)
      const local = path.join(sfxDir, `${asset.id}${path.extname(asset.path).toLowerCase()}`)
      if (!(await fs.access(local).then(() => true, () => false))) await fs.copyFile(asset.path, local)
      const len = c.end - c.start
      mixCues.push({
        path: local,
        start: c.start,
        end: c.end,
        volume: a.defaultVolume[c.kind as keyof typeof a.defaultVolume] * c.volume,
        fadeIn: c.fadeIn,
        fadeOut: c.fadeOut,
        loop: (c.kind === 'ambience' || c.kind === 'music') && asset.durationSec > 0 && asset.durationSec < len
      })
    }
    const out = path.join(this.repo.releaseDir(storyId, releaseId), 'voice', 'mix.wav')
    const res = await mixAudio(
      {
        voicePath: this.repo.resolveInStory(storyId, vt.processedPath),
        duration: vt.duration,
        cues: mixCues,
        silences: cues.filter((c) => c.kind === 'silence').map((c) => ({ start: c.start, end: c.end }))
      },
      out,
      { lufs: ch.soundPalette.targetLufs, truePeak: a.truePeakDb, lra: a.lra },
      signal
    )
    const updated = await this.repo.updateRelease(storyId, releaseId, (r) => {
      if (!r.voiceTrack) return
      r.voiceTrack.mixedPath = toRelPath('releases', releaseId, 'voice', 'mix.wav')
      r.voiceTrack.mixLufs = Math.round(res.lufs * 10) / 10
      r.voiceTrack.mixStale = false
      r.voiceTrack.mixedAt = new Date().toISOString()
    })
    logger.info(`Mix xong: ${mixCues.length} lớp âm thanh, ${res.lufs.toFixed(1)} LUFS`, releaseId)
    return updated
  }

  /** Nghe thử một asset (20 giây đầu, mp3 nhỏ) dạng data URL – asset nằm ngoài thư mục Story */
  async preview(assetId: string): Promise<string> {
    const lib = await this.repo.loadLibrary()
    const a = lib.soundAssets.find((x) => x.id === assetId)
    if (!a) throw new Error('Không tìm thấy âm thanh')
    const tmp = path.join(this.repo.dataRoot, 'cache', `prev_${a.id}.mp3`)
    await fs.mkdir(path.dirname(tmp), { recursive: true })
    if (!(await fs.access(tmp).then(() => true, () => false))) {
      await runFfmpeg(['-i', a.path, '-t', '20', '-ac', '2', '-b:a', '96k', tmp])
    }
    return `data:audio/mpeg;base64,${(await fs.readFile(tmp)).toString('base64')}`
  }
}
