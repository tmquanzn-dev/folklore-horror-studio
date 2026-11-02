/**
 * Định dạng xuất cho phần mềm dựng (hàm thuần – có unit test):
 *  - SRT: phụ đề đọc được (≤ 2 dòng × 42 ký tự) để tải lên YouTube / nhập vào NLE; bản EN kèm SRT tiếng Việt.
 *  - FCPXML 1.8: timeline ảnh/clip theo cảnh + bản mix + giọng riêng (tắt sẵn) + marker chapter.
 *    Mở được trong Final Cut Pro và DaVinci Resolve (File → Import → Timeline). Premiere không đọc FCPXML gốc.
 * Chuyển động Ken Burns / parallax / phụ đề cháy chữ KHÔNG xuất được sang NLE – chỉ có ảnh tĩnh đúng thời lượng.
 */
import { realTimings, wordTimings } from './subtitles'

// ============================================================================ SRT

export interface TimedText {
  start: number
  end: number
  text: string
}

export interface CaptionLine {
  text: string
  start: number
  end: number
  /** Mốc thật từng từ (tự thu) – không có thì ước lượng theo độ dài từ */
  words?: { word: string; start: number; end: number }[] | null
}

export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

/** Bẻ thành tối đa 2 dòng, chỗ ngắt gần giữa nhất */
export function wrapTwoLines(text: string, maxLine: number): string {
  if (text.length <= maxLine) return text
  const words = text.split(' ')
  let best = -1
  let bestScore = Infinity
  let len = 0
  for (let i = 0; i < words.length - 1; i++) {
    len += words[i].length + (i ? 1 : 0)
    const score = Math.abs(len - (text.length - len - 1))
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  if (best < 0) return text
  return `${words.slice(0, best + 1).join(' ')}\n${words.slice(best + 1).join(' ')}`
}

/** Câu dài ⇒ chia cụm ≤ maxChars theo ranh giới từ, mốc theo từ */
export function captionCues(lines: CaptionLine[], maxChars = 84, maxLine = 42): TimedText[] {
  const out: TimedText[] = []
  for (const l of lines) {
    const words = l.text.split(/\s+/).filter(Boolean)
    if (!words.length || l.end <= l.start) continue
    // Mốc thật (tự thu) – token chỉ có dấu câu dính vào từ trước; không có thì ước lượng theo độ dài từ
    const t = l.words?.length ? realTimings(words, l.words, l.start, l.end) : wordTimings(words, l.start, l.end)
    let a = 0
    while (a < words.length) {
      let b = a + 1
      let len = words[a].length
      while (b < words.length && len + 1 + words[b].length <= maxChars) {
        len += 1 + words[b].length
        b++
      }
      // Tránh để 1 từ lẻ trơ trọi ở cụm cuối
      if (b === words.length - 1 && b - a > 2) b--
      out.push({ start: t[a].start, end: b === words.length ? l.end : t[b - 1].end, text: wrapTwoLines(words.slice(a, b).join(' '), maxLine) })
      a = b
    }
  }
  return out
}

/** Bản dịch (vd tiếng Việt của bản EN): chia thời lượng câu theo tỉ lệ ký tự của từng cụm */
export function translationCues(lines: { translation: string; start: number; end: number }[], maxChars = 84, maxLine = 42): TimedText[] {
  return captionCues(lines.map((l) => ({ text: l.translation, start: l.start, end: l.end })), maxChars, maxLine)
}

export function buildSrt(cues: TimedText[]): string {
  // Cue chồng nhau ⇒ cắt cue trước (một số trình phát không hiện 2 cue cùng lúc)
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  return (
    sorted
      .map((c, i) => {
        const next = sorted[i + 1]
        const end = next && next.start < c.end ? next.start : c.end
        return `${i + 1}\r\n${srtTime(c.start)} --> ${srtTime(Math.max(c.start + 0.05, end))}\r\n${c.text.replace(/\n/g, '\r\n')}\r\n`
      })
      .join('\r\n') + '\r\n'
  )
}

// ============================================================================ FCPXML

export interface FcpClip {
  name: string
  /** file:/// URL đã mã hoá (người gọi dùng pathToFileURL) */
  src: string
  kind: 'image' | 'video'
  start: number
  end: number
}

export interface FcpAudio {
  name: string
  src: string
  durationSec: number
  enabled: boolean
}

export interface FcpTimeline {
  name: string
  fps: number
  width: number
  height: number
  totalSec: number
  clips: FcpClip[]
  audio: FcpAudio[]
  markers: { time: number; name: string }[]
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Thời gian hữu tỉ theo khung hình: "N/30s" */
export function fcpTime(frames: number, fps: number): string {
  return frames === 0 ? '0s' : `${frames}/${fps}s`
}

export function buildFcpxml(t: FcpTimeline): string {
  const fps = Math.round(t.fps)
  const f = (sec: number): number => Math.max(0, Math.round(sec * fps))
  const total = f(t.totalSec)
  // Ranh giới khung hình tính từ mốc tuyệt đối ⇒ tổng thời lượng các clip khớp tuyệt đối với timeline
  const clips = t.clips
    .map((c) => ({ ...c, a: f(c.start), b: Math.min(total, f(c.end)) }))
    .filter((c) => c.b > c.a)
    .sort((x, y) => x.a - y.a)

  const assets = new Map<string, { id: string; name: string; kind: 'image' | 'video' | 'audio'; dur: number }>()
  let rid = 2
  const assetFor = (src: string, name: string, kind: 'image' | 'video' | 'audio', dur: number): string => {
    const prev = assets.get(src)
    if (prev) {
      prev.dur = Math.max(prev.dur, dur)
      return prev.id
    }
    const id = `r${rid++}`
    assets.set(src, { id, name, kind, dur })
    return id
  }

  // Spine: lấp khoảng trống bằng <gap>
  const spine: string[] = []
  let cursor = 0
  const markersFor = (a: number, b: number, localStart: number): string =>
    t.markers
      .map((m) => ({ ...m, fr: f(m.time) }))
      .filter((m) => m.fr >= a && m.fr < b)
      .map((m) => `<marker start="${fcpTime(localStart + m.fr - a, fps)}" duration="${fcpTime(1, fps)}" value="${xml(m.name)}"/>`)
      .join('')
  const audioLanes = (): string =>
    t.audio
      .map((au, i) => {
        const id = assetFor(au.src, au.name, 'audio', f(au.durationSec))
        return `<asset-clip ref="${id}" lane="${-(i + 1)}" offset="0s" name="${xml(au.name)}" duration="${fcpTime(Math.min(total, f(au.durationSec)), fps)}"${au.enabled ? '' : ' enabled="0"'} audioRole="dialogue"/>`
      })
      .join('')
  let first = true
  const push = (open: string, close: string, a: number, b: number, localStart: number): void => {
    const extra = (first ? audioLanes() : '') + markersFor(a, b, localStart)
    first = false
    spine.push(extra ? `${open}>${extra}</${close}>` : `${open}/>`)
  }
  for (const c of clips) {
    if (c.a > cursor) {
      push(`<gap name="Gap" offset="${fcpTime(cursor, fps)}" duration="${fcpTime(c.a - cursor, fps)}" start="0s"`, 'gap', cursor, c.a, 0)
      cursor = c.a
    }
    const a = Math.max(c.a, cursor)
    const dur = c.b - a
    if (dur <= 0) continue
    if (c.kind === 'image') {
      const id = assetFor(c.src, c.name, 'image', 0)
      push(`<video ref="${id}" offset="${fcpTime(a, fps)}" name="${xml(c.name)}" duration="${fcpTime(dur, fps)}" start="0s"`, 'video', a, c.b, 0)
    } else {
      const id = assetFor(c.src, c.name, 'video', dur)
      push(`<asset-clip ref="${id}" offset="${fcpTime(a, fps)}" name="${xml(c.name)}" duration="${fcpTime(dur, fps)}" start="0s"`, 'asset-clip', a, c.b, 0)
    }
    cursor = c.b
  }
  if (cursor < total) push(`<gap name="Gap" offset="${fcpTime(cursor, fps)}" duration="${fcpTime(total - cursor, fps)}" start="0s"`, 'gap', cursor, total, 0)

  const resources = [
    `<format id="r1" name="FFVideoFormatCustom" frameDuration="${fcpTime(1, fps)}" width="${t.width}" height="${t.height}"/>`,
    ...[...assets.entries()].map(([src, a]) =>
      a.kind === 'image'
        ? `<asset id="${a.id}" name="${xml(a.name)}" src="${xml(src)}" start="0s" duration="0s" hasVideo="1" format="r1"/>`
        : a.kind === 'video'
          ? `<asset id="${a.id}" name="${xml(a.name)}" src="${xml(src)}" start="0s" duration="${fcpTime(a.dur, fps)}" hasVideo="1" format="r1"/>`
          : `<asset id="${a.id}" name="${xml(a.name)}" src="${xml(src)}" start="0s" duration="${fcpTime(a.dur, fps)}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"/>`
    )
  ]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.8">',
    `  <resources>\n    ${resources.join('\n    ')}\n  </resources>`,
    '  <library>',
    `    <event name="${xml(t.name)}">`,
    `      <project name="${xml(t.name)}">`,
    `        <sequence format="r1" duration="${fcpTime(total, fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>\n            ${spine.join('\n            ')}\n          </spine>`,
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    ''
  ].join('\n')
}
