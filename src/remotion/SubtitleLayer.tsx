import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { SubtitleCue, SubtitleStyle } from '../shared/types'

/**
 * Phụ đề theo preset:
 * - youtube: chữ vừa, nền mờ, thuật ngữ tiếng Việt in nghiêng có màu.
 * - tiktok: chữ to, viền đen, highlight từng từ đang đọc, nằm trong vùng an toàn.
 */
export const SubtitleLayer: React.FC<{ cues: SubtitleCue[]; style: SubtitleStyle }> = ({ cues, style }) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const time = frame / fps
  const cue = cues.find((c) => time >= c.start && time < c.end + 0.15)
  if (!cue) return null

  const fontSize = Math.round(width * style.fontSizeRatio)
  const stroke = Math.max(1, Math.round(width * style.strokeWidthRatio))
  const shadow = style.backgroundColor
    ? `0 ${stroke}px ${stroke * 3}px rgba(0,0,0,0.8)`
    : [
        `${stroke}px ${stroke}px 0 ${style.strokeColor}`,
        `-${stroke}px ${stroke}px 0 ${style.strokeColor}`,
        `${stroke}px -${stroke}px 0 ${style.strokeColor}`,
        `-${stroke}px -${stroke}px 0 ${style.strokeColor}`,
        `0 ${stroke * 2}px ${stroke * 4}px rgba(0,0,0,0.85)`
      ].join(', ')

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: `${style.horizontalCenter * 100}%`,
          top: `${style.verticalPosition * 100}%`,
          transform: 'translate(-50%, -50%)',
          width: width * style.maxWidthRatio,
          display: 'flex',
          justifyContent: 'center'
        }}
      >
        <div
          style={{
            fontFamily: style.fontFamily,
            fontSize,
            fontWeight: style.fontWeight,
            lineHeight: 1.25,
            color: style.color,
            textAlign: 'center',
            textShadow: shadow,
            textTransform: style.uppercase ? 'uppercase' : 'none',
            backgroundColor: style.backgroundColor ?? 'transparent',
            padding: style.backgroundColor ? `${fontSize * 0.18}px ${fontSize * 0.5}px` : 0,
            borderRadius: fontSize * 0.2,
            maxHeight: height * 0.3
          }}
        >
          {cue.words.map((w, i) => {
            const active = style.wordHighlight && time >= w.start && time < w.end
            const italic = style.italicGlossary && w.emphasis
            return (
              <span
                key={i}
                style={{
                  color: active ? style.highlightColor : w.emphasis ? style.emphasisColor : style.color,
                  fontStyle: italic ? 'italic' : 'normal',
                  display: 'inline-block',
                  transform: active ? 'scale(1.08)' : 'none',
                  marginRight: '0.28em'
                }}
              >
                {w.text}
              </span>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}
