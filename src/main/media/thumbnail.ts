/**
 * Thumbnail YouTube (1280×720) / ảnh bìa TikTok (1080×1920): ảnh nền + lớp tối + CHỮ TO do app vẽ
 * (prompt ảnh luôn cấm chữ ⇒ chữ được ghép sau bằng SVG, đúng dấu tiếng Việt).
 */
import fs from 'node:fs/promises'
import sharp from 'sharp'

export interface ThumbOptions {
  width: number
  height: number
  text: string
  /** Dòng phụ nhỏ (vd tên truyền thuyết) */
  sub?: string
  /** Nhãn góc (vd "PHẦN 1/3") */
  badge?: string
  layout: 'youtube' | 'cover'
  accent?: string
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Ngắt dòng theo số ký tự tối đa mỗi dòng */
export function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1)
    return [...head, lines.slice(maxLines - 1).join(' ')]
  }
  return lines
}

export function thumbnailSvg(o: ThumbOptions): string {
  const { width: W, height: H } = o
  const accent = o.accent ?? '#b3122e'
  const yt = o.layout === 'youtube'
  const lines = wrapWords(o.text.toLocaleUpperCase('vi'), yt ? 14 : 11, 3)
  const longest = Math.max(...lines.map((l) => l.length), 1)
  const fs = Math.min(yt ? H * 0.2 : W * 0.15, (yt ? W * 0.6 : W * 0.88) / (longest * 0.62))
  const x = yt ? W * 0.05 : W / 2
  const anchor = yt ? 'start' : 'middle'
  const blockH = lines.length * fs * 1.05
  const y0 = yt ? (H - blockH) / 2 + fs * 0.85 : H * 0.62 - blockH / 2 + fs * 0.85
  const text = lines
    .map(
      (l, i) =>
        `<text x="${x.toFixed(0)}" y="${(y0 + i * fs * 1.05).toFixed(0)}" text-anchor="${anchor}" font-family="Segoe UI Black, Segoe UI, Arial, sans-serif" font-weight="900" font-size="${fs.toFixed(0)}" fill="${i === lines.length - 1 ? '#ffd23f' : '#ffffff'}" stroke="#000" stroke-width="${(fs * 0.09).toFixed(1)}" paint-order="stroke" letter-spacing="-1">${xml(l)}</text>`
    )
    .join('')
  const sub = o.sub
    ? `<text x="${x.toFixed(0)}" y="${(y0 + lines.length * fs * 1.05 + fs * 0.15).toFixed(0)}" text-anchor="${anchor}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${(fs * 0.32).toFixed(0)}" fill="#f3c77a" stroke="#000" stroke-width="3" paint-order="stroke">${xml(o.sub)}</text>`
    : ''
  const badge = o.badge
    ? `<rect x="${W * 0.04}" y="${H * 0.04}" rx="12" width="${(o.badge.length * W * (yt ? 0.022 : 0.04) + W * 0.04).toFixed(0)}" height="${(yt ? H * 0.11 : W * 0.11).toFixed(0)}" fill="${accent}"/><text x="${(W * 0.06).toFixed(0)}" y="${(H * 0.04 + (yt ? H * 0.08 : W * 0.08)).toFixed(0)}" font-family="Segoe UI Black, Arial" font-weight="900" font-size="${(yt ? H * 0.07 : W * 0.07).toFixed(0)}" fill="#fff">${xml(o.badge)}</text>`
    : ''
  const shade = yt
    ? `<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.82"/><stop offset="0.55" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
    : `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.15"/><stop offset="0.45" stop-color="#000" stop-opacity="0.35"/><stop offset="0.8" stop-color="#000" stop-opacity="0.75"/></linearGradient>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${shade}</defs><rect width="${W}" height="${H}" fill="url(#g)"/><rect x="0" y="${H - (yt ? 10 : 16)}" width="${W}" height="${yt ? 10 : 16}" fill="${accent}"/>${badge}${text}${sub}</svg>`
}

export async function composeThumbnail(srcAbs: string, outAbs: string, o: ThumbOptions, focus = { x: 0.5, y: 0.5 }): Promise<void> {
  const base = await sharp(await fs.readFile(srcAbs))
    .resize(o.width, o.height, { fit: 'cover', position: focus.x < 0.4 ? 'west' : focus.x > 0.6 ? 'east' : 'centre' })
    .modulate({ brightness: 1.08, saturation: 1.15 })
    .toBuffer()
  const out = await sharp(base).composite([{ input: Buffer.from(thumbnailSvg(o), 'utf8') }]).png().toBuffer()
  await fs.writeFile(`${outAbs}.tmp`, out)
  await fs.rename(`${outAbs}.tmp`, outAbs)
}
