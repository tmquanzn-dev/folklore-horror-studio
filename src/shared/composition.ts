/**
 * Props của composition Remotion "FolkloreVideo" và hàm dựng props từ Story + Release.
 * Dùng chung: renderer (Remotion Player xem trước) và main (render MP4) ⇒ xem trước = kết quả render.
 * Cùng một composition render được 16:9 và 9:16 (chỉ đổi width/height + nguồn ảnh).
 */
import type {
  AspectRatio,
  FocusPoint,
  Motion,
  PronunciationEntry,
  Release,
  Story,
  SubtitleCue,
  SubtitleStyle,
  Transition
} from './types'

export const COMPOSITION_ID = 'FolkloreVideo'

export type CompositionScene = {
  id: string
  index: number
  src: string | null
  /** Mức 2: 3 lớp [hậu cảnh, chủ thể, tiền cảnh] */
  layers: string[] | null
  /** Mức 3: clip video AI (phát trước, hết clip thì chuyển sang ảnh tĩnh có Ken Burns) */
  clip: { src: string; durationSec: number } | null
  startSec: number
  endSec: number
  motion: Motion
  transition: Transition
  isHero: boolean
  label: string
}

export type GlossaryCard = {
  start: number
  end: number
  term: string
  gloss: string
}

/** Dùng `type` (không dùng interface) để thoả ràng buộc Record<string, unknown> của Remotion */
export type CompositionProps = {
  fps: number
  width: number
  height: number
  durationSec: number
  aspect: AspectRatio
  voiceSrc: string | null
  scenes: CompositionScene[]
  subtitles: SubtitleCue[]
  subtitleStyle: SubtitleStyle | null
  glossaryCards: GlossaryCard[]
  partLabel: string | null
  /** Hệ số chuyển động từng lớp parallax (xa → gần) */
  parallaxFactors: [number, number, number]
  /** Shorts teaser: câu móc hiện ở đầu */
  hookCard?: { text: string; untilSec: number } | null
  /** Shorts teaser: thẻ kêu gọi xem bản dài ở cuối */
  endCard?: { title: string; sub: string; fromSec: number } | null
}

/** Cắt một khoảng của Release (Shorts teaser) */
export interface CompositionWindow {
  start: number
  end: number
  /** Audio đã cắt sẵn cho khoảng này (tương đối thư mục Story) */
  voiceRelPath: string
  hookText: string
  ctaTitle: string
  ctaSub: string
  hookCardSec: number
  endCardSec: number
}

export const DEFAULT_COMPOSITION_PROPS: CompositionProps = {
  parallaxFactors: [0.2, 0.55, 1],
  fps: 30,
  width: 1920,
  height: 1080,
  durationSec: 3,
  aspect: '16:9',
  voiceSrc: null,
  scenes: [],
  subtitles: [],
  subtitleStyle: null,
  glossaryCards: [],
  partLabel: null
}

export interface BuildCompositionArgs {
  story: Story
  release: Release
  glossary: PronunciationEntry[]
  subtitleStyle: SubtitleStyle | null
  /** (đường dẫn tương đối trong Story, phiên bản) → URL */
  mediaUrl: (relPath: string, version?: string) => string
  fps: number
  sizes: Record<AspectRatio, { width: number; height: number }>
  /** Khung muốn xem/render; mặc định = khung của Release */
  aspect?: AspectRatio
  /** Hệ số render (0.5 = bản nháp) */
  scale?: number
  parallaxFactors?: [number, number, number]
  window?: CompositionWindow
}

/** Cắt props theo khoảng [start, end] rồi dời về 0; cảnh cuối kéo dài phủ thẻ kết */
export function applyWindow(p: CompositionProps, w: CompositionWindow, voiceSrc: string): CompositionProps {
  const len = w.end - w.start
  const total = len + w.endCardSec
  const scenes = p.scenes
    .filter((s) => s.endSec > w.start + 0.05 && s.startSec < w.end - 0.05)
    .map((s) => ({ ...s, startSec: Math.max(0, s.startSec - w.start), endSec: Math.min(len, s.endSec - w.start) }))
  if (scenes.length) {
    scenes[0] = { ...scenes[0], startSec: 0, transition: { type: 'dipToBlack', durationSec: 0.4 } }
    scenes[scenes.length - 1] = { ...scenes[scenes.length - 1], endSec: total }
  }
  const shift = (t: number): number => Math.round((t - w.start) * 1000) / 1000
  const subtitles = p.subtitles
    .filter((c) => c.end > w.start && c.start < w.end)
    .map((c) => ({ ...c, start: Math.max(0, shift(c.start)), end: Math.min(len, shift(c.end)), words: c.words.map((x) => ({ ...x, start: shift(x.start), end: shift(x.end) })) }))
  return {
    ...p,
    durationSec: total,
    voiceSrc,
    scenes,
    subtitles,
    glossaryCards: p.glossaryCards.filter((g) => g.start >= w.start && g.start < w.end).map((g) => ({ ...g, start: shift(g.start), end: shift(g.end) })),
    partLabel: null,
    hookCard: w.hookText ? { text: w.hookText, untilSec: w.hookCardSec } : null,
    endCard: { title: w.ctaTitle, sub: w.ctaSub, fromSec: len }
  }
}

/** Chuyển động Mức 2/3 khi thiếu lớp / clip ⇒ quay về Ken Burns tương đương */
function fallbackMotion(m: Motion): Motion {
  const map: Record<string, Motion['type']> = { dollyIn: 'zoomIn', dollyOut: 'zoomOut', truckLeft: 'panLeft', truckRight: 'panRight', aiClip: 'zoomIn' }
  return { ...m, level: 'kenBurns', type: map[m.type] ?? m.type }
}

const CENTER: FocusPoint = { x: 0.5, y: 0.5 }

export function buildCompositionProps(args: BuildCompositionArgs): CompositionProps {
  const { story, release } = args
  const aspect = args.aspect ?? release.aspectRatio
  const size = args.sizes[aspect]
  const bankById = new Map(story.sceneBank.map((s) => [s.id, s]))

  const scenes: CompositionScene[] = release.scenes.map((rs, index) => {
    const bank = bankById.get(rs.sceneBankId)
    let media = rs.mediaOverride
    let motion: Motion = rs.motion
    if (!media && bank) {
      if (aspect === '9:16' && bank.media['9:16']) {
        media = bank.media['9:16']
        // Ảnh dọc đã được dựng quanh focusPoint ⇒ tâm zoom ở giữa khung
        motion = { ...rs.motion, focusPoint: CENTER }
      } else {
        media = bank.media['16:9'] ?? bank.media['9:16']
      }
    }
    let layers: string[] | null = null
    let clip: CompositionScene['clip'] = null
    if (motion.level === 'parallax') {
      const p = bank?.parallax?.[aspect]
      if (p && media && p.sourcePath === media.path) layers = p.layers.map((l) => args.mediaUrl(l, p.createdAt))
      else motion = fallbackMotion(motion)
    } else if (motion.level === 'aiVideo') {
      const c = bank?.heroClip[aspect]
      if (c) clip = { src: args.mediaUrl(c.path, c.createdAt), durationSec: c.durationSec ?? 5 }
      else motion = fallbackMotion(motion)
    }
    return {
      id: rs.id,
      index,
      src: media ? args.mediaUrl(media.path, media.createdAt) : null,
      layers,
      clip,
      startSec: rs.start,
      endSec: rs.end,
      motion,
      transition: rs.transition,
      isHero: rs.isHero,
      label: bank ? `${bank.shotType} · ${bank.description}` : rs.sceneBankId
    }
  })

  // Thẻ chú thích thuật ngữ: chỉ bản không phải tiếng Việt, lần đầu xuất hiện
  const glossaryCards: GlossaryCard[] = []
  if (release.language !== 'vi') {
    const seen = new Set<string>()
    for (const cue of release.subtitles) {
      for (const id of cue.glossaryTermIds) {
        if (seen.has(id)) continue
        const entry = args.glossary.find((g) => g.id === id)
        if (!entry?.glossEn) continue
        seen.add(id)
        glossaryCards.push({ start: cue.start, end: cue.start + 4.5, term: entry.term, gloss: entry.glossEn })
      }
    }
  }

  const lastSceneEnd = scenes.length ? scenes[scenes.length - 1].endSec : 0
  const durationSec = Math.max(1, release.voiceTrack?.duration ?? lastSceneEnd)
  const voice = release.voiceTrack?.mixedPath ?? null
  const isVerticalPlatform = release.platform === 'tiktok' || release.platform === 'youtubeShorts'

  const props: CompositionProps = {
    fps: args.fps,
    width: Math.round(size.width * (args.scale ?? 1)),
    height: Math.round(size.height * (args.scale ?? 1)),
    durationSec,
    aspect,
    voiceSrc: voice ? args.mediaUrl(voice, release.voiceTrack?.mixedAt ?? String(release.voiceTrack?.duration ?? '')) : null,
    scenes,
    subtitles: release.subtitles,
    subtitleStyle: args.subtitleStyle,
    glossaryCards,
    partLabel: isVerticalPlatform && release.partCount >= 1 ? `Phần ${release.partIndex}/${release.partCount}` : null,
    parallaxFactors: args.parallaxFactors ?? [0.2, 0.55, 1],
    hookCard: null,
    endCard: null
  }
  return args.window ? applyWindow(props, args.window, args.mediaUrl(args.window.voiceRelPath, String(args.window.start))) : props
}
