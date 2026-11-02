/**
 * MIX ÂM THANH bằng ffmpeg:
 *   giọng ─┬───────────────────────────────────────────────┐
 *          └─(sidechain)─┐                                 ├─ amix ─ loudnorm (2 lượt) ─ WAV 48k
 *   ambience/nhạc/SFX/stinger ─ fade/vị trí ─ amix ─ lặng ─ sidechaincompress (ducking) ┘
 * Lượt 1 đo loudness, lượt 2 chuẩn hoá tuyến tính tới mục tiêu (~ -14 LUFS) ⇒ âm lượng ổn định giữa các video.
 */
import { platformsConfig } from '../../shared/config'
import { runFfmpegCapture } from './ffmpeg'

export interface MixCue {
  path: string
  start: number
  end: number
  /** Âm lượng tuyến tính tuyệt đối (đã nhân mức mặc định theo loại) */
  volume: number
  fadeIn: number
  fadeOut: number
  /** Lặp nguồn (ambience/nhạc ngắn hơn đoạn cần phủ) */
  loop: boolean
}

export interface MixPlan {
  voicePath: string
  duration: number
  cues: MixCue[]
  silences: { start: number; end: number }[]
}

export interface LoudnessTarget {
  lufs: number
  truePeak: number
  lra: number
}

const f3 = (n: number): string => (Math.round(n * 1000) / 1000).toString()

/** Tham số ffmpeg (input + filter_complex) cho phần trộn; nhãn đầu ra [pre] */
export function buildMixGraph(plan: MixPlan): { inputArgs: string[]; graph: string } {
  const a = platformsConfig.audio
  const SR = a.sampleRate
  const D = f3(plan.duration)
  const fmt = `aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo`
  const inputArgs: string[] = ['-i', plan.voicePath]
  const parts: string[] = []
  const cues = plan.cues.filter((c) => c.end - c.start > 0.05)

  if (cues.length === 0) {
    parts.push(`[0:a]${fmt},apad=whole_dur=${D},atrim=0:${D}[pre]`)
    return { inputArgs, graph: parts.join(';') }
  }
  parts.push(`[0:a]${fmt},apad=whole_dur=${D},atrim=0:${D},asplit=2[vmix][vsc]`)
  cues.forEach((c, i) => {
    if (c.loop) inputArgs.push('-stream_loop', '-1')
    inputArgs.push('-i', c.path)
    const len = c.end - c.start
    const chain = [fmt, `atrim=0:${f3(len)}`, 'asetpts=PTS-STARTPTS']
    if (c.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${f3(Math.min(c.fadeIn, len / 2))}`)
    if (c.fadeOut > 0) chain.push(`afade=t=out:st=${f3(Math.max(0, len - Math.min(c.fadeOut, len / 2)))}:d=${f3(Math.min(c.fadeOut, len / 2))}`)
    chain.push(`volume=${f3(c.volume)}`)
    const ms = Math.round(c.start * 1000)
    if (ms > 0) chain.push(`adelay=delays=${ms}:all=1`)
    parts.push(`[${i + 1}:a]${chain.join(',')}[c${i}]`)
  })
  const ins = cues.map((_, i) => `[c${i}]`).join('')
  parts.push(`${ins}amix=inputs=${cues.length}:normalize=0:duration=longest,apad=whole_dur=${D},atrim=0:${D}[bed0]`)
  // Khoảng lặng có chủ đích: tắt toàn bộ âm nền trong đoạn
  let bed = 'bed0'
  plan.silences.forEach((s, i) => {
    parts.push(`[${bed}]volume=volume=0:enable='between(t,${f3(s.start)},${f3(s.end)})'[bs${i}]`)
    bed = `bs${i}`
  })
  // Ducking: giọng nói vang lên ⇒ âm nền tự nhỏ xuống
  const th = Math.min(1, Math.max(0.000976563, Math.pow(10, a.duck.thresholdDb / 20)))
  parts.push(`[${bed}][vsc]sidechaincompress=threshold=${th.toFixed(6)}:ratio=${a.duck.ratio}:attack=${a.duck.attackMs}:release=${a.duck.releaseMs}[bedd]`)
  parts.push(`[vmix][bedd]amix=inputs=2:normalize=0:duration=first[pre]`)
  return { inputArgs, graph: parts.join(';') }
}

export interface LoudnormMeasure {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
  output_i?: string
}

/** Lấy khối JSON loudnorm in ra ở cuối stderr */
export function parseLoudnorm(stderr: string): LoudnormMeasure {
  const end = stderr.lastIndexOf('}')
  const start = stderr.lastIndexOf('{', end)
  if (start < 0 || end < 0) throw new Error('Không đọc được kết quả đo loudness từ ffmpeg')
  return JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasure
}

export async function mixAudio(plan: MixPlan, outPath: string, target: LoudnessTarget, signal?: AbortSignal): Promise<{ lufs: number }> {
  const { inputArgs, graph } = buildMixGraph(plan)
  const ln = `loudnorm=I=${target.lufs}:TP=${target.truePeak}:LRA=${target.lra}`
  // Lượt 1: đo
  const pass1 = await runFfmpegCapture([...inputArgs, '-filter_complex', `${graph};[pre]${ln}:print_format=json[out]`, '-map', '[out]', '-f', 'null', '-'], signal)
  const m = parseLoudnorm(pass1)
  // Lượt 2: chuẩn hoá tuyến tính theo số đo
  const ln2 = `${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`
  const tmp = `${outPath}.tmp.wav`
  const pass2 = await runFfmpegCapture(
    [...inputArgs, '-filter_complex', `${graph};[pre]${ln2},aresample=${platformsConfig.audio.sampleRate}[out]`, '-map', '[out]', '-c:a', 'pcm_s16le', '-ar', String(platformsConfig.audio.sampleRate), '-ac', '2', tmp],
    signal
  )
  const fs = await import('node:fs/promises')
  await fs.rename(tmp, outPath)
  const out = parseLoudnorm(pass2)
  return { lufs: Number(out.output_i ?? target.lufs) }
}

/** Đo loudness tích hợp của một file (dùng kiểm thử / hiển thị) */
export async function measureLufs(file: string): Promise<number> {
  const s = await runFfmpegCapture(['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
  return Number(parseLoudnorm(s).input_i)
}
