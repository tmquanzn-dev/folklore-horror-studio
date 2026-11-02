/**
 * GĐ7.1 – Cảnh rối 2D: bối cảnh + nhân vật chớp mắt, khớp môi, thở/lắc nhẹ; camera đẩy chậm; ánh đèn dầu chập chờn.
 * TẤT ĐỊNH: mọi chuyển động tính từ useCurrentFrame() + dữ liệu tính sẵn trong props (không Math.random / Date.now)
 * ⇒ Remotion Player xem trước và bản render khớp nhau.
 * Mọi ảnh mắt / miệng được vẽ sẵn chồng lên nhau, chỉ đổi opacity ⇒ không nháy khi đổi hình (ảnh đã nạp từ đầu).
 */
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CompositionPuppet, CompositionPuppetActor } from '../shared/composition'
import { blinkStateAt, mouthAt } from '../shared/logic/lipsync'
import { MOUTH_SHAPES, type EyeState } from '../shared/types'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const EYE_STATES: EyeState[] = ['open', 'half', 'closed', 'wide']

const PuppetLayer: React.FC<{ actor: CompositionPuppetActor; heightPx: number }> = ({ actor, heightPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const s = heightPx / actor.canvas.height
  const w = actor.canvas.width * s
  const mouth = mouthAt(actor.mouthCues, t)
  const eye: EyeState = blinkStateAt(actor.blinks, frame) ?? actor.expression.eyes
  // Thở (co giãn dọc quanh đáy) + lắc nhẹ; nghiêng đầu theo biểu cảm
  const breath = 1 + actor.idle.breathAmp * Math.sin((2 * Math.PI * t) / 3.6 + actor.phase)
  const sway = actor.idle.swayDeg * Math.sin((2 * Math.PI * t) / 5.3 + actor.phase * 1.3) + (actor.expression.headTiltDeg ?? 0)
  const region = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    position: 'absolute',
    left: r.x * s,
    top: r.y * s,
    width: r.w * s,
    height: r.h * s
  })
  return (
    <div
      style={{
        position: 'relative',
        width: w,
        height: heightPx,
        transformOrigin: '50% 100%',
        transform: `${actor.flipX ? 'scaleX(-1) ' : ''}rotate(${sway.toFixed(3)}deg) scaleY(${breath.toFixed(4)})`
      }}
    >
      <Img src={actor.base} style={{ position: 'absolute', left: 0, top: 0, width: w, height: heightPx }} />
      {EYE_STATES.map((st) => (
        <Img key={st} src={actor.eyes[st]} style={{ ...region(actor.regions.eyes), opacity: st === eye ? 1 : 0 }} />
      ))}
      {MOUTH_SHAPES.map((m) => (
        <Img key={m} src={actor.mouths[m]} style={{ ...region(actor.regions.mouth), opacity: m === mouth ? 1 : 0 }} />
      ))}
    </div>
  )
}

export const PuppetScene: React.FC<{ puppet: CompositionPuppet; durationInFrames: number }> = ({ puppet, durationInFrames }) => {
  const frame = useCurrentFrame()
  const { width, height, fps } = useVideoConfig()
  const vertical = height > width
  const p = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1)
  const zoom = puppet.camera === 'pushIn' ? interpolate(p, [0, 1], [1, 1.06], clamp) : 1
  const enterF = Math.round(0.5 * fps)
  const enterY = puppet.enter === 'slideUp' ? interpolate(frame, [0, enterF], [height * 0.06, 0], clamp) : 0
  const enterO = puppet.enter === 'none' ? 1 : interpolate(frame, [0, enterF], [0, 1], clamp)
  // Đèn dầu chập chờn: tổng 2 sóng sin lệch pha (tất định)
  const flicker = puppet.lighting === 'lamp' ? 0.82 + 0.1 * Math.sin(frame * 0.53) + 0.06 * Math.sin(frame * 1.37 + 1.1) : 1
  // Nhân vật đứng trên đường sàn; khung dọc: cận hơn (nhân vật cao hơn so với khung)
  const heightPx = height * (vertical ? 0.5 : 0.78)
  const floor = height * puppet.floorY
  const xOf = (pos: CompositionPuppetActor['position']): number => (pos === 'left' ? 0.3 : pos === 'right' ? 0.7 : vertical ? 0.5 : 0.56) * width

  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0806', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: '50% 60%' }}>
        {puppet.stageSrc ? <Img src={puppet.stageSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        {puppet.actors.map((a, i) => {
          const h = heightPx * a.scale
          return (
            <div
              key={`${a.characterId}-${i}`}
              style={{
                position: 'absolute',
                left: xOf(a.position),
                top: floor - h + enterY,
                transform: 'translateX(-50%)',
                opacity: enterO
              }}
            >
              <PuppetLayer actor={a} heightPx={h} />
            </div>
          )
        })}
      </AbsoluteFill>
      {/* Ánh sáng theo bối cảnh: tối viền + ánh đèn ấm */}
      <AbsoluteFill
        style={{
          background:
            puppet.lighting === 'lamp'
              ? `radial-gradient(ellipse at ${vertical ? '30% 45%' : '25% 60%'}, rgba(255,170,80,${(0.16 * flicker).toFixed(3)}) 0%, rgba(0,0,0,0) 45%), radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 45%, rgba(0,0,0,${(0.62 / flicker).toFixed(3)}) 100%)`
              : puppet.lighting === 'moon'
                ? 'radial-gradient(ellipse at 70% 20%, rgba(150,180,255,0.12) 0%, rgba(0,0,0,0) 50%), radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.65) 100%)'
                : 'radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.5) 100%)'
        }}
      />
    </AbsoluteFill>
  )
}
