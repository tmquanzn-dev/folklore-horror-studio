import { describe, expect, it } from 'vitest'
import { computeFocusCrop, computeVerticalLayout } from '../src/shared/logic/focusCrop'
import { heroCount, selectHeroScenes } from '../src/shared/logic/hero'
import { buildSubtitles, chunkWords, wordTimings } from '../src/shared/logic/subtitles'
import { kenBurnsAt } from '../src/shared/logic/kenBurns'
import { platformsConfig } from '../src/shared/config'
import type { PronunciationEntry } from '../src/shared/types'

describe('cắt dọc theo focusPoint', () => {
  it('vùng 9:16 từ ảnh 1920×1080 bám theo focusPoint', () => {
    const r = computeFocusCrop(1920, 1080, { x: 0.25, y: 0.5 }, 9 / 16)
    expect(r.height).toBe(1080)
    expect(r.width).toBe(608)
    expect(r.left).toBe(Math.round(0.25 * 1920 - 304))
    expect(r.top).toBe(0)
  })

  it('focusPoint sát mép bị kẹp trong ảnh', () => {
    expect(computeFocusCrop(1920, 1080, { x: 0, y: 0.5 }, 9 / 16).left).toBe(0)
    const r = computeFocusCrop(1920, 1080, { x: 1, y: 0.5 }, 9 / 16)
    expect(r.left + r.width).toBe(1920)
  })

  it('ảnh hẹp hơn tỷ lệ đích ⇒ cắt theo chiều cao quanh focus y', () => {
    const r = computeFocusCrop(1000, 2000, { x: 0.5, y: 0.9 }, 1)
    expect(r).toEqual({ left: 0, top: 1000, width: 1000, height: 1000 })
  })

  it('bố cục khung dọc: tiền cảnh rộng hết khung, căn giữa theo chiều dọc', () => {
    const l = computeVerticalLayout(1920, 1080, { x: 0.6, y: 0.5 }, { outW: 1080, outH: 1920, cropAspect: 0.8 })
    expect(l.foregroundCrop.width / l.foregroundCrop.height).toBeCloseTo(0.8, 2)
    expect(l.fgWidth).toBe(1080)
    expect(l.fgHeight).toBe(1350)
    expect(l.fgTop).toBe(285)
  })
})

describe('chọn cảnh hero theo heroRatio', () => {
  it('số cảnh hero = round(n × ratio), tối thiểu 1 khi ratio > 0', () => {
    expect(heroCount(20, 0.05)).toBe(1)
    expect(heroCount(20, 0.15)).toBe(3)
    expect(heroCount(10, 0)).toBe(0)
    expect(heroCount(0, 0.2)).toBe(0)
  })

  it('ưu tiên hook (cảnh đầu) và cao trào, trả về theo thứ tự timeline', () => {
    const scenes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id, i) => ({
      id,
      beatId: i === 7 ? 'climax' : i === 4 ? 'tense' : 'calm'
    }))
    const intensity = (b: string): number => (b === 'climax' ? 1 : b === 'tense' ? 0.8 : 0.3)
    expect(selectHeroScenes(scenes, intensity, 0.2)).toEqual(['a', 'h'])
    expect(selectHeroScenes(scenes, intensity, 0.3)).toEqual(['a', 'e', 'h'])
  })
})

describe('phụ đề', () => {
  const glossary: PronunciationEntry[] = [
    { id: 'g1', language: 'en', term: 'cây đa', ttsRespelling: 'kay dah', notes: '', glossEn: 'banyan' },
    { id: 'g2', language: 'en', term: 'ma da', ttsRespelling: 'mah yah', notes: '', glossEn: 'ghost' }
  ]

  it('mốc từng từ phủ kín câu, tăng dần', () => {
    const t = wordTimings(['a', 'bbbb', 'cc'], 1, 3)
    expect(t[0].start).toBe(1)
    expect(t[2].end).toBe(3)
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBe(t[i - 1].end)
  })

  it('chia cụm theo maxWords / maxChars', () => {
    const words = 'one two three four five six seven'.split(' ')
    for (const [a, b] of chunkWords(words, 3, 100)) expect(b - a).toBeLessThanOrEqual(3)
    for (const [a, b] of chunkWords(words, 10, 9)) expect(words.slice(a, b).join(' ').length).toBeLessThanOrEqual(9)
  })

  it('preset TikTok: cụm ngắn; thuật ngữ được đánh dấu ở preset YouTube', () => {
    const lines = [{ id: 'l1', text: 'Never swim near the old cây đa, where the ma da waits for you tonight.', start: 0, end: 5 }]
    const tiktok = buildSubtitles(lines, [], platformsConfig.subtitleStyles.tiktok)
    expect(tiktok.length).toBeGreaterThan(2)
    for (const c of tiktok) expect(c.words.length).toBeLessThanOrEqual(5)

    const yt = buildSubtitles(lines, glossary, platformsConfig.subtitleStyles.youtube)
    const emph = yt.flatMap((c) => c.words).filter((w) => w.emphasis).map((w) => w.text)
    expect(emph).toEqual(['cây', 'đa,', 'ma', 'da'])
    expect(yt.flatMap((c) => c.glossaryTermIds).sort()).toEqual(['g1', 'g2'])
  })
})

describe('Ken Burns', () => {
  const m = { level: 'kenBurns' as const, intensity: 0.5, easing: 'linear' as const, focusPoint: { x: 0.3, y: 0.4 } }
  it('zoomIn tăng dần, zoom quanh focusPoint', () => {
    const a = kenBurnsAt({ ...m, type: 'zoomIn' }, 0)
    const b = kenBurnsAt({ ...m, type: 'zoomIn' }, 1)
    expect(b.scale).toBeGreaterThan(a.scale)
    expect(a.originXPercent).toBe(30)
  })
  it('pan không bao giờ lộ mép ảnh', () => {
    for (const type of ['panLeft', 'panRight', 'panUp', 'panDown'] as const) {
      for (const t of [0, 0.5, 1]) {
        const f = kenBurnsAt({ ...m, type, intensity: 1 }, t)
        const max = ((f.scale - 1) / 2) * 100
        expect(Math.abs(f.translateXPercent)).toBeLessThanOrEqual(max)
        expect(Math.abs(f.translateYPercent)).toBeLessThanOrEqual(max)
      }
    }
  })
})
