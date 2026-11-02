/**
 * Đọc/ghi WAV PCM 16-bit – dùng để ghép các câu thành voice track với mốc thời gian CHÍNH XÁC tới từng mẫu.
 * (Mọi take được chuẩn hoá về cùng định dạng trước khi ghép.)
 */

export interface WavFormat {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

export interface WavData extends WavFormat {
  data: Buffer
}

export function readWav(buf: Buffer): WavData {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('File không phải WAV hợp lệ')
  }
  let offset = 12
  let fmt: WavFormat | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      const audioFormat = buf.readUInt16LE(body)
      if (audioFormat !== 1 && audioFormat !== 0xfffe) throw new Error('Chỉ hỗ trợ WAV PCM')
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV thiếu chunk fmt')
      const end = Math.min(buf.length, body + size)
      return { ...fmt, data: buf.subarray(body, end) }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV thiếu chunk data')
}

export function writeWav(fmt: WavFormat, data: Buffer): Buffer {
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(fmt.channels, 22)
  header.writeUInt32LE(fmt.sampleRate, 24)
  header.writeUInt32LE(fmt.sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(fmt.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export function wavDuration(w: WavData): number {
  const blockAlign = (w.channels * w.bitsPerSample) / 8
  return w.data.length / blockAlign / w.sampleRate
}

export function sameFormat(a: WavFormat, b: WavFormat): boolean {
  return a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitsPerSample === b.bitsPerSample
}

/**
 * Đặt từng đoạn audio vào đúng giây bắt đầu trên một nền im lặng dài totalSec.
 * Vì vị trí tính theo mẫu (sample) ⇒ mốc start/end của câu khớp tuyệt đối với file ghép.
 */
export function placeClips(fmt: WavFormat, totalSec: number, clips: { start: number; wav: WavData }[]): Buffer {
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8
  const totalFrames = Math.ceil(totalSec * fmt.sampleRate)
  const out = Buffer.alloc(totalFrames * blockAlign)
  for (const clip of clips) {
    if (!sameFormat(fmt, clip.wav)) throw new Error('Các đoạn audio khác định dạng – cần chuẩn hoá trước')
    const startByte = Math.round(clip.start * fmt.sampleRate) * blockAlign
    const room = Math.max(0, out.length - startByte)
    clip.wav.data.copy(out, startByte, 0, Math.min(room, clip.wav.data.length))
  }
  return out
}
