/**
 * GĐ6: căn mốc giọng tự thu, Whisper (fetch giả), Mock chép lời, SRT, FCPXML, CapCut template mode.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runFfmpeg } from '../src/main/media/ffmpeg'
import { MockTranscriber, speechIntervals, spreadWords } from '../src/main/providers/stt/mockTranscriber'
import { WhisperTranscriber } from '../src/main/providers/stt/whisper'
import { alignTranscript, normalizeToken, splitWords } from '../src/shared/logic/align'
import { CapcutTemplateError, fillCapcutTemplate, parseCapcutDraft, setTextContent, updateCapcutMeta, type CapcutTimeline } from '../src/shared/logic/capcut'
import { buildFcpxml, buildSrt, captionCues, srtTime, wrapTwoLines } from '../src/shared/logic/exportFormats'
import { realTimings } from '../src/shared/logic/subtitles'

/** Giả lập bản chép lời: rải từ đều, mỗi từ 0.4s, câu cách nhau 1s */
function fakeTranscript(sentences: string[], mutate: (w: string, i: number) => string[] = (w) => [w]): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = []
  let t = 0.5
  let i = 0
  for (const s of sentences) {
    for (const w of splitWords(s)) {
      for (const x of mutate(w, i++)) {
        out.push({ word: x, start: t, end: t + 0.35 })
        t += 0.4
      }
    }
    t += 1
  }
  return out
}

// ---------------------------------------------------------------- căn mốc
describe('alignTranscript', () => {
  const lines = [
    { id: 'a', text: 'Đêm ấy, nước sông đen như mực.' },
    { id: 'b', text: 'Bà Sáu dặn: "Đừng trả lời khi ai gọi tên mình."' },
    { id: 'c', text: 'Rồi một bàn tay lạnh ngắt nắm lấy cổ chân Lan.' }
  ]

  it('chuẩn hoá: bỏ dấu, đ→d, bỏ dấu câu', () => {
    expect(normalizeToken('"Đừng')).toBe('dung')
    expect(normalizeToken('mực.')).toBe('muc')
    expect(splitWords('Đêm ấy — nước')).toEqual(['Đêm', 'ấy', 'nước'])
  })

  it('khớp hoàn toàn dù Whisper viết thường, mất dấu thanh, mất dấu câu', () => {
    const tr = fakeTranscript(lines.map((l) => l.text), (w) => [normalizeToken(w)])
    const r = alignTranscript(lines, tr, 30)
    expect(r.coverage).toBe(1)
    expect(r.lines.map((l) => l.confidence)).toEqual([1, 1, 1])
    // mốc câu = từ đầu → từ cuối; chữ phụ đề giữ theo kịch bản
    expect(r.lines[0].start).toBe(0.5)
    expect(r.lines[0].words[0].word).toBe('Đêm')
    expect(r.lines[1].start).toBeGreaterThan(r.lines[0].end)
    expect(r.lines[2].end).toBeCloseTo(tr[tr.length - 1].end, 3)
  })

  it('đọc thừa, đọc lại (retake), bỏ sót 1 từ, nghe lệch 1 ký tự vẫn khớp đúng câu', () => {
    const tr = fakeTranscript(lines.map((l) => l.text), (w, i) => {
      if (i === 3) return [] // bỏ sót "sông"
      if (i === 8) return ['ờ', w] // đọc thừa
      if (i === 12) return ['trả', 'lời', 'trả', 'lời'].slice(0, 1).concat([w]) // lặp
      if (w === 'ngắt') return ['ngắc'] // nghe lệch
      return [normalizeToken(w)]
    })
    const r = alignTranscript(lines, tr, 30)
    expect(r.coverage).toBeGreaterThan(0.9)
    expect(r.extraWords).toBeGreaterThanOrEqual(2)
    expect(r.lines.every((l) => l.confidence >= 0.85)).toBe(true)
    // không chồng lấn, tăng dần
    for (let i = 1; i < r.lines.length; i++) expect(r.lines[i].start).toBeGreaterThanOrEqual(r.lines[i - 1].end)
  })

  it('câu không đọc ⇒ nội suy giữa câu trước và sau, đánh dấu interpolated', () => {
    const tr = fakeTranscript([lines[0].text, lines[2].text], (w) => [normalizeToken(w)])
    const r = alignTranscript(lines, tr, 30)
    const b = r.lines[1]
    expect(b.interpolated).toBe(true)
    expect(b.confidence).toBe(0)
    expect(b.start).toBeGreaterThanOrEqual(r.lines[0].end)
    expect(b.end).toBeLessThanOrEqual(r.lines[2].start + 1e-6)
  })

  it('realTimings: token chỉ có dấu câu dính vào từ trước; lệch số từ ⇒ quay về ước lượng', () => {
    const t = realTimings(['Đêm', '—', 'tối'], [{ start: 1, end: 1.4 }, { start: 2, end: 2.5 }], 1, 2.5)
    expect(t).toEqual([{ start: 1, end: 1.4 }, { start: 1.4, end: 1.4 }, { start: 2, end: 2.5 }])
    const est = realTimings(['a', 'b', 'c'], [{ start: 1, end: 2 }], 0, 3)
    expect(est[2].end).toBe(3)
  })
})

// ---------------------------------------------------------------- chép lời
describe('chép lời', () => {
  it('speechIntervals + spreadWords: từ nằm trong đoạn có tiếng, bỏ qua khoảng lặng', () => {
    const log = 'silence_start: 2.0\nsilence_end: 3.5 | silence_duration: 1.5\nsilence_start: 6\n'
    const iv = speechIntervals(log, 7)
    expect(iv).toEqual([{ start: 0, end: 2 }, { start: 3.5, end: 6 }])
    const w = spreadWords(['một', 'hai', 'ba', 'bốn'], iv)
    expect(w[0].start).toBe(0)
    expect(w[w.length - 1].end).toBe(6)
    expect(w.every((x) => !(x.start > 2.001 && x.start < 3.499))).toBe(true)
  })

  it('Whisper: gửi verbose_json + mốc từ, cộng chi phí theo phút; thiếu key ⇒ lỗi tiếng Việt', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-stt-'))
    const wav = path.join(dir, 'giọng thử.wav')
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-ac', '1', '-ar', '44100', wav])
    let sent: FormData | null = null
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData
      return new Response(JSON.stringify({ text: 'xin chào', language: 'vietnamese', words: [{ word: 'xin', start: 0.1, end: 0.4 }, { word: 'chào', start: 0.5, end: 0.9 }], segments: [{ text: 'xin chào', start: 0, end: 1 }] }), { status: 200 })
    }) as unknown as typeof fetch
    const w = new WhisperTranscriber(() => 'sk-test', fakeFetch)
    const r = await w.transcribe(wav, 'vi', { prompt: 'Ma da, cây đa' })
    expect(r.words).toHaveLength(2)
    expect(r.cost).toBeCloseTo((6 / 60) * 0.006, 5)
    const form = sent as unknown as FormData
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
    expect(form.get('language')).toBe('vi')
    expect(form.get('prompt')).toBe('Ma da, cây đa')
    await expect(new WhisperTranscriber(() => null).transcribe(wav, 'vi')).rejects.toThrow(/API key OpenAI/)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('Mock: chép lời file có khoảng lặng, căn mốc lại đúng câu', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-stt-'))
    const wav = path.join(dir, 'rec.wav')
    // 3 câu tiếng (2s, 3s, 2s) cách nhau 1s im lặng
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2',
      '-filter_complex', '[1]atrim=0:1[s1];[1]atrim=0:1[s2];[0][s1][2][s2][3]concat=n=5:v=0:a=1,aformat=sample_rates=44100:channel_layouts=mono',
      wav
    ])
    const lines = [
      { id: 'a', text: 'Một hai ba bốn' },
      { id: 'b', text: 'Năm sáu bảy tám chín' }, // trọng số ký tự ≈ tỉ lệ 2s : 3s : 2s của file
      { id: 'c', text: 'Mười một mười hai' }
    ]
    const t = await new MockTranscriber().transcribe(wav, 'vi', { expectedText: lines.map((l) => l.text).join(' ') })
    const r = alignTranscript(lines, t.words, 9)
    expect(r.lines[0].start).toBeLessThan(0.3)
    expect(Math.abs(r.lines[1].start - 3)).toBeLessThan(0.6)
    expect(Math.abs(r.lines[2].end - 9)).toBeLessThan(0.3)
    await fs.rm(dir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------- SRT
describe('SRT', () => {
  it('định dạng thời gian, bẻ 2 dòng, chia câu dài, sửa cue chồng nhau', () => {
    expect(srtTime(3725.5)).toBe('01:02:05,500')
    expect(wrapTwoLines('If the river calls your name tonight do not answer', 42)).toBe('If the river calls your\nname tonight do not answer')
    const long = 'Bà Sáu dặn cháu gái rằng đêm rằm tháng bảy tuyệt đối không được ra bến sông một mình, dù có nghe ai gọi tên mình thật tha thiết.'
    const cues = captionCues([{ text: long, start: 10, end: 20 }], 84, 42)
    expect(cues.length).toBe(2)
    expect(cues[0].start).toBe(10)
    expect(cues[cues.length - 1].end).toBe(20)
    expect(cues.every((c) => c.text.split('\n').every((l) => l.length <= 50))).toBe(true)
    const srt = buildSrt([{ start: 0, end: 3, text: 'a' }, { start: 2, end: 4, text: 'b' }])
    expect(srt).toContain('1\r\n00:00:00,000 --> 00:00:02,000\r\na')
    expect(srt).toContain('2\r\n00:00:02,000 --> 00:00:04,000\r\nb')
  })
})

// ---------------------------------------------------------------- FCPXML
/** Kiểm tra XML cân thẻ (không dùng thư viện ngoài) */
function balanced(x: string): boolean {
  const stack: string[] = []
  for (const m of x.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '').matchAll(/<(\/?)([a-zA-Z-]+)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue
    if (m[1] === '/') {
      if (stack.pop() !== m[2]) return false
    } else stack.push(m[2])
  }
  return stack.length === 0
}

describe('FCPXML', () => {
  const xml = buildFcpxml({
    name: 'Ma da & cây đa',
    fps: 30,
    width: 1080,
    height: 1920,
    totalSec: 10,
    clips: [
      { name: 'Cảnh 1', src: 'file:///D:/D%E1%BB%AF%20li%E1%BB%87u/a.png', kind: 'image', start: 0, end: 3.333 },
      { name: 'Cảnh 2 (video AI)', src: 'file:///D:/b.mp4', kind: 'video', start: 3.333, end: 5 },
      { name: 'Cảnh 3', src: 'file:///D:/D%E1%BB%AF%20li%E1%BB%87u/a.png', kind: 'image', start: 6, end: 10 }
    ],
    audio: [
      { name: 'Mix', src: 'file:///D:/mix.wav', durationSec: 10, enabled: true },
      { name: 'Giọng', src: 'file:///D:/voice.wav', durationSec: 10, enabled: false }
    ],
    markers: [{ time: 6.5, name: 'Chapter <2>' }]
  })

  it('XML cân thẻ, escape ký tự đặc biệt, asset dùng lại', () => {
    expect(balanced(xml)).toBe(true)
    expect(xml).toContain('Ma da &amp; cây đa')
    expect(xml).toContain('Chapter &lt;2&gt;')
    expect(xml.match(/<asset /g)).toHaveLength(4) // 1 ảnh dùng 2 lần + video + 2 audio
    expect(xml).toContain('<fcpxml version="1.8">')
    expect(xml).toContain('enabled="0"')
  })

  it('thời lượng theo khung hình khít tuyệt đối, có gap ở khoảng trống', () => {
    const spine = xml.slice(xml.indexOf('<spine>'), xml.indexOf('</spine>'))
    const items = [...spine.matchAll(/<(video|asset-clip|gap) (?:ref="r\d+" )?(?:name="[^"]*" )?offset="([^"]+)"(?: name="[^"]*")? duration="([^"]+)"/g)]
    const frames = (s: string): number => (s === '0s' ? 0 : Number(s.split('/')[0]))
    let cursor = 0
    for (const it of items) {
      expect(frames(it[2])).toBe(cursor)
      cursor += frames(it[3])
    }
    expect(cursor).toBe(300)
    expect(items.map((i) => i[1])).toEqual(['video', 'asset-clip', 'gap', 'video'])
    // marker nằm trong clip cảnh 3 (bắt đầu frame 180) ⇒ vị trí cục bộ 195-180 = 15
    expect(xml).toMatch(/<marker start="15\/30s"/)
  })
})

// ---------------------------------------------------------------- CapCut
function capcutTemplate(): Record<string, unknown> {
  return {
    id: 'TPL',
    duration: 5_000_000,
    fps: 30,
    canvas_config: { width: 1920, height: 1080, ratio: 'original' },
    materials: {
      videos: [{ id: 'V1', path: 'C:/mau/anh.png', type: 'photo', duration: 10_800_000_000, material_name: 'anh.png' }],
      audios: [{ id: 'A1', path: 'C:/mau/nhac.mp3', name: 'nhac.mp3', duration: 5_000_000 }],
      texts: [{ id: 'T1', content: JSON.stringify({ text: 'Chữ mẫu', styles: [{ range: [0, 7], size: 9, fill: { content: { solid: { color: [1, 1, 0] } } } }] }) }],
      speeds: [{ id: 'S1', speed: 1 }, { id: 'S2', speed: 1 }, { id: 'S3', speed: 1 }],
      material_animations: [{ id: 'AN1', animations: [{ type: 'in' }] }]
    },
    tracks: [
      { id: 'TV', type: 'video', segments: [{ id: 'G1', material_id: 'V1', extra_material_refs: ['S1'], target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 0, duration: 5_000_000 }, clip: { scale: { x: 1.2, y: 1.2 } } }] },
      { id: 'TA', type: 'audio', segments: [{ id: 'G2', material_id: 'A1', extra_material_refs: ['S2'], target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: { start: 0, duration: 5_000_000 } }] },
      { id: 'TT', type: 'text', segments: [{ id: 'G3', material_id: 'T1', extra_material_refs: ['AN1'], target_timerange: { start: 0, duration: 5_000_000 }, source_timerange: null }] }
    ]
  }
}

describe('CapCut template mode', () => {
  const tl: CapcutTimeline = {
    width: 1080,
    height: 1920,
    fps: 30,
    totalSec: 9,
    visuals: [
      { path: 'D:\\Dữ liệu\\Truyện ma\\c1.png', kind: 'image', start: 0, end: 4, name: 'Cảnh 1' },
      { path: 'D:\\Dữ liệu\\clip.mp4', kind: 'video', start: 4, end: 6, name: 'Cảnh 2' },
      { path: 'D:\\Dữ liệu\\c3.png', kind: 'image', start: 6, end: 9, name: 'Cảnh 3' }
    ],
    audio: { path: 'D:\\Dữ liệu\\mix.wav', durationSec: 9, name: 'mix.wav' },
    captions: [
      { start: 0.5, end: 2, text: 'Đừng trả lời' },
      { start: 2.2, end: 4, text: 'khi sông gọi\ntên mình' }
    ]
  }
  let n = 0
  const id = (): string => `N${++n}`

  it('draft bị mã hoá / không phải JSON ⇒ lỗi rõ ràng, không cố giải mã', () => {
    expect(() => parseCapcutDraft('\u0003\u00ffencrypted-bytes')).toThrow(CapcutTemplateError)
    expect(() => parseCapcutDraft('xYz123==')).toThrow(/mã hoá/)
    expect(() => parseCapcutDraft('{"a":')).toThrow(/hỏng/)
    expect(parseCapcutDraft('\uFEFF{"tracks":[]}')).toEqual({ tracks: [] })
  })

  it('nhân bản đoạn mẫu: đúng số đoạn, mốc micro giây, giữ style/transform, ref phụ riêng từng đoạn', () => {
    const tpl = capcutTemplate()
    const { draft, warnings } = fillCapcutTemplate(tpl, tl, id)
    const tracks = draft['tracks'] as { type: string; segments: { id: string; material_id: string; extra_material_refs: string[]; target_timerange: { start: number; duration: number }; clip?: unknown }[] }[]
    const mats = draft['materials'] as Record<string, { id: string; [k: string]: unknown }[]>
    const v = tracks.find((t) => t.type === 'video')!.segments
    expect(v).toHaveLength(3)
    expect(v.map((s) => s.target_timerange)).toEqual([{ start: 0, duration: 4_000_000 }, { start: 4_000_000, duration: 2_000_000 }, { start: 6_000_000, duration: 3_000_000 }])
    expect(v[0].clip).toEqual({ scale: { x: 1.2, y: 1.2 } })
    const vm = v.map((s) => mats['videos'].find((m) => m.id === s.material_id)!)
    expect(vm.map((m) => m['type'])).toEqual(['photo', 'video', 'photo'])
    expect(vm[0]['path']).toBe('D:/Dữ liệu/Truyện ma/c1.png')
    // mỗi đoạn có speed material riêng, không dùng chung với mẫu
    const refs = v.map((s) => s.extra_material_refs[0])
    expect(new Set(refs).size).toBe(3)
    expect(refs.every((r) => mats['speeds'].some((m) => m.id === r))).toBe(true)
    // material của đoạn mẫu cũ đã dọn
    expect(mats['videos'].some((m) => m.id === 'V1')).toBe(false)
    expect(mats['speeds'].some((m) => m.id === 'S1' || m.id === 'S2')).toBe(false)
    expect(mats['speeds'].some((m) => m.id === 'S3')).toBe(true) // không ai dùng từ đầu ⇒ giữ nguyên
    // chữ: giữ style, đổi nội dung, range theo độ dài mới
    const t = tracks.find((x) => x.type === 'text')!.segments
    expect(t).toHaveLength(2)
    const content = JSON.parse(mats['texts'].find((m) => m.id === t[1].material_id)!['content'] as string)
    expect(content.text).toBe('khi sông gọi tên mình')
    expect(content.styles[0].range).toEqual([0, content.text.length])
    expect(content.styles[0].size).toBe(9)
    expect(mats['material_animations'].filter((m) => m.id !== 'AN1')).toHaveLength(2)
    // audio + khung hình + thời lượng
    const a = tracks.find((x) => x.type === 'audio')!.segments
    expect(a).toHaveLength(1)
    expect(mats['audios'].find((m) => m.id === a[0].material_id)!['path']).toBe('D:/Dữ liệu/mix.wav')
    expect(draft['duration']).toBe(9_000_000)
    expect(draft['canvas_config']).toMatchObject({ width: 1080, height: 1920, ratio: '9:16' })
    expect(warnings.some((w) => /công bố|track khác/.test(w))).toBe(false)
    // không sửa object mẫu gốc
    expect((tpl['tracks'] as { segments: unknown[] }[])[0].segments).toHaveLength(1)
  })

  it('mẫu thiếu track hình ⇒ lỗi; thiếu audio/text ⇒ cảnh báo', () => {
    const noVideo = capcutTemplate()
    ;(noVideo['tracks'] as { type: string }[]).splice(0, 1)
    expect(() => fillCapcutTemplate(noVideo, tl, id)).toThrow(/ít nhất 1 ảnh/)
    const onlyVideo = capcutTemplate()
    onlyVideo['tracks'] = (onlyVideo['tracks'] as { type: string }[]).filter((t) => t.type === 'video')
    const r = fillCapcutTemplate(onlyVideo, tl, id)
    expect(r.warnings.join(' ')).toMatch(/không có track âm thanh/)
    expect(r.warnings.join(' ')).toMatch(/bỏ qua phụ đề/)
  })

  it('nội dung chữ dạng cũ <font>[...]</font>; cập nhật draft_meta_info', () => {
    const m: Record<string, unknown> = { content: '<font id="" path="C:/f.ttf"><size=12>[Chữ mẫu]</size></font>' }
    expect(setTextContent(m, 'Ma da [cổ]')).toBe(true)
    expect(m['content']).toBe('<font id="" path="C:/f.ttf"><size=12>[Ma da cổ]</size></font>')
    expect(setTextContent({ content: 42 }, 'x')).toBe(false)
    const meta = updateCapcutMeta({ draft_name: 'Mẫu', other: 1 }, { id: 'X', name: 'Ma da – TikTok VI', folder: 'C:\\d\\Ma da', root: 'C:\\d', durationSec: 2, nowUs: 5 })
    expect(meta).toMatchObject({ draft_id: 'X', draft_name: 'Ma da – TikTok VI', draft_fold_path: 'C:/d/Ma da', tm_duration: 2_000_000, other: 1 })
  })
})
