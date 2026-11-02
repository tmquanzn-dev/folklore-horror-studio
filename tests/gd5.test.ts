/**
 * GĐ5: Shorts teaser, gói xuất bản (mô tả/chapters/hashtag/checklist), sổ hiệu quả, sổ chi phí, thumbnail.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { composeThumbnail, thumbnailSvg, wrapWords } from '../src/main/media/thumbnail'
import { applyWindow, type CompositionProps } from '../src/shared/composition'
import { adaptSuggestion, buildCostReport, costCsv, engagementRate, type CostRow } from '../src/shared/logic/business'
import { buildChecklist, buildYoutubeDescription, fmtTimestamp, normalizeHashtags, normalizeTags, validChapters, type ChecklistFacts } from '../src/shared/logic/publishing'
import { selectTeaserWindow, type TeaserLine } from '../src/shared/logic/shorts'
import { migrateRelease } from '../src/shared/migrate'
import type { Chapter, FolkloreEntry, PerformanceNote, PronunciationEntry, Release } from '../src/shared/types'

// ---------------------------------------------------------------- Shorts teaser
describe('selectTeaserWindow', () => {
  // 30 câu × 4s; beat b2 (câu 10–19) căng nhất
  const lines: TeaserLine[] = Array.from({ length: 30 }, (_, i) => ({
    id: `l${i}`,
    start: i * 4,
    end: i * 4 + 3.8,
    beatId: i < 10 ? 'b1' : i < 20 ? 'b2' : 'b3',
    sectionKind: i < 2 ? 'coldOpen' : i >= 28 ? 'outro' : 'story'
  }))
  const intensity = (b: string): number => ({ b1: 0.3, b2: 0.9, b3: 0.5 })[b] ?? 0.5

  it('chọn đoạn liền mạch trong beat căng nhất, độ dài trong khoảng', () => {
    const w = selectTeaserWindow(lines, intensity, { minSec: 28, maxSec: 55 })!
    expect(w).not.toBeNull()
    const len = w.end - w.start
    expect(len).toBeGreaterThanOrEqual(28)
    expect(len).toBeLessThanOrEqual(55)
    // bắt đầu/kết thúc đúng mép câu
    expect(lines.some((l) => l.start === w.start)).toBe(true)
    expect(lines.some((l) => l.end === w.end)).toBe(true)
    // nằm gọn trong beat b2
    expect(w.lineIds.every((id) => Number(id.slice(1)) >= 10 && Number(id.slice(1)) < 20)).toBe(true)
  })

  it('bỏ cold open/outro; bản quá ngắn ⇒ null', () => {
    const w = selectTeaserWindow(lines, () => 0.5, { minSec: 28, maxSec: 55 })!
    expect(w.lineIds).not.toContain('l0')
    expect(w.lineIds).not.toContain('l29')
    expect(selectTeaserWindow(lines.slice(0, 5), intensity, { minSec: 28, maxSec: 55 })).toBeNull()
  })

  it('không nối qua câu không liền nhau', () => {
    const gappy = lines.map((l, i) => (i === 15 ? { ...l, sectionKind: 'explain' } : l))
    const w = selectTeaserWindow(gappy, intensity, { minSec: 28, maxSec: 55 })!
    expect(w.lineIds).not.toContain('l15')
    const idx = w.lineIds.map((id) => Number(id.slice(1)))
    expect(idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)).toBe(true)
  })
})

describe('applyWindow', () => {
  const props = {
    durationSec: 120,
    voiceSrc: 'full.wav',
    scenes: [
      { id: 's1', startSec: 0, endSec: 40, transition: { type: 'cut', durationSec: 0 } },
      { id: 's2', startSec: 40, endSec: 80, transition: { type: 'cut', durationSec: 0 } },
      { id: 's3', startSec: 80, endSec: 120, transition: { type: 'cut', durationSec: 0 } }
    ],
    subtitles: [
      { start: 10, end: 12, text: 'a', words: [] },
      { start: 50, end: 53, text: 'b', words: [{ text: 'b', start: 50, end: 51 }] }
    ],
    glossaryCards: [{ term: 'ma da', start: 55, end: 59 }],
    partLabel: 'Phần 1/3'
  } as unknown as CompositionProps

  it('dời mốc về 0, giữ cảnh giao, cảnh cuối phủ thẻ kết', () => {
    const out = applyWindow(props, { start: 45, end: 85, voiceRelPath: 'v.wav', hookText: 'Móc', ctaTitle: 'Xem bản đầy đủ', ctaSub: 'Kênh', hookCardSec: 3, endCardSec: 3 }, 'teaser.wav')
    expect(out.durationSec).toBe(43)
    expect(out.voiceSrc).toBe('teaser.wav')
    expect(out.scenes.map((s) => s.id)).toEqual(['s2', 's3'])
    expect(out.scenes[0].startSec).toBe(0)
    expect(out.scenes[1].endSec).toBe(43)
    expect(out.subtitles).toHaveLength(1)
    expect(out.subtitles[0].start).toBe(5)
    expect(out.subtitles[0].words[0].start).toBe(5)
    expect(out.glossaryCards[0].start).toBe(10)
    expect(out.partLabel).toBeNull()
    expect(out.hookCard).toEqual({ text: 'Móc', untilSec: 3 })
    expect(out.endCard?.fromSec).toBe(40)
  })
})

// ---------------------------------------------------------------- Gói xuất bản
describe('publishing', () => {
  it('fmtTimestamp + validChapters (0:00, ≥3, cách ≥10s)', () => {
    expect(fmtTimestamp(65)).toBe('1:05')
    expect(fmtTimestamp(3725)).toBe('1:02:05')
    const ch = (start: number, title: string): Chapter => ({ start, title }) as Chapter
    expect(validChapters([ch(2, 'A'), ch(5, 'X'), ch(60, 'B'), ch(120, 'C')]).map((c) => [c.start, c.title])).toEqual([
      [0, 'A'],
      [60, 'B'],
      [120, 'C']
    ])
    expect(validChapters([ch(0, 'A'), ch(60, 'B')])).toEqual([])
  })

  it('mô tả YouTube có chapters, thuật ngữ, nguồn truyền thuyết, ghi chú hư cấu, nhãn AI', () => {
    const d = buildYoutubeDescription({
      intro: 'A river spirit story.',
      chapters: [{ start: 0, title: 'Intro' }, { start: 30, title: 'The River' }, { start: 90, title: 'The Call' }] as Chapter[],
      glossary: [{ term: 'ma da', glossEn: 'drowned water spirit' }] as PronunciationEntry[],
      folklore: [{ nameEn: 'Ma Da', nameVi: 'Ma da', isDocumentedFolklore: true, sources: ['Vietnamese folk tales'] }] as FolkloreEntry[],
      fictionNote: 'Làng là hư cấu',
      language: 'en'
    })
    expect(d).toContain('Chapters:\n0:00 Intro\n0:30 The River\n1:30 The Call')
    expect(d).toContain('• ma da – drowned water spirit')
    expect(d).toContain('documented Vietnamese folk belief (sources: Vietnamese folk tales)')
    expect(d).toMatch(/fictional/)
    expect(d).toMatch(/AI-assisted/)
  })

  it('hashtag/tag chuẩn hoá, bỏ trùng, giới hạn', () => {
    expect(normalizeHashtags(['ma da', '#MaDa', 'truyện ma', '', '##kinhdi'], 8)).toEqual(['#mada', '#truyệnma', '#kinhdi'])
    expect(normalizeHashtags(Array.from({ length: 20 }, (_, i) => `t${i}`), 5)).toHaveLength(5)
    const tags = normalizeTags(['horror', 'Horror', ...Array.from({ length: 100 }, (_, i) => `vietnamese folklore ${i}`)])
    expect(tags.filter((t) => t.toLowerCase() === 'horror')).toHaveLength(1)
    expect(tags.join(',').length).toBeLessThanOrEqual(480)
  })

  it('checklist: mục tự động theo dữ kiện, mục tay giữ trạng thái, có nhãn phần khi là series', () => {
    const f: ChecklistFacts = {
      voicesAllLicensed: false,
      usesMockMedia: true,
      soundAllLicensed: true,
      hasRender: true,
      hasThumbnail: false,
      isSeries: true,
      partLabelInCaption: true,
      fictionNoteInDescription: true,
      hasDescriptionOrCaption: true
    }
    const first = buildChecklist(f)
    expect(first.find((c) => c.id === 'no-mock')?.done).toBe(false)
    expect(first.find((c) => c.id === 'voice-license')?.detail).toMatch(/Voice Studio/)
    expect(first.find((c) => c.id === 'part-label')?.done).toBe(true)
    expect(first.find((c) => c.id === 'ai-label')?.done).toBe(false)
    const ticked = first.map((c) => (c.id === 'ai-label' ? { ...c, done: true } : c))
    const again = buildChecklist({ ...f, isSeries: false, usesMockMedia: false }, ticked)
    expect(again.find((c) => c.id === 'ai-label')?.done).toBe(true)
    expect(again.find((c) => c.id === 'no-mock')?.done).toBe(true)
    expect(again.some((c) => c.id === 'part-label')).toBe(false)
  })

  it('migrateRelease: gói cũ (ý tưởng dạng chuỗi) được nâng cấp', () => {
    const r = migrateRelease({
      publishing: { youtube: { titleOptions: ['T'], description: 'd', tags: [], thumbnailConcepts: ['CREEPY RIVER'] }, aiDisclosureNeeded: true, checklist: [] }
    } as unknown as Release)
    expect(r.publishing?.thumbnails).toEqual([])
    expect(r.publishing?.selectedThumbnail).toBeNull()
    expect(r.publishing?.youtube?.thumbnailConcepts[0]).toMatchObject({ text: 'CREEPY RIVER' })
  })
})

// ---------------------------------------------------------------- Sổ hiệu quả & chi phí
describe('business', () => {
  const note = (releaseId: string, views: number, avg: number): PerformanceNote => ({ id: `${releaseId}-${views}`, releaseId, date: '2026-10-01', views, avgWatchPercent: avg, likes: 100, comments: 20, shares: 30, notes: '' })
  const rels = [
    { id: 'tt1', platform: 'tiktok' as const, language: 'vi' },
    { id: 'yt1', platform: 'youtube' as const, language: 'en' }
  ]
  const t = { minViews: 10000, minAvgWatchPercent: 40 }

  it('gợi ý chuyển thể khi TikTok đạt ngưỡng và chưa có YouTube EN', () => {
    expect(adaptSuggestion([], rels, t).qualifies).toBe(false)
    expect(adaptSuggestion([note('tt1', 5000, 60)], [rels[0]], t).qualifies).toBe(false)
    expect(adaptSuggestion([note('tt1', 5000, 60), note('tt1', 25000, 45)], [rels[0]], t)).toMatchObject({ qualifies: true, best: { views: 25000 } })
    // số liệu YouTube không tính
    expect(adaptSuggestion([note('yt1', 99999, 90)], [rels[0], { id: 'yt1', platform: 'youtube', language: 'vi' }], t).qualifies).toBe(false)
    const done = adaptSuggestion([note('tt1', 25000, 45)], rels, t)
    expect(done.qualifies).toBe(false)
    expect(done.reason).toMatch(/Đã có bản YouTube tiếng Anh/)
    expect(engagementRate(note('tt1', 1000, 50))).toBe(15)
  })

  it('báo cáo chi phí theo tháng + CSV có BOM, escape dấu phẩy', () => {
    const row = (storyId: string, provider: string, kind: CostRow['kind'], cost: number, ts: string): CostRow => ({ storyId, storyName: storyId === 's1' ? 'Ma da, bến sông' : 'Bùa', releaseId: null, releaseTitle: null, provider, kind, units: 1, cost, timestamp: ts })
    const rows = [row('s1', 'openai', 'llm', 0.02, '2026-10-03T10:00:00Z'), row('s1', 'gemini', 'image', 0.5, '2026-10-05T10:00:00Z'), row('s2', 'gemini', 'image', 0.3, '2026-10-06T10:00:00Z'), row('s2', 'elevenlabs', 'tts', 1, '2026-09-01T10:00:00Z')]
    const r = buildCostReport(rows, '2026-10', { s1: 0.4, s2: 5 })
    expect(r.total).toBeCloseTo(0.82)
    expect(r.rows).toHaveLength(3)
    expect(r.byStory[0]).toMatchObject({ storyId: 's1', total: 0.52, budget: 0.4 })
    expect(r.byProvider[0]).toMatchObject({ provider: 'gemini', total: 0.8 })
    expect(buildCostReport(rows, 'all', {}).total).toBeCloseTo(1.82)
    const csv = costCsv(r.rows)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"Ma da, bến sông"')
    expect(csv.split('\r\n')).toHaveLength(4)
  })
})

// ---------------------------------------------------------------- Thumbnail
describe('thumbnail', () => {
  it('wrapWords ngắt dòng, gộp phần dư vào dòng cuối', () => {
    expect(wrapWords('ĐỪNG NHÌN VÀO GƯƠNG LÚC NỬA ĐÊM', 10, 3)).toEqual(['ĐỪNG NHÌN', 'VÀO GƯƠNG', 'LÚC NỬA ĐÊM'])
    expect(wrapWords('a b c d e f g', 1, 2)).toEqual(['a', 'b c d e f g'])
  })

  it('SVG giữ dấu tiếng Việt, escape ký tự XML, có badge', () => {
    const svg = thumbnailSvg({ width: 1280, height: 720, text: 'Ma da <sông> & bến', sub: 'Truyền thuyết', badge: 'PHẦN 1/3', layout: 'youtube' })
    expect(svg).toContain('&lt;SÔNG&gt;')
    expect(svg).toContain('&amp;')
    expect(svg).toContain('PHẦN 1/3')
    expect(svg).toContain('Truyền thuyết')
  })

  it('ghép chữ lên ảnh nền ⇒ đúng kích thước 1280×720 và 1080×1920', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-thumb-'))
    const src = path.join(dir, 'nền ảnh.png')
    await sharp({ create: { width: 800, height: 800, channels: 3, background: '#203040' } }).png().toFile(src)
    const yt = path.join(dir, 'yt.jpg')
    await composeThumbnail(src, yt, { width: 1280, height: 720, text: 'Ma da', layout: 'youtube' }, { x: 0.5, y: 0.5 })
    expect(await sharp(yt).metadata()).toMatchObject({ width: 1280, height: 720 })
    const cover = path.join(dir, 'cover.jpg')
    await composeThumbnail(src, cover, { width: 1080, height: 1920, text: 'Ma da', badge: 'PHẦN 2/3', layout: 'cover' }, { x: 0.5, y: 0.5 })
    expect(await sharp(cover).metadata()).toMatchObject({ width: 1080, height: 1920 })
    await fs.rm(dir, { recursive: true, force: true })
  })
})
