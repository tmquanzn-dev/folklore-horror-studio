/**
 * Props của composition Remotion "FolkloreVideo" và hàm dựng props từ Story + Release.
 * Dùng chung: renderer (Remotion Player xem trước) và main (render MP4) ⇒ xem trước = kết quả render.
 * Cùng một composition render được 16:9 và 9:16 (chỉ đổi width/height + nguồn ảnh).
 */
import { puppetConfig } from './config'
import { blinkStarts, mouthAt } from './logic/lipsync'
import type {
  AspectRatio,
  EyeState,
  FocusPoint,
  Library,
  Motion,
  MouthCue,
  MouthShape,
  PronunciationEntry,
  PuppetExpression,
  Rect,
  Release,
  Story,
  SubtitleCue,
  SubtitleStyle,
  Transition
} from './types'

export const COMPOSITION_ID = 'FolkloreVideo'

/** GĐ7: một nhân vật rối trong cảnh – mọi thứ đã tính sẵn (tất định) để Player và render vẽ giống hệt nhau */
export type CompositionPuppetActor = {
  characterId: string
  position: 'left' | 'center' | 'right'
  scale: number
  flipX: boolean
  canvas: { width: number; height: number }
  base: string
  regions: { eyes: Rect; mouth: Rect }
  eyes: Record<EyeState, string>
  mouths: Record<MouthShape, string>
  idle: { breathAmp: number; swayDeg: number }
  expression: PuppetExpression
  /** Khung bắt đầu mỗi lần chớp mắt (tính từ đầu cảnh) */
  blinks: number[]
  /** Hình miệng, mốc tính từ ĐẦU CẢNH (giây) */
  mouthCues: MouthCue[]
  /** Pha thở/lắc riêng mỗi actor */
  phase: number
}

export type CompositionPuppet = {
  stageSrc: string | null
  floorY: number
  lighting: 'lamp' | 'moon' | 'neutral'
  camera: 'static' | 'pushIn' | 'cutToSpeaker'
  enter: 'none' | 'fade' | 'slideUp'
  actors: CompositionPuppetActor[]
}

export type CompositionScene = {
  id: string
  index: number
  src: string | null
  /** GĐ7: cảnh rối (nhân vật chớp mắt, khớp môi trên bối cảnh) – null = cảnh minh hoạ thường */
  puppet?: CompositionPuppet | null
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
  /** GĐ7: rối + bối cảnh (thư viện) và URL file dùng chung (_characters). Thiếu ⇒ cảnh rối hiện như ảnh minh hoạ */
  puppetLib?: Pick<Library, 'puppetRigs' | 'puppetStages'>
  sharedUrl?: (relPath: string, version?: string) => string
}

/** Cảnh rối bị cắt mất phần đầu (cửa sổ teaser) ⇒ dời mốc miệng/chớp mắt tương ứng */
function shiftPuppet(p: CompositionPuppet | null | undefined, dt: number, fps: number): CompositionPuppet | null | undefined {
  if (!p || dt <= 0) return p
  const df = Math.round(dt * fps)
  return {
    ...p,
    actors: p.actors.map((a) => ({
      ...a,
      blinks: a.blinks.map((f) => f - df).filter((f) => f >= 0),
      mouthCues: a.mouthCues.filter((c) => c.end > dt).map((c) => ({ ...c, start: Math.max(0, c.start - dt), end: c.end - dt }))
    }))
  }
}

/** Cắt props theo khoảng [start, end] rồi dời về 0; cảnh cuối kéo dài phủ thẻ kết */
export function applyWindow(p: CompositionProps, w: CompositionWindow, voiceSrc: string): CompositionProps {
  const len = w.end - w.start
  const total = len + w.endCardSec
  const scenes = p.scenes
    .filter((s) => s.endSec > w.start + 0.05 && s.startSec < w.end - 0.05)
    .map((s) => ({ ...s, puppet: shiftPuppet(s.puppet, w.start - s.startSec, p.fps), startSec: Math.max(0, s.startSec - w.start), endSec: Math.min(len, s.endSec - w.start) }))
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

/** Dựng dữ liệu cảnh rối: rối + bối cảnh + hình miệng các câu của actor trong cảnh + lịch chớp mắt */
function buildPuppet(rs: Release['scenes'][number], args: BuildCompositionArgs, aspect: AspectRatio): CompositionPuppet | null {
  const spec = rs.puppet
  const lib = args.puppetLib
  const url = args.sharedUrl
  if (!spec || !lib || !url) return null
  const stage = lib.puppetStages.find((s) => s.id === spec.stageId)
  const fps = args.fps
  const frames = Math.max(1, Math.round((rs.end - rs.start) * fps))
  const actors: CompositionPuppetActor[] = []
  spec.actors.forEach((a, k) => {
    const rig = lib.puppetRigs.find((r) => r.id === a.rigId)
    if (!rig) return
    const v = rig.createdAt
    const lines = args.release.script.lines.filter((l) => l.speakerId === a.characterId && l.start != null && l.end != null && (l.end as number) > rs.start && (l.start as number) < rs.end)
    const mouthCues = lines
      .flatMap((l) => l.mouthCues ?? [])
      .filter((c) => c.end > rs.start && c.start < rs.end)
      .map((c) => ({ shape: c.shape, start: Math.max(0, Math.round((c.start - rs.start) * 1000) / 1000), end: Math.round((Math.min(c.end, rs.end) - rs.start) * 1000) / 1000 }))
      .sort((x, y) => x.start - y.start)
    // Biểu cảm theo delivery của câu đầu tiên actor nói trong cảnh
    const tag = lines[0]?.delivery.tags.find((t) => puppetConfig.deliveryExpression[t])
    const exprName = tag ? puppetConfig.deliveryExpression[tag] : a.defaultExpression
    const expression = rig.expressions[exprName] ?? puppetConfig.defaultExpressions[exprName] ?? { eyes: 'open' }
    const blinks = blinkStarts(`${rig.id}:${rs.id}`, frames, fps, rig.idle.blinkMinSec, rig.idle.blinkMaxSec, expression.blinkRate ?? 1, (f) => mouthAt(mouthCues, f / fps) === 'D')
    const mouths = {} as Record<MouthShape, string>
    for (const [m, p] of Object.entries(rig.mouthSet)) mouths[m as MouthShape] = url(p, v)
    actors.push({
      characterId: a.characterId,
      position: a.position,
      scale: a.scale,
      flipX: a.flipX,
      canvas: rig.canvas,
      base: url(rig.basePath, v),
      regions: rig.regions,
      eyes: { open: url(rig.eyeSet.open, v), half: url(rig.eyeSet.half, v), closed: url(rig.eyeSet.closed, v), wide: url(rig.eyeSet.wide ?? rig.eyeSet.open, v) },
      mouths,
      idle: { breathAmp: rig.idle.breathAmp, swayDeg: rig.idle.swayDeg },
      expression,
      blinks,
      mouthCues,
      phase: (k * 1.7 + rs.start) % 6.28
    })
  })
  if (!actors.length) return null
  return {
    stageSrc: stage ? url(stage.backgroundPath[aspect], stage.id) : null,
    floorY: stage?.floorY ?? 0.82,
    lighting: stage?.lighting ?? 'lamp',
    camera: spec.camera,
    enter: spec.enter,
    actors
  }
}

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
    const puppet = rs.kind === 'puppet' ? buildPuppet(rs, args, aspect) : null
    return {
      id: rs.id,
      index,
      puppet,
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
