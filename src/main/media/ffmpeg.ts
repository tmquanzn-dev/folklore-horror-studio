/**
 * Gọi ffmpeg/ffprobe (bản tĩnh đi kèm qua ffmpeg-static / ffprobe-static).
 * Dùng spawn với mảng tham số (không qua shell) ⇒ đường dẫn có dấu tiếng Việt, khoảng trắng vẫn chạy đúng.
 */
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { VoiceProcessChain } from '../../shared/types'

/** Khi đóng gói (GĐ6) file nhị phân nằm trong app.asar.unpacked */
const unpacked = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')

export function ffmpegPath(): string {
  const p = ffmpegStatic as unknown as string | null
  if (!p) throw new Error('Không tìm thấy ffmpeg. Hãy chạy lại "npm install" để tải ffmpeg-static.')
  return unpacked(p)
}

export function ffprobePath(): string {
  return unpacked(ffprobeStatic.path)
}

/** Chạy ffmpeg ở mức log "info" và trả về stderr (cần để đọc kết quả đo loudnorm) */
export function runFfmpegCapture(args: string[], signal?: AbortSignal): Promise<string> {
  return run(ffmpegPath(), ['-hide_banner', '-nostats', '-loglevel', 'info', '-y', ...args], signal, true)
}

function run(bin: string, args: string[], signal?: AbortSignal, returnStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Đã huỷ', 'AbortError'))
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      if (stderr.length > 200000) stderr = stderr.slice(-100000)
    })
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(new DOMException('Đã huỷ', 'AbortError'))
      if (code === 0) resolve(returnStderr ? stderr : stdout)
      else reject(new Error(`${bin.split(/[\\/]/).pop()} lỗi (mã ${code}): ${stderr.split('\n').slice(-6).join(' ').trim()}`))
    })
  })
}

export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<string> {
  return run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], signal)
}

export async function probeDuration(file: string): Promise<number> {
  const out = await run(ffprobePath(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file
  ])
  const d = Number.parseFloat(out.trim())
  if (!Number.isFinite(d)) throw new Error(`Không đọc được thời lượng: ${file}`)
  return d
}

/** Cắt một đoạn audio có fade vào/ra (dùng cho Shorts teaser); thêm khoảng lặng ở cuối cho thẻ kết */
export async function cutAudio(src: string, dst: string, start: number, len: number, tailSec: number, signal?: AbortSignal): Promise<void> {
  const fo = Math.min(1.2, len / 3)
  await runFfmpeg(
    ['-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', src, '-af', `afade=t=in:d=0.25,afade=t=out:st=${(len - fo).toFixed(3)}:d=${fo.toFixed(3)},apad=pad_dur=${tailSec.toFixed(2)}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', dst],
    signal
  )
}

/** Chuẩn hoá mọi audio provider trả về (mp3, wav 24kHz…) về WAV 44.1kHz mono 16-bit */
export async function toWav44kMono(src: string, dst: string, signal?: AbortSignal): Promise<void> {
  await runFfmpeg(['-i', src, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', dst], signal)
}

/** Chuỗi filter xử lý giọng: lọc tần thấp → nén → EQ ấm → reverb nhẹ */
export function buildVoiceFilter(chain: VoiceProcessChain): string {
  const filters = [
    `highpass=f=${Math.max(20, Math.round(chain.highpassHz))}`,
    `acompressor=threshold=${chain.compressor.thresholdDb}dB:ratio=${chain.compressor.ratio}:attack=10:release=200`,
    `equalizer=f=220:t=q:w=1:g=${chain.warmthDb}`
  ]
  if (chain.reverbAmount > 0) {
    const decay = Math.min(0.6, Math.max(0.05, chain.reverbAmount)).toFixed(2)
    filters.push(`aecho=0.85:0.7:45|90:${decay}|${(Number(decay) * 0.6).toFixed(2)}`)
  }
  return filters.join(',')
}
