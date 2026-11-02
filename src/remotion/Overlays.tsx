import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { GlossaryCard } from '../shared/composition'

/** Viền tối quanh khung – tạo không khí u ám */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.8) 100%)'
    }}
  />
)

/** Thẻ chú thích thuật ngữ tiếng Việt lần đầu xuất hiện (bản tiếng Anh) */
export const GlossaryCards: React.FC<{ cards: GlossaryCard[] }> = ({ cards }) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const time = frame / fps
  const card = cards.find((c) => time >= c.start && time < c.end)
  if (!card) return null
  const opacity = interpolate(time, [card.start, card.start + 0.4, card.end - 0.5, card.end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const base = width * 0.012
  return (
    <div
      style={{
        position: 'absolute',
        top: base * 4,
        left: base * 4,
        maxWidth: width * 0.34,
        opacity,
        background: 'rgba(8,10,16,0.72)',
        borderLeft: `${Math.max(2, base * 0.35)}px solid #b3122e`,
        padding: `${base * 1.1}px ${base * 1.6}px`,
        borderRadius: base * 0.5,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        color: '#f4f1ea'
      }}
    >
      <div style={{ fontSize: base * 2.1, fontStyle: 'italic', fontWeight: 700, color: '#f3c77a' }}>{card.term}</div>
      <div style={{ fontSize: base * 1.45, marginTop: base * 0.3, lineHeight: 1.35 }}>{card.gloss}</div>
    </div>
  )
}

/** Shorts teaser: câu móc chữ lớn ở đầu */
export const HookCard: React.FC<{ text: string; untilSec: number }> = ({ text, untilSec }) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const t = frame / fps
  if (t > untilSec) return null
  const opacity = interpolate(t, [0, 0.25, untilSec - 0.4, untilSec], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div
      style={{
        position: 'absolute',
        top: '14%',
        left: '6%',
        right: '6%',
        opacity,
        textAlign: 'center',
        fontFamily: '"Segoe UI Black", "Segoe UI", Arial, sans-serif',
        fontWeight: 900,
        fontSize: width * 0.075,
        lineHeight: 1.15,
        color: '#fff',
        textShadow: '0 0 12px #000, 4px 4px 0 #000, -2px -2px 0 #000',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.35), transparent)'
      }}
    >
      {text}
    </div>
  )
}

/** Shorts teaser: thẻ kết kêu gọi xem bản đầy đủ */
export const EndCard: React.FC<{ title: string; sub: string; fromSec: number }> = ({ title, sub, fromSec }) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const t = frame / fps
  if (t < fromSec) return null
  const o = interpolate(t, [fromSec, fromSec + 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: `rgba(5,6,10,${0.78 * o})`, alignItems: 'center', justifyContent: 'center', opacity: o }}>
      <div style={{ textAlign: 'center', padding: '0 8%', fontFamily: '"Segoe UI", Arial, sans-serif' }}>
        <div style={{ fontSize: width * 0.085, fontWeight: 900, color: '#f4f1ea', lineHeight: 1.1 }}>{title}</div>
        <div style={{ marginTop: width * 0.04, fontSize: width * 0.045, color: '#f3c77a', fontWeight: 700 }}>{sub}</div>
        <div style={{ margin: `${width * 0.05}px auto 0`, width: width * 0.2, height: width * 0.012, background: '#b3122e', borderRadius: 4 }} />
      </div>
    </AbsoluteFill>
  )
}

/** Nhãn "Phần X/N" cho TikTok/Shorts */
export const PartBadge: React.FC<{ label: string }> = ({ label }) => {
  const { width } = useVideoConfig()
  const base = width * 0.03
  return (
    <div
      style={{
        position: 'absolute',
        top: base * 4.2,
        left: base * 1.2,
        fontFamily: '"Segoe UI Black", "Segoe UI", Arial, sans-serif',
        fontWeight: 900,
        fontSize: base * 1.3,
        color: '#fff',
        background: 'rgba(179,18,46,0.9)',
        padding: `${base * 0.25}px ${base * 0.6}px`,
        borderRadius: base * 0.3,
        letterSpacing: 1
      }}
    >
      {label}
    </div>
  )
}
