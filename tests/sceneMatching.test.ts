import { describe, expect, it } from 'vitest'
import { chunkLines, findDiversityViolations, matchScenes, type MatchLine } from '../src/shared/logic/sceneMatching'
import { assignMotions, assignTransitions } from '../src/shared/logic/motion'
import { createSampleStory, sampleChannel } from '../src/shared/sampleData'
import type { Beat, SceneBankItem, ShotType } from '../src/shared/types'

const opts = { minSec: 3, targetSec: 5, maxSec: 8, cutLeadSec: 0.2 }

function bankItem(id: string, beatId: string, shotType: ShotType): SceneBankItem {
  return {
    ...createSampleStory().sceneBank[0],
    id,
    beatId,
    shotType
  }
}

/** n câu liên tiếp mỗi câu dur giây, cách nhau 0.5s */
function lines(beatIds: string[], dur = 2): MatchLine[] {
  let t = 0.4
  return beatIds.map((b, i) => {
    const l = { id: `l${i + 1}`, beatId: b, start: t, end: t + dur }
    t += dur + 0.5
    return l
  })
}

const beats: Beat[] = [1, 2, 3].map((o) => ({
  id: `b${o}`,
  order: o,
  summaryVi: '',
  summaryEn: '',
  emotionalIntensity: o / 3,
  mustShow: []
}))

describe('chunkLines', () => {
  it('nhóm câu thành cụm 3–8 giây, không cắt giữa câu', () => {
    const chunks = chunkLines(lines(['b1', 'b1', 'b1', 'b1', 'b1']), opts)
    for (const c of chunks) {
      const d = c[c.length - 1].end - c[0].start
      expect(d).toBeGreaterThanOrEqual(3)
      expect(d).toBeLessThanOrEqual(8)
    }
    expect(chunks.flat().length).toBe(5)
  })

  it('câu dài hơn maxSec đứng riêng một cảnh', () => {
    const chunks = chunkLines(lines(['b1', 'b1'], 9), opts)
    expect(chunks.length).toBe(2)
  })

  it('cụm cuối quá ngắn được nhập vào cụm trước', () => {
    const ls = lines(['b1', 'b1', 'b1'], 2.6) // 2.6 + 0.5 + 2.6 = 5.7 ⇒ cắt; còn lại 2.6 < 3 ⇒ nhập
    expect(chunkLines(ls, opts).length).toBe(1)
  })
})

describe('matchScenes', () => {
  const bank = [
    bankItem('s1', 'b1', 'wide'),
    bankItem('s2', 'b1', 'closeUp'),
    bankItem('s3', 'b2', 'medium'),
    bankItem('s4', 'b2', 'insert')
  ]

  it('cảnh phủ kín timeline, liên tục, biên nằm giữa 2 câu', () => {
    const ls = lines(['b1', 'b1', 'b1', 'b1', 'b2', 'b2', 'b2'])
    const total = ls[ls.length - 1].end + 1
    const { scenes } = matchScenes(ls, bank, beats, total, opts)
    expect(scenes[0].start).toBe(0)
    expect(scenes[scenes.length - 1].end).toBe(total)
    for (let i = 1; i < scenes.length; i++) expect(scenes[i].start).toBe(scenes[i - 1].end)
    // mỗi biên cảnh nằm trước đầu câu đầu tiên của cảnh, sau cuối câu trước
    for (let i = 1; i < scenes.length; i++) {
      const first = ls.find((l) => l.id === scenes[i].lineIds[0])!
      const prevLast = ls.find((l) => l.id === scenes[i - 1].lineIds[scenes[i - 1].lineIds.length - 1])!
      expect(scenes[i].start).toBeLessThanOrEqual(first.start)
      expect(scenes[i].start).toBeGreaterThanOrEqual(prevLast.end)
    }
    // cảnh lấy đúng beat
    for (const s of scenes) expect(bank.find((b) => b.id === s.sceneBankId)!.beatId).toBe(s.beatId)
  })

  it('không 2 cảnh liền nhau cùng ảnh / cùng shotType khi còn lựa chọn', () => {
    const ls = lines(['b1', 'b1', 'b1', 'b1', 'b1', 'b1', 'b1', 'b1'])
    const { scenes } = matchScenes(ls, bank, beats, 30, opts)
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].sceneBankId).not.toBe(scenes[i - 1].sceneBankId)
    }
  })

  it('beat thiếu cảnh: mượn beat gần nhất và báo gợi ý', () => {
    const ls = lines(['b3', 'b3'])
    const { scenes, missing } = matchScenes(ls, bank, beats, 10, opts)
    expect(scenes.length).toBeGreaterThan(0)
    expect(missing[0]).toMatchObject({ beatId: 'b3', reason: 'noScenes' })
    expect(bank.find((b) => b.id === scenes[0].sceneBankId)!.beatId).toBe('b2')
  })
})

describe('luật đa dạng shot/motion', () => {
  it('phát hiện vi phạm', () => {
    const v = findDiversityViolations([
      { shotType: 'wide', motionType: 'zoomIn' },
      { shotType: 'wide', motionType: 'zoomIn' },
      { shotType: 'closeUp', motionType: 'panLeft' }
    ])
    expect(v).toEqual([
      { index: 1, kind: 'shotType' },
      { index: 1, kind: 'motion' }
    ])
  })

  it('assignMotions không bao giờ lặp kiểu chuyển động liền nhau; beat căng thẳng ưu tiên zoomIn', () => {
    const scenes = Array.from({ length: 12 }, (_, i) => ({ beatId: i < 6 ? 'calm' : 'tense', focusPoint: { x: 0.5, y: 0.5 } }))
    const motions = assignMotions(scenes, (b) => (b === 'tense' ? 0.95 : 0.2), sampleChannel.motionProfile)
    for (let i = 1; i < motions.length; i++) expect(motions[i].type).not.toBe(motions[i - 1].type)
    expect(motions[6].type).toBe('zoomIn')
    expect(motions[6].intensity).toBeGreaterThan(motions[0].intensity)
    expect(motions[6].easing).toBe('easeIn')
  })

  it('assignTransitions: mở đầu dip-to-black, đổi beat cao trào dùng flash', () => {
    const t = assignTransitions(
      [{ beatId: 'a' }, { beatId: 'a' }, { beatId: 'climax' }],
      (b) => (b === 'climax' ? 1 : 0.3),
      sampleChannel.motionProfile
    )
    expect(t.map((x) => x.type)).toEqual(['dipToBlack', 'fade', 'flash'])
  })

  it('dữ liệu mẫu: luật đa dạng motion luôn được tuân thủ', () => {
    const story = createSampleStory()
    const ls: MatchLine[] = lines(story.outline.beats.flatMap((b) => [b.id, b.id, b.id]))
    const { scenes } = matchScenes(ls, story.sceneBank, story.outline.beats, 80, opts)
    const intensity = (id: string): number => story.outline.beats.find((b) => b.id === id)!.emotionalIntensity
    const motions = assignMotions(
      scenes.map((s) => ({ beatId: s.beatId, focusPoint: { x: 0.5, y: 0.5 } })),
      intensity,
      sampleChannel.motionProfile
    )
    const v = findDiversityViolations(
      scenes.map((s, i) => ({ shotType: story.sceneBank.find((b) => b.id === s.sceneBankId)!.shotType, motionType: motions[i].type }))
    )
    expect(v.filter((x) => x.kind === 'motion')).toEqual([])
  })
})
