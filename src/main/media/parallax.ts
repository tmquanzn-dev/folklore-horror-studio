/**
 * Tách ảnh thành 3 lớp theo depth: [hậu cảnh (đặc), chủ thể (alpha), tiền cảnh (alpha)].
 * Hậu cảnh: vùng phía sau chủ thể được lấp bằng bản làm mờ để khi lớp trước dịch chuyển không lộ "bóng ma" sắc nét.
 */
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { platformsConfig } from '../../shared/config'
import { percentile, smoothstep } from '../../shared/logic/parallaxMath'
import type { DepthEstimator } from './depth'

export interface ParallaxFiles {
  depth: string
  layers: [string, string, string]
}

async function writeAtomic(file: string, buf: Buffer): Promise<void> {
  await fs.writeFile(`${file}.tmp`, buf)
  await fs.rename(`${file}.tmp`, file)
}

export async function buildParallaxLayers(
  srcAbs: string,
  out: ParallaxFiles,
  estimator: DepthEstimator,
  focus: { x: number; y: number }
): Promise<{ source: 'model' | 'heuristic'; width: number; height: number }> {
  const cfg = platformsConfig.parallax
  const input = await fs.readFile(srcAbs)
  const base = sharp(input).removeAlpha().resize(cfg.maxDimension, cfg.maxDimension, { fit: 'inside', withoutEnlargement: true })
  const { data: rgb, info } = await base.raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const png = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
  const d = await estimator.estimate(png, w, h, focus)

  const tMid = percentile(d.depth, cfg.midPercentile)
  const tNear = percentile(d.depth, cfg.nearPercentile)
  const soft = cfg.edgeSoftness
  const midMask = Buffer.alloc(w * h)
  const nearMask = Buffer.alloc(w * h)
  const depthGray = Buffer.alloc(w * h)
  for (let i = 0; i < w * h; i++) {
    const v = d.depth[i]
    // Chỉ lấy vùng gần HƠN ngưỡng ⇒ ảnh có depth phẳng (một màu, sương mù dày) không bị tách nhầm
    midMask[i] = Math.round(smoothstep(tMid, tMid + 2 * soft, v) * 255)
    nearMask[i] = Math.round(smoothstep(tNear, tNear + 2 * soft, v) * 255)
    depthGray[i] = Math.round(v * 255)
  }
  // Làm mềm mép mặt nạ
  // extractChannel(0): sharp mặc định xuất 3 kênh dù đầu vào 1 kênh
  const blurMask = (m: Buffer): Promise<Buffer> => sharp(m, { raw: { width: w, height: h, channels: 1 } }).blur(2.5).extractChannel(0).raw().toBuffer()
  const [mid, near] = await Promise.all([blurMask(midMask), blurMask(nearMask)])
  const blurred = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).blur(28).raw().toBuffer()

  const far = Buffer.alloc(w * h * 3)
  const midRgba = Buffer.alloc(w * h * 4)
  const nearRgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = mid[i] / 255
    for (let c = 0; c < 3; c++) {
      const o = rgb[i * 3 + c]
      far[i * 3 + c] = Math.round(o * (1 - a) + blurred[i * 3 + c] * a)
      midRgba[i * 4 + c] = o
      nearRgba[i * 4 + c] = o
    }
    midRgba[i * 4 + 3] = mid[i]
    nearRgba[i * 4 + 3] = near[i]
  }
  const raw3 = { raw: { width: w, height: h, channels: 3 as const } }
  const raw4 = { raw: { width: w, height: h, channels: 4 as const } }
  await Promise.all([
    sharp(far, raw3).png().toBuffer().then((b) => writeAtomic(out.layers[0], b)),
    sharp(midRgba, raw4).png().toBuffer().then((b) => writeAtomic(out.layers[1], b)),
    sharp(nearRgba, raw4).png().toBuffer().then((b) => writeAtomic(out.layers[2], b)),
    sharp(depthGray, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer().then((b) => writeAtomic(out.depth, b))
  ])
  return { source: d.source, width: w, height: h }
}
