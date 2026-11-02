/** Toán tách lớp parallax (hàm thuần, có test) */

export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length
  if (n === 0) return 0
  // Lấy mẫu tối đa ~20k điểm cho nhanh với ảnh lớn
  const step = Math.max(1, Math.floor(n / 20000))
  const sample: number[] = []
  for (let i = 0; i < n; i += step) sample.push(values[i])
  sample.sort((a, b) => a - b)
  const k = Math.min(sample.length - 1, Math.max(0, Math.round(p * (sample.length - 1))))
  return sample[k]
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Chuẩn hoá depth về 0..1 (1 = gần) */
export function normalizeDepth(raw: Float32Array, higherIsNearer: boolean): Float32Array {
  let min = Infinity
  let max = -Infinity
  for (const v of raw) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    const v = (raw[i] - min) / range
    out[i] = higherIsNearer ? v : 1 - v
  }
  return out
}

/** Depth ước lượng khi chưa có model: phía dưới khung gần hơn + vùng quanh focusPoint nổi lên */
export function heuristicDepth(w: number, h: number, focus: { x: number; y: number }): Float32Array {
  const out = new Float32Array(w * h)
  const sx = 0.22
  const sy = 0.3
  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const blob = Math.exp(-(((nx - focus.x) / sx) ** 2 + ((ny - focus.y) / sy) ** 2))
      out[y * w + x] = Math.min(1, 0.5 * ny + 0.6 * blob)
    }
  }
  return out
}
