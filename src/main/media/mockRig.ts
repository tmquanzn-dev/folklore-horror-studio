/**
 * GĐ7.1 – Rối 2D cấp A (patch rig) sinh bằng code: SVG → PNG bằng sharp, chạy offline, không tốn phí.
 * - base.png: nửa thân nhân vật (vùng mắt và miệng để trơn màu da – patch sẽ phủ lên)
 * - eyes_{open,half,closed,wide}.png, mouth_{X,A,…,H}.png: đúng kích thước vùng regions, mép mờ (feather)
 * - Bối cảnh: góc nhà gỗ tối có đèn dầu, bản 16:9 và 9:16
 * Màu da/tóc/áo suy ra từ nhân vật (tuổi, giới tính) + seed theo id ⇒ mỗi nhân vật một vẻ, tất định.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { seedOf } from '../../shared/logic/lipsync'
import type { Character, EyeState, MouthShape, Rect } from '../../shared/types'
import { MOUTH_SHAPES } from '../../shared/types'

export const RIG_CANVAS = { width: 600, height: 780 }
export const RIG_REGIONS: { eyes: Rect; mouth: Rect } = {
  eyes: { x: 196, y: 262, w: 208, h: 64 },
  mouth: { x: 246, y: 388, w: 108, h: 56 }
}

export interface RigLook {
  skin: string
  skinShade: string
  hair: string
  cloth: string
  clothDark: string
  lip: string
  iris: string
  old: boolean
  female: boolean
}

const pick = <T,>(arr: T[], n: number): T => arr[n % arr.length]

export function lookOf(c: Pick<Character, 'id' | 'age' | 'gender' | 'role'>): RigLook {
  const s = seedOf(c.id)
  const old = (c.age ?? 30) >= 55
  const female = c.gender !== 'male'
  return {
    skin: pick(['#e7bf9b', '#dcae86', '#efc9a8', '#d6a27a'], s),
    skinShade: pick(['#cf9f7c', '#c48f69', '#d8ad8b', '#bd8962'], s),
    hair: old ? pick(['#b9bcc2', '#a4a7ad', '#cfd1d4'], s >> 3) : pick(['#1d1a1a', '#2b2220', '#151313'], s >> 3),
    cloth: pick(['#4a3528', '#2f3a4a', '#4a2f36', '#38402f'], s >> 5),
    clothDark: pick(['#2e2019', '#1d2430', '#2e1d22', '#22281c'], s >> 5),
    lip: female ? '#b0605a' : '#a8705f',
    iris: '#2a1d16',
    old,
    female
  }
}

const svg = (w: number, h: number, body: string): Buffer =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, 'utf8')

/** Nền da có mép mờ cho patch (phủ khít lên vùng trơn của ảnh gốc) */
function skinPad(w: number, h: number, look: RigLook): string {
  return `<defs><filter id="f" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>
    <mask id="m"><rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="${Math.min(w, h) / 3}" fill="#fff" filter="url(#f)"/></mask></defs>
    <rect width="${w}" height="${h}" fill="${look.skin}" mask="url(#m)"/>`
}

export function baseSvg(look: RigLook): Buffer {
  const { width: W, height: H } = RIG_CANVAS
  const hair = look.old && look.female
    ? // búi tóc bạc của bà cụ
      `<ellipse cx="300" cy="118" rx="70" ry="52" fill="${look.hair}"/><path d="M170 250 Q160 140 300 128 Q440 140 430 250 Q420 190 300 182 Q180 190 170 250Z" fill="${look.hair}"/>`
    : look.female
      ? `<path d="M160 330 Q140 150 300 130 Q460 150 440 330 L452 520 Q420 430 425 300 Q410 200 300 196 Q190 200 175 300 Q180 430 148 520Z" fill="${look.hair}"/>`
      : `<path d="M172 250 Q170 140 300 132 Q430 140 428 250 Q412 196 300 190 Q188 196 172 250Z" fill="${look.hair}"/>`
  const wrinkles = look.old
    ? `<path d="M232 352 Q246 360 262 354 M338 354 Q354 360 368 352" stroke="${look.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>
       <path d="M262 230 Q300 222 338 230" stroke="${look.skinShade}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
    : ''
  return svg(
    W,
    H,
    `
    <!-- thân: áo bà ba -->
    <path d="M70 780 Q80 590 210 548 L300 600 L390 548 Q520 590 530 780Z" fill="${look.cloth}"/>
    <path d="M210 548 L300 600 L390 548 L372 540 L300 585 L228 540Z" fill="${look.clothDark}"/>
    <path d="M300 600 L300 780" stroke="${look.clothDark}" stroke-width="5"/>
    <circle cx="300" cy="640" r="7" fill="${look.clothDark}"/><circle cx="300" cy="700" r="7" fill="${look.clothDark}"/>
    <!-- cổ -->
    <path d="M258 470 L258 552 Q300 580 342 552 L342 470Z" fill="${look.skinShade}"/>
    <!-- tai -->
    <ellipse cx="168" cy="330" rx="20" ry="34" fill="${look.skinShade}"/><ellipse cx="432" cy="330" rx="20" ry="34" fill="${look.skinShade}"/>
    <!-- mặt -->
    <ellipse cx="300" cy="320" rx="134" ry="166" fill="${look.skin}"/>
    ${hair}
    <!-- lông mày (trên vùng mắt) -->
    <path d="M214 250 Q246 236 278 248" stroke="${look.old ? '#8d8f93' : '#2a201b'}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M322 248 Q354 236 386 250" stroke="${look.old ? '#8d8f93' : '#2a201b'}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <!-- mũi + má -->
    <path d="M300 330 Q290 362 284 368 Q300 378 316 368" stroke="${look.skinShade}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="220" cy="372" rx="26" ry="14" fill="#e59a8a" opacity="0.35"/><ellipse cx="380" cy="372" rx="26" ry="14" fill="#e59a8a" opacity="0.35"/>
    ${wrinkles}
  `
  )
}

export function eyesSvg(state: EyeState, look: RigLook): Buffer {
  const { w, h } = RIG_REGIONS.eyes
  const cy = h / 2
  const eye = (cx: number): string => {
    const lash = '#1f1713'
    if (state === 'closed') return `<path d="M${cx - 30} ${cy} Q${cx} ${cy + 12} ${cx + 30} ${cy}" stroke="${lash}" stroke-width="5" fill="none" stroke-linecap="round"/>`
    const ry = state === 'wide' ? 19 : state === 'half' ? 9 : 15
    const rx = state === 'wide' ? 32 : 30
    const ir = state === 'wide' ? 9 : 12
    const irisY = state === 'half' ? cy + 3 : cy
    const lidTop = state === 'half' ? `<path d="M${cx - rx - 2} ${cy} Q${cx} ${cy - 22} ${cx + rx + 2} ${cy} L${cx + rx + 2} ${cy - 26} L${cx - rx - 2} ${cy - 26}Z" fill="${look.skin}"/>` : ''
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#f6f1e8"/>
      <circle cx="${cx}" cy="${irisY}" r="${ir}" fill="${look.iris}"/><circle cx="${cx + 4}" cy="${irisY - 4}" r="3.5" fill="#fff"/>
      ${lidTop}
      <path d="M${cx - rx} ${cy - (state === 'half' ? 2 : 4)} Q${cx} ${cy - ry - (state === 'half' ? 6 : 8)} ${cx + rx} ${cy - (state === 'half' ? 2 : 4)}" stroke="${lash}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`
  }
  return svg(w, h, skinPad(w, h, look) + eye(54) + eye(w - 54))
}

/** 9 hình miệng – vẽ theo bảng chuẩn hoạt hình */
export function mouthSvg(shape: MouthShape, look: RigLook): Buffer {
  const { w, h } = RIG_REGIONS.mouth
  const cx = w / 2
  const cy = h / 2
  const lip = look.lip
  const inside = '#3b1517'
  const teeth = '#f3eee4'
  const tongue = '#c9686a'
  const open = (rx: number, ry: number, extra = ''): string =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${inside}" stroke="${lip}" stroke-width="5"/>${extra}`
  const body: Record<MouthShape, string> = {
    X: `<path d="M${cx - 26} ${cy} Q${cx} ${cy + 5} ${cx + 26} ${cy}" stroke="${lip}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    A: `<path d="M${cx - 24} ${cy} Q${cx} ${cy - 4} ${cx + 24} ${cy} Q${cx} ${cy + 7} ${cx - 24} ${cy}Z" fill="${lip}"/><path d="M${cx - 22} ${cy} L${cx + 22} ${cy}" stroke="#7a3a35" stroke-width="2.5"/>`,
    B: open(22, 6, `<rect x="${cx - 16}" y="${cy - 6}" width="32" height="5" fill="${teeth}"/>`),
    C: open(26, 11, `<rect x="${cx - 19}" y="${cy - 11}" width="38" height="6" rx="2" fill="${teeth}"/>`),
    D: open(28, 20, `<rect x="${cx - 20}" y="${cy - 20}" width="40" height="7" rx="2" fill="${teeth}"/><ellipse cx="${cx}" cy="${cy + 11}" rx="15" ry="7" fill="${tongue}"/>`),
    E: open(19, 14, `<ellipse cx="${cx}" cy="${cy + 7}" rx="10" ry="5" fill="${tongue}"/>`),
    F: `<ellipse cx="${cx}" cy="${cy}" rx="11" ry="10" fill="${inside}" stroke="${lip}" stroke-width="7"/>`,
    G: open(23, 9, `<rect x="${cx - 17}" y="${cy - 9}" width="34" height="9" rx="2" fill="${teeth}"/><path d="M${cx - 22} ${cy + 4} Q${cx} ${cy + 12} ${cx + 22} ${cy + 4}" stroke="${lip}" stroke-width="6" fill="none"/>`),
    H: open(24, 12, `<rect x="${cx - 18}" y="${cy - 12}" width="36" height="6" rx="2" fill="${teeth}"/><ellipse cx="${cx}" cy="${cy - 3}" rx="10" ry="5" fill="${tongue}"/>`)
  }
  return svg(w, h, skinPad(w, h, look) + body[shape])
}

/** Bối cảnh: góc nhà gỗ tối, đèn dầu toả sáng ấm (16:9 đèn bên trái; 9:16 đèn góc trên) */
export function stageSvg(width: number, height: number): Buffer {
  const wide = width > height
  const lx = wide ? width * 0.2 : width * 0.18
  const ly = wide ? height * 0.62 : height * 0.5
  const floor = height * 0.82
  const planks = Array.from({ length: Math.ceil(width / 90) }, (_, i) => `<rect x="${i * 90}" y="0" width="2" height="${floor}" fill="#1a110c" opacity="0.6"/>`).join('')
  return svg(
    width,
    height,
    `<defs>
      <radialGradient id="glow" cx="${lx}" cy="${ly}" r="${Math.max(width, height) * 0.55}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffb347" stop-opacity="0.55"/><stop offset="0.35" stop-color="#8a4b1c" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b130e"/><stop offset="1" stop-color="#2b1d14"/></linearGradient>
    </defs>
    <rect width="${width}" height="${floor}" fill="url(#wall)"/>${planks}
    <rect y="${floor}" width="${width}" height="${height - floor}" fill="#120c08"/>
    <rect x="${lx - width * 0.1}" y="${ly + 40}" width="${width * 0.2}" height="${floor - ly - 40}" fill="#2a1a10"/>
    <rect x="${lx - width * 0.11}" y="${ly + 30}" width="${width * 0.22}" height="14" fill="#3a2416"/>
    <ellipse cx="${lx}" cy="${ly + 26}" rx="26" ry="8" fill="#5a4a3a"/>
    <path d="M${lx - 14} ${ly + 22} Q${lx - 22} ${ly - 18} ${lx} ${ly - 46} Q${lx + 22} ${ly - 18} ${lx + 14} ${ly + 22}Z" fill="#d9c9a3" opacity="0.35"/>
    <path d="M${lx} ${ly - 4} Q${lx - 7} ${ly - 18} ${lx} ${ly - 34} Q${lx + 7} ${ly - 18} ${lx} ${ly - 4}Z" fill="#ffd27a"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>`
  )
}

async function writePng(abs: string, buf: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await sharp(buf).png().toFile(abs)
}

/** Ghi bộ ảnh rối vào dirAbs; trả về đường dẫn tương đối (so với thư mục cha của dirAbs) theo prefix */
export async function generateMockRigFiles(dirAbs: string, relPrefix: string, look: RigLook): Promise<{ base: string; eyes: Record<EyeState, string>; mouths: Record<MouthShape, string> }> {
  const rel = (f: string): string => `${relPrefix}/${f}`
  await writePng(path.join(dirAbs, 'base.png'), baseSvg(look))
  const eyes = {} as Record<EyeState, string>
  for (const st of ['open', 'half', 'closed', 'wide'] as EyeState[]) {
    await writePng(path.join(dirAbs, `eyes_${st}.png`), eyesSvg(st, look))
    eyes[st] = rel(`eyes_${st}.png`)
  }
  const mouths = {} as Record<MouthShape, string>
  for (const m of MOUTH_SHAPES) {
    await writePng(path.join(dirAbs, `mouth_${m}.png`), mouthSvg(m, look))
    mouths[m] = rel(`mouth_${m}.png`)
  }
  return { base: rel('base.png'), eyes, mouths }
}

export async function generateMockStageFiles(dirAbs: string, relPrefix: string): Promise<Record<'16:9' | '9:16', string>> {
  await writePng(path.join(dirAbs, 'bg_16x9.png'), stageSvg(1920, 1080))
  await writePng(path.join(dirAbs, 'bg_9x16.png'), stageSvg(1080, 1920))
  return { '16:9': `${relPrefix}/bg_16x9.png`, '9:16': `${relPrefix}/bg_9x16.png` }
}
