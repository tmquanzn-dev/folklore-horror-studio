import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CompositionScene } from '../shared/composition'
import { kenBurnsAt, parallaxLayerAt, type KenBurnsFrame } from '../shared/logic/kenBurns'
import { PuppetScene } from './PuppetScene'

const clampOpts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

function transformOf(kb: KenBurnsFrame): React.CSSProperties {
  return {
    transform: `translate(${kb.translateXPercent}%, ${kb.translateYPercent}%) scale(${kb.scale})`,
    transformOrigin: `${kb.originXPercent}% ${kb.originYPercent}%`
  }
}

const cover = (scene: CompositionScene): React.CSSProperties => ({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: `${scene.motion.focusPoint.x * 100}% ${scene.motion.focusPoint.y * 100}%`
})

/** Ảnh tĩnh + Ken Burns (Mức 1) hoặc 3 lớp parallax (Mức 2) */
const Still: React.FC<{ scene: CompositionScene; t: number; factors: [number, number, number] }> = ({ scene, t, factors }) => {
  const { width } = useVideoConfig()
  if (scene.layers && scene.layers.length === 3) {
    return (
      <>
        {scene.layers.map((src, i) => (
          <AbsoluteFill key={i} style={transformOf(parallaxLayerAt(scene.motion, t, factors[i]))}>
            <Img src={src} style={cover(scene)} />
          </AbsoluteFill>
        ))}
      </>
    )
  }
  const motion = scene.motion.level === 'kenBurns' ? scene.motion : { ...scene.motion, type: 'zoomIn' as const }
  return (
    <AbsoluteFill style={transformOf(kenBurnsAt(motion, t))}>
      {scene.src ? (
        <Img src={scene.src} style={cover(scene)} />
      ) : (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b7280',
            fontSize: width * 0.02,
            fontFamily: 'Segoe UI, Arial, sans-serif',
            background: 'linear-gradient(160deg, #0f172a, #1e1b2e)'
          }}
        >
          Thiếu ảnh – {scene.label}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

/** Một cảnh: Mức 1/2/3 + hiệu ứng vào cảnh (fade / dip-to-black / flash) */
export const SceneLayer: React.FC<{ scene: CompositionScene; durationInFrames: number; parallaxFactors: [number, number, number] }> = ({
  scene,
  durationInFrames,
  parallaxFactors
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1)
  const tf = Math.max(1, Math.round(scene.transition.durationSec * fps))

  const opacity = scene.transition.type === 'fade' ? interpolate(frame, [0, tf], [0, 1], clampOpts) : 1
  const blackOverlay = scene.transition.type === 'dipToBlack' ? interpolate(frame, [0, tf], [1, 0], clampOpts) : 0
  const flashOverlay = scene.transition.type === 'flash' ? interpolate(frame, [0, tf], [0.85, 0], clampOpts) : 0

  // Mức 3: clip video AI phát trước; cảnh dài hơn clip ⇒ chuyển mềm sang ảnh tĩnh (Ken Burns) cho phần còn lại
  const clipFrames = scene.clip ? Math.min(durationInFrames, Math.max(1, Math.floor(scene.clip.durationSec * fps) - 2)) : 0
  const xf = Math.min(12, Math.floor(clipFrames / 3))
  const stillOpacity = scene.clip ? interpolate(frame, [clipFrames - xf, clipFrames], [0, 1], clampOpts) : 1

  return (
    <AbsoluteFill style={{ opacity, overflow: 'hidden', backgroundColor: '#05060a' }}>
      {scene.clip ? (
        <Sequence durationInFrames={clipFrames} layout="none">
          <AbsoluteFill>
            <OffthreadVideo src={scene.clip.src} muted style={cover(scene)} />
          </AbsoluteFill>
        </Sequence>
      ) : null}
      {scene.puppet ? (
        <PuppetScene puppet={scene.puppet} durationInFrames={durationInFrames} />
      ) : stillOpacity > 0 ? (
        <AbsoluteFill style={{ opacity: stillOpacity }}>
          <Still scene={scene} t={t} factors={parallaxFactors} />
        </AbsoluteFill>
      ) : null}
      {blackOverlay > 0 ? <AbsoluteFill style={{ backgroundColor: '#000', opacity: blackOverlay }} /> : null}
      {flashOverlay > 0 ? <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flashOverlay }} /> : null}
    </AbsoluteFill>
  )
}
