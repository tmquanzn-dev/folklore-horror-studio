/**
 * Cắt khung theo focusPoint – dùng dựng bản 9:16 từ ảnh 16:9:
 *   tiền cảnh = vùng cắt (tỷ lệ cropAspect, vd 4:5) quanh focusPoint, phóng vừa chiều ngang khung dọc
 *   hậu cảnh = vùng cắt 9:16 quanh focusPoint, phóng to + làm mờ + tối đi
 */
import type { FocusPoint } from '../types'

export interface CropRect {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** Vùng cắt lớn nhất có tỷ lệ targetAspect (rộng/cao), tâm gần focusPoint nhất, không vượt ảnh. */
export function computeFocusCrop(
  srcW: number,
  srcH: number,
  focus: FocusPoint,
  targetAspect: number
): CropRect {
  if (srcW <= 0 || srcH <= 0 || targetAspect <= 0) throw new Error('Kích thước ảnh/tỷ lệ không hợp lệ')
  let width: number
  let height: number
  if (srcW / srcH > targetAspect) {
    height = srcH
    width = Math.round(srcH * targetAspect)
  } else {
    width = srcW
    height = Math.round(srcW / targetAspect)
  }
  width = Math.min(width, srcW)
  height = Math.min(height, srcH)
  const fx = clamp(focus.x, 0, 1)
  const fy = clamp(focus.y, 0, 1)
  const left = clamp(Math.round(fx * srcW - width / 2), 0, srcW - width)
  const top = clamp(Math.round(fy * srcH - height / 2), 0, srcH - height)
  return { left, top, width, height }
}

export interface VerticalLayout {
  foregroundCrop: CropRect
  backgroundCrop: CropRect
  fgWidth: number
  fgHeight: number
  fgLeft: number
  fgTop: number
}

export function computeVerticalLayout(
  srcW: number,
  srcH: number,
  focus: FocusPoint,
  opts: { outW: number; outH: number; cropAspect: number }
): VerticalLayout {
  const foregroundCrop = computeFocusCrop(srcW, srcH, focus, opts.cropAspect)
  const backgroundCrop = computeFocusCrop(srcW, srcH, focus, opts.outW / opts.outH)
  const fgWidth = opts.outW
  const fgHeight = Math.min(opts.outH, Math.round((opts.outW * foregroundCrop.height) / foregroundCrop.width))
  return {
    foregroundCrop,
    backgroundCrop,
    fgWidth,
    fgHeight,
    fgLeft: 0,
    fgTop: Math.round((opts.outH - fgHeight) / 2)
  }
}
