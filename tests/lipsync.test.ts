/**
 * GĐ7.1 – khớp môi, chớp mắt, chọn cảnh rối (danh sách ca theo docs/spec-gd7-puppet.md).
 */
import { describe, expect, it } from 'vitest'
import {
  amplitudeShapes,
  blinkStarts,
  blinkStateAt,
  framesToCues,
  lineMouthCues,
  mouthAt,
  rmsDbPerFrame,
  selectPuppetScenes,
  stripTones,
  visemesEn,
  visemesVi
} from '../src/shared/logic/lipsync'
import type { MouthShape } from '../src/shared/types'

const shapes = (segs: { shape: MouthShape }[]): string => segs.map((s) => s.shape).join('')

describe('viseme tiếng Việt', () => {
  it('bỏ dấu thanh nhưng giữ dấu chữ', () => {
    expect(stripTones('Mường')).toBe('Mương')
    expect(stripTones('đặng')).toBe('đăng')
  })

  it('phụ âm đầu + nguyên âm, thanh điệu không ảnh hưởng', () => {
    expect(shapes(visemesVi('ma'))).toBe('AD')
    expect(shapes(visemesVi('má'))).toBe('AD')
    expect(shapes(visemesVi('mạ'))).toBe('AD')
    expect(shapes(visemesVi('về'))).toBe('GC')
    expect(shapes(visemesVi('phố'))).toBe('GE')
    expect(shapes(visemesVi('lú'))).toBe('HF')
    expect(shapes(visemesVi('ừ'))).toBe('F')
  })

  it('âm cuối m/p ⇒ khép môi A ở cuối; âm cuối khác giữ nguyên âm', () => {
    const tam = visemesVi('tâm')
    expect(shapes(tam)).toBe('HDA')
    expect(tam[tam.length - 1].w).toBeCloseTo(0.25, 5)
    expect(shapes(visemesVi('họp'))).toBe('BEA')
    expect(shapes(visemesVi('sông'))).toBe('BE')
  })

  it('phụ âm đầu nhiều chữ (ngh, tr, nh) và "gi"', () => {
    expect(shapes(visemesVi('nghe'))).toBe('BC')
    expect(shapes(visemesVi('trăng'))).toBe('HD')
    expect(shapes(visemesVi('nhà'))).toBe('HD')
    expect(shapes(visemesVi('gìn'))).toBe('BC')
  })

  it('nguyên âm đôi: âm lướt o/u ngắn rồi nguyên âm chính', () => {
    const hoa = visemesVi('hoa')
    expect(shapes(hoa)).toBe('BED')
    expect(hoa[2].w).toBeGreaterThan(hoa[1].w)
  })

  it('tổng tỉ lệ = 1', () => {
    for (const w of ['nghiêng', 'mười', 'khuya', 'đêm']) expect(visemesVi(w).reduce((a, s) => a + s.w, 0)).toBeCloseTo(1, 6)
  })
})

describe('viseme tiếng Anh (luật trong config)', () => {
  it('cụm chữ dài nhất trước; e câm cuối từ bị bỏ', () => {
    expect(shapes(visemesEn('moon'))).toBe('AFH')
    expect(shapes(visemesEn('the'))).toBe('HC')
    expect(shapes(visemesEn('make'))).toBe('ADB')
    expect(shapes(visemesEn('father'))).toBe('GDHCB')
    expect(shapes(visemesEn('Water!'))).toBe('FDHCB')
  })
})

describe('câu → MouthCue', () => {
  const fps = 30

  it('chỉ có mốc từ ⇒ chia đều thời lượng từ cho các âm vị; khoảng lặng > 120ms ⇒ X', () => {
    const cues = lineMouthCues({
      text: 'Ma về',
      language: 'vi',
      start: 0,
      end: 2,
      words: [
        { word: 'Ma', start: 0, end: 0.5 },
        { word: 'về', start: 1, end: 1.6 }
      ],
      fps
    })
    expect(mouthAt(cues, 0.05)).toBe('A')
    expect(mouthAt(cues, 0.35)).toBe('D')
    expect(mouthAt(cues, 0.75)).toBe('X') // im lặng giữa 2 từ
    expect(mouthAt(cues, 1.05)).toBe('G')
    expect(mouthAt(cues, 1.8)).toBe('X')
  })

  it('không có mốc từ ⇒ ước lượng theo độ dài từ, phủ cả câu', () => {
    const cues = lineMouthCues({ text: 'Đừng trả lời.', language: 'vi', start: 3, end: 4.5, fps })
    expect(cues[0].start).toBeCloseTo(3, 1)
    expect(cues[cues.length - 1].end).toBeCloseTo(4.5, 1)
    expect(cues.some((c) => c.shape !== 'X')).toBe(true)
  })

  it('hybrid: âm lượng dưới ngưỡng im lặng ép về X; nói nhỏ biến D thành C', () => {
    const env = new Array(60).fill(-20)
    for (let f = 15; f < 30; f++) env[f] = -60
    const cues = lineMouthCues({ text: 'a a a a', language: 'vi', start: 0, end: 2, fps, envelope: env })
    expect(mouthAt(cues, 0.2)).toBe('D')
    expect(mouthAt(cues, 0.75)).toBe('X')
    const quiet = lineMouthCues({ text: 'a a a a', language: 'vi', start: 0, end: 2, fps, envelope: new Array(60).fill(-30) })
    expect(quiet.every((c) => c.shape !== 'D')).toBe(true)
  })

  it('thì thầm (bias B) ⇒ không mở to', () => {
    const cues = lineMouthCues({ text: 'ơ e a', language: 'vi', start: 0, end: 1.5, fps, bias: 'B' })
    expect(cues.every((c) => !['D', 'C', 'E'].includes(c.shape))).toBe(true)
  })

  it('tất định: 2 lần gọi cùng đầu vào ⇒ cùng kết quả', () => {
    const inp = { text: 'Nếu đêm nay có ai gọi tên bạn', language: 'vi', start: 1, end: 3.7, fps }
    expect(lineMouthCues(inp)).toEqual(lineMouthCues(inp))
  })
})

describe('hậu xử lý cue', () => {
  it('cue < 2 khung gộp vào cue kề; A giữ tối thiểu 2 khung', () => {
    const f: MouthShape[] = ['D', 'D', 'D', 'C', 'D', 'D', 'A', 'F', 'F', 'F', 'F']
    const cues = framesToCues(f, 0, 30)
    expect(cues.map((c) => c.shape)).toEqual(['D', 'A', 'F'])
    const a = cues.find((c) => c.shape === 'A')!
    expect(Math.round((a.end - a.start) * 30)).toBe(2)
    // liền mạch, không hở
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBe(cues[i - 1].end)
  })
})

describe('âm lượng (amplitude) có trễ', () => {
  it('rung quanh ngưỡng không làm miệng nhảy mức liên tục', () => {
    const db = [-60, -40, -33, -35, -33, -35, -33, -60]
    const s = amplitudeShapes(db)
    expect(s[0]).toBe('X')
    expect(s[2]).toBe('C')
    // -35 nằm trong vùng trễ của C (ngưỡng -34, trễ 3 dB) ⇒ vẫn là C
    expect(s.slice(2, 7).every((x) => x === 'C')).toBe(true)
    expect(s[7]).toBe('X')
  })

  it('tụt âm lượng đột ngột giữa câu ⇒ khép A thoáng qua', () => {
    expect(amplitudeShapes([-15, -15, -26, -15])[2]).toBe('A')
  })

  it('RMS theo khung từ PCM', () => {
    const pcm = new Int16Array(4410 * 2)
    for (let i = 4410; i < pcm.length; i++) pcm[i] = i % 2 ? 16384 : -16384
    const db = rmsDbPerFrame(pcm, 44100, 10)
    expect(db[0]).toBe(-120)
    expect(db[1]).toBeCloseTo(-6, 0)
  })
})

describe('chớp mắt', () => {
  it('tất định theo seed, khoảng cách trong [min, max]', () => {
    const a = blinkStarts('rig-narrator:scene-1', 30 * 60, 30, 2, 5)
    expect(blinkStarts('rig-narrator:scene-1', 30 * 60, 30, 2, 5)).toEqual(a)
    expect(blinkStarts('rig-narrator:scene-2', 30 * 60, 30, 2, 5)).not.toEqual(a)
    for (let i = 1; i < a.length; i++) {
      const gap = (a[i] - a[i - 1]) / 30
      expect(gap).toBeGreaterThanOrEqual(2)
      expect(gap).toBeLessThanOrEqual(5.2)
    }
  })

  it('chuỗi mở → nửa → nhắm → nửa → mở; tránh khung bị cấm', () => {
    const s = blinkStarts('x', 300, 30, 2, 3)
    const f = s[0]
    expect([blinkStateAt(s, f - 1), blinkStateAt(s, f), blinkStateAt(s, f + 1), blinkStateAt(s, f + 3), blinkStateAt(s, f + 4)]).toEqual([null, 'half', 'closed', 'half', null])
    const avoid = blinkStarts('x', 300, 30, 2, 3, 1, (fr) => fr >= f - 2 && fr <= f + 10)
    expect(avoid[0]).toBeGreaterThan(f + 10)
  })

  it('lo sợ (rate cao) ⇒ chớp dày hơn', () => {
    expect(blinkStarts('y', 1800, 30, 2, 5, 2).length).toBeGreaterThan(blinkStarts('y', 1800, 30, 2, 5, 1).length)
  })
})

describe('chọn cảnh rối', () => {
  const sc = (start: number, end: number, eligible = true): { start: number; end: number; eligible: boolean } => ({ start, end, eligible })
  it('tôn trọng puppetMaxRatio và ưu tiên theo thời gian', () => {
    const scenes = [sc(0, 6), sc(6, 12, false), sc(12, 18), sc(18, 24), sc(24, 30)]
    expect([...selectPuppetScenes(scenes, 100, 0.15, 12)]).toEqual([0, 2])
    expect(selectPuppetScenes(scenes, 100, 0, 12).size).toBe(0)
  })

  it('không chuỗi rối liền nhau quá maxContinuousSec', () => {
    const scenes = [sc(0, 5), sc(5, 10), sc(10, 15), sc(15, 20)]
    expect([...selectPuppetScenes(scenes, 20, 1, 12)]).toEqual([0, 1, 3])
  })
})
