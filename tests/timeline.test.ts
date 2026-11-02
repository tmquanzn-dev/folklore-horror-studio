import { describe, expect, it } from 'vitest'
import { computeLineTimings } from '../src/shared/logic/timeline'
import { placeClips, readWav, wavDuration, writeWav } from '../src/main/media/wav'
import { countSpeechUnits, estimateSpeechSeconds } from '../src/shared/logic/speech'

describe('computeLineTimings – ghép câu và tính mốc', () => {
  it('cộng dồn leadIn + pauseBefore + thời lượng + pauseAfter + tail', () => {
    const r = computeLineTimings(
      [
        { id: 'l1', duration: 2, pauseBeforeMs: 500, pauseAfterMs: 300 },
        { id: 'l2', duration: 1.5, pauseBeforeMs: 200, pauseAfterMs: 1000 }
      ],
      { leadInSec: 0.4, tailSec: 1 }
    )
    expect(r.items).toEqual([
      { id: 'l1', start: 0.9, end: 2.9 },
      { id: 'l2', start: 3.4, end: 4.9 }
    ])
    expect(r.totalDuration).toBe(6.9)
  })

  it('pause âm bị coi là 0, danh sách rỗng chỉ có lead + tail', () => {
    expect(computeLineTimings([{ id: 'x', duration: 1, pauseBeforeMs: -100, pauseAfterMs: 0 }], { leadInSec: 0, tailSec: 0 }).items[0]).toEqual({ id: 'x', start: 0, end: 1 })
    expect(computeLineTimings([], { leadInSec: 0.5, tailSec: 1 }).totalDuration).toBe(1.5)
  })

  it('báo lỗi khi thời lượng không hợp lệ', () => {
    expect(() => computeLineTimings([{ id: 'x', duration: Number.NaN, pauseBeforeMs: 0, pauseAfterMs: 0 }], { leadInSec: 0, tailSec: 0 })).toThrow()
  })
})

describe('WAV – đặt câu đúng mẫu', () => {
  const fmt = { sampleRate: 1000, channels: 1, bitsPerSample: 16 }
  it('đọc/ghi WAV và đặt clip đúng vị trí', () => {
    const clip = readWav(writeWav(fmt, Buffer.from(new Int16Array([100, 200, 300]).buffer)))
    expect(wavDuration(clip)).toBeCloseTo(0.003)
    const out = placeClips(fmt, 0.01, [{ start: 0.005, wav: clip }])
    const samples = new Int16Array(out.buffer, out.byteOffset, out.length / 2)
    expect(samples.length).toBe(10)
    expect(Array.from(samples.slice(4, 9))).toEqual([0, 100, 200, 300, 0])
  })
})

describe('ước tính thời lượng đọc', () => {
  const cfg = { unitsPerSecond: { en: 2.5, vi: 3.4 }, commaPauseSec: 0.2, stopPauseSec: 0.3, minSec: 0.8 }
  it('đếm từ / âm tiết bỏ qua dấu câu đứng riêng', () => {
    expect(countSpeechUnits('Lan ơi … Lan ơi')).toBe(4)
  })
  it('chậm hơn khi pace nhỏ, tối thiểu minSec', () => {
    const normal = estimateSpeechSeconds('one two three four five', 'en', 1, cfg)
    const slow = estimateSpeechSeconds('one two three four five', 'en', 0.8, cfg)
    expect(slow).toBeGreaterThan(normal)
    expect(estimateSpeechSeconds('Hi', 'en', 1, cfg)).toBe(0.8)
  })
})
