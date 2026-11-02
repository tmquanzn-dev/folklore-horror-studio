/**
 * Toán Ken Burns (Mức 1) – hàm thuần, dùng trong composition Remotion và test được.
 * Trả về scale + dịch chuyển (% kích thước khung) tại tiến độ t (0..1) của cảnh.
 * Quy ước CSS: transform = translate(tx%, ty%) scale(s), transform-origin = origin.
 * Với pan: dịch tối đa (s-1)/2 * 100% để không lộ mép ảnh.
 */
import type { Easing, Motion } from '../types'

export function applyEasing(t: number, easing: Easing): number {
  const x = Math.min(1, Math.max(0, t))
  switch (easing) {
    case 'linear':
      return x
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
  }
}

export interface KenBurnsFrame {
  scale: number
  translateXPercent: number
  translateYPercent: number
  originXPercent: number
  originYPercent: number
}

/**
 * PARALLAX 2.5D (Mức 2): 3 lớp [hậu cảnh, chủ thể, tiền cảnh] chuyển động khác tốc độ ⇒ cảm giác máy quay 3D.
 * factor của lớp (0..1): lớp gần dịch/zoom nhiều hơn lớp xa. Hậu cảnh (lớp đặc) luôn đủ lề để không lộ mép.
 */
export function parallaxLayerAt(motion: Motion, t: number, factor: number): KenBurnsFrame {
  const e = applyEasing(t, motion.easing)
  const amp = 0.05 + 0.12 * Math.min(1, Math.max(0, motion.intensity))
  const f = Math.min(1, Math.max(0, factor))
  const fx = Math.min(1, Math.max(0, motion.focusPoint.x)) * 100
  const fy = Math.min(1, Math.max(0, motion.focusPoint.y)) * 100
  switch (motion.type) {
    case 'dollyIn':
      return { scale: 1.04 + amp * e * (0.35 + 0.65 * f), translateXPercent: 0, translateYPercent: 0, originXPercent: fx, originYPercent: fy }
    case 'dollyOut':
      return { scale: 1.04 + amp * (1 - e) * (0.35 + 0.65 * f), translateXPercent: 0, translateYPercent: 0, originXPercent: fx, originYPercent: fy }
    case 'truckLeft':
    case 'truckRight':
    default: {
      const scale = 1.08 + amp * 0.6
      const max = ((scale - 1) / 2) * 100 * 0.9
      const shift = (-max + 2 * max * e) * f
      return {
        scale,
        translateXPercent: motion.type === 'truckRight' ? -shift : shift,
        translateYPercent: 0,
        originXPercent: 50,
        originYPercent: 50
      }
    }
  }
}

export function kenBurnsAt(motion: Motion, t: number): KenBurnsFrame {
  const e = applyEasing(t, motion.easing)
  const amp = 0.06 + 0.14 * Math.min(1, Math.max(0, motion.intensity))
  const fx = Math.min(1, Math.max(0, motion.focusPoint.x)) * 100
  const fy = Math.min(1, Math.max(0, motion.focusPoint.y)) * 100
  const base = { translateXPercent: 0, translateYPercent: 0, originXPercent: fx, originYPercent: fy }

  switch (motion.type) {
    case 'zoomIn':
    case 'dollyIn':
      return { ...base, scale: 1.02 + amp * e }
    case 'zoomOut':
    case 'dollyOut':
      return { ...base, scale: 1.02 + amp * (1 - e) }
    case 'panLeft':
    case 'panRight':
    case 'panUp':
    case 'panDown':
    case 'truckLeft':
    case 'truckRight': {
      const scale = 1.06 + amp * 0.8
      const max = ((scale - 1) / 2) * 100 * 0.9
      const shift = -max + 2 * max * e // từ -max tới +max
      const frame = { scale, translateXPercent: 0, translateYPercent: 0, originXPercent: 50, originYPercent: 50 }
      // Máy quay lia sang trái ⇒ nội dung trôi sang phải
      if (motion.type === 'panLeft' || motion.type === 'truckLeft') frame.translateXPercent = shift
      if (motion.type === 'panRight' || motion.type === 'truckRight') frame.translateXPercent = -shift
      if (motion.type === 'panUp') frame.translateYPercent = shift
      if (motion.type === 'panDown') frame.translateYPercent = -shift
      return frame
    }
    case 'aiClip':
      return { ...base, scale: 1 }
  }
}
