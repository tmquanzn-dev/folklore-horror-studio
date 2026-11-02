/**
 * Dựng ảnh 9:16 từ ảnh 16:9: cắt quanh focusPoint (tiền cảnh) + nền mờ phóng to (hậu cảnh).
 */
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { computeVerticalLayout } from '../../shared/logic/focusCrop'
import type { FocusPoint } from '../../shared/types'

export interface VerticalFrameOptions {
  outW: number
  outH: number
  cropAspect: number
  blur: number
  brightness: number
}

export async function buildVerticalFrame(
  srcPath: string,
  outPath: string,
  focus: FocusPoint,
  opts: VerticalFrameOptions
): Promise<{ width: number; height: number }> {
  const input = await fs.readFile(srcPath)
  const meta = await sharp(input).metadata()
  if (!meta.width || !meta.height) throw new Error(`Không đọc được kích thước ảnh: ${srcPath}`)
  const layout = computeVerticalLayout(meta.width, meta.height, focus, {
    outW: opts.outW,
    outH: opts.outH,
    cropAspect: opts.cropAspect
  })

  const background = await sharp(input)
    .extract(layout.backgroundCrop)
    .resize(opts.outW, opts.outH, { fit: 'cover' })
    .blur(Math.max(0.3, opts.blur))
    .modulate({ brightness: opts.brightness })
    .toBuffer()

  const foreground = await sharp(input)
    .extract(layout.foregroundCrop)
    .resize(layout.fgWidth, layout.fgHeight, { fit: 'cover' })
    .toBuffer()

  const out = await sharp(background)
    .composite([{ input: foreground, left: layout.fgLeft, top: layout.fgTop }])
    .png({ compressionLevel: 8 })
    .toBuffer()

  const tmp = `${outPath}.tmp`
  await fs.writeFile(tmp, out)
  await fs.rename(tmp, outPath)
  return { width: opts.outW, height: opts.outH }
}
