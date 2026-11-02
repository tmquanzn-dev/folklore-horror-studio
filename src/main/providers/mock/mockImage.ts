/**
 * MockImageProvider: tạo ảnh placeholder bằng sharp (SVG → PNG).
 * Ảnh có số cảnh, shotType, góc máy, tóm tắt prompt và dấu focusPoint –
 * đủ "chi tiết" để thấy rõ chuyển động Ken Burns và cắt dọc.
 */
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { providersConfig } from '../../../shared/config'
import type { ImageAspect } from '../../../shared/types'
import type { ImageProvider, ImageRequest, ImageResult } from '../interfaces'

const SIZES: Record<ImageAspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1440, h: 1440 }
}

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      lines.push(cur.trim())
      cur = w
      if (lines.length === maxLines) break
    } else cur = `${cur} ${w}`
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim())
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + ' …'
  }
  return lines
}

/** Số giả ngẫu nhiên ổn định theo seed (cùng cảnh ⇒ cùng bố cục) */
function rng(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

export class MockImageProvider implements ImageProvider {
  readonly id = 'mock'
  readonly displayName = providersConfig.image.mock.displayName
  readonly model = providersConfig.image.mock.model

  estimateCost(): number {
    return 0
  }

  buildSvg(req: ImageRequest): { svg: string; w: number; h: number } {
    const { w, h } = SIZES[req.aspect]
    const p = req.placeholder
    const pal = p?.palette.length ? p.palette : ['#0b0f14', '#1b2a2f', '#3d2b1f', '#8a6a3a', '#a61b29']
    const rand = rng((req.seed ?? 7) * 7919 + 13)
    const unit = Math.min(w, h)

    // Hậu cảnh: trăng, đường chân trời, hàng cây bóng tối, sóng nước
    const moonX = w * (0.15 + rand() * 0.7)
    const moonY = h * (0.12 + rand() * 0.2)
    const horizon = h * (0.5 + rand() * 0.15)
    let trees = ''
    for (let i = 0; i < 9; i++) {
      const x = (w / 9) * i + rand() * (w / 12)
      const th = unit * (0.12 + rand() * 0.22)
      trees += `<path d="M${x.toFixed(0)},${horizon.toFixed(0)} l${(unit * 0.05).toFixed(0)},-${th.toFixed(0)} l${(unit * 0.05).toFixed(0)},${th.toFixed(0)} z" fill="#05070a" opacity="0.9"/>`
    }
    let waves = ''
    for (let i = 0; i < 14; i++) {
      const y = horizon + ((h - horizon) / 14) * (i + 0.5)
      const x = rand() * w * 0.8
      waves += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + w * (0.1 + rand() * 0.2)).toFixed(0)}" y2="${y.toFixed(0)}" stroke="${pal[3]}" stroke-opacity="${(0.08 + rand() * 0.15).toFixed(2)}" stroke-width="${(unit * 0.004).toFixed(1)}"/>`
    }
    // Lưới mờ để nhìn rõ chuyển động
    let grid = ''
    for (let i = 1; i < 12; i++) {
      grid += `<line x1="${((w / 12) * i).toFixed(0)}" y1="0" x2="${((w / 12) * i).toFixed(0)}" y2="${h}" stroke="#ffffff" stroke-opacity="0.035"/>`
    }
    for (let i = 1; i < 8; i++) {
      grid += `<line x1="0" y1="${((h / 8) * i).toFixed(0)}" x2="${w}" y2="${((h / 8) * i).toFixed(0)}" stroke="#ffffff" stroke-opacity="0.035"/>`
    }

    const fx = (p?.focusPoint.x ?? 0.5) * w
    const fy = (p?.focusPoint.y ?? 0.5) * h
    const title = p?.title ?? (p ? `CẢNH ${String(p.index).padStart(2, '0')}` : 'PLACEHOLDER')
    const meta = p ? `${p.shotType} · ${p.cameraAngle}` : req.aspect
    const castText = p?.castLabel ? `Nhân vật: ${p.castLabel}` : ''
    const fs1 = unit * 0.085
    const fs2 = unit * 0.035
    const fs3 = unit * 0.03
    const summary = wrap(p?.summary ?? req.prompt, req.aspect === '9:16' ? 30 : 58, 4)
    const textX = w * 0.09
    const textY = h * 0.86 - summary.length * fs3 * 1.35

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal[1]}"/>
      <stop offset="0.55" stop-color="${pal[0]}"/>
      <stop offset="1" stop-color="#020305"/>
    </linearGradient>
    <radialGradient id="moon" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f6e7c1" stop-opacity="0.95"/>
      <stop offset="0.5" stop-color="#d9c08a" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#d9c08a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${pal[4]}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${pal[4]}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  ${grid}
  <circle cx="${moonX.toFixed(0)}" cy="${moonY.toFixed(0)}" r="${(unit * 0.16).toFixed(0)}" fill="url(#moon)"/>
  <rect x="0" y="${horizon.toFixed(0)}" width="${w}" height="${(h - horizon).toFixed(0)}" fill="#04060a" opacity="0.75"/>
  ${trees}
  ${waves}
  <circle cx="${fx.toFixed(0)}" cy="${fy.toFixed(0)}" r="${(unit * 0.18).toFixed(0)}" fill="url(#glow)"/>
  <circle cx="${fx.toFixed(0)}" cy="${fy.toFixed(0)}" r="${(unit * 0.035).toFixed(0)}" fill="none" stroke="#f3c77a" stroke-width="${(unit * 0.004).toFixed(1)}"/>
  <line x1="${(fx - unit * 0.06).toFixed(0)}" y1="${fy.toFixed(0)}" x2="${(fx + unit * 0.06).toFixed(0)}" y2="${fy.toFixed(0)}" stroke="#f3c77a" stroke-width="2"/>
  <line x1="${fx.toFixed(0)}" y1="${(fy - unit * 0.06).toFixed(0)}" x2="${fx.toFixed(0)}" y2="${(fy + unit * 0.06).toFixed(0)}" stroke="#f3c77a" stroke-width="2"/>
  <text x="${textX.toFixed(0)}" y="${(h * 0.1 + fs1).toFixed(0)}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs1.toFixed(0)}" font-weight="800" fill="#f4f1ea" fill-opacity="0.92">${xml(title)}</text>
  <text x="${textX.toFixed(0)}" y="${(h * 0.1 + fs1 + fs2 * 1.5).toFixed(0)}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs2.toFixed(0)}" fill="#f3c77a">${xml(meta)}</text>
  ${castText ? `<text x="${textX.toFixed(0)}" y="${(h * 0.1 + fs1 + fs2 * 3.1).toFixed(0)}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs2.toFixed(0)}" font-weight="700" fill="#8fd3c8">${xml(castText.length > (req.aspect === '9:16' ? 40 : 75) ? castText.slice(0, req.aspect === '9:16' ? 39 : 74) + '…' : castText)}</text>` : ''}
  ${summary
    .map(
      (l, i) =>
        `<text x="${textX.toFixed(0)}" y="${(textY + i * fs3 * 1.35).toFixed(0)}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs3.toFixed(0)}" fill="#d6d3cb" fill-opacity="0.9">${xml(l)}</text>`
    )
    .join('\n  ')}
  <text x="${(w - unit * 0.04).toFixed(0)}" y="${(unit * 0.07).toFixed(0)}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="${(fs3 * 0.8).toFixed(0)}" fill="#ffffff" fill-opacity="0.45">PLACEHOLDER · ${req.aspect}</text>
</svg>`
    return { svg, w, h }
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const { svg, w, h } = this.buildSvg(req)
    // Ghi qua Buffer (fs) thay vì để sharp tự mở đường dẫn ⇒ an toàn với đường dẫn Unicode trên Windows
    const png = await sharp(Buffer.from(svg, 'utf8')).png({ compressionLevel: 8 }).toBuffer()
    const tmp = `${req.outputPath}.tmp`
    await fs.writeFile(tmp, png)
    await fs.rename(tmp, req.outputPath)
    return { path: req.outputPath, width: w, height: h, cost: 0, provider: this.id, model: this.model }
  }
}
