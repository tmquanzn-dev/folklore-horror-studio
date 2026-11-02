/** Sinh icon app 512×512 (build/icon.png) bằng sharp – electron-builder tự chuyển sang .ico */
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b3122e"/><stop offset="1" stop-color="#2a1a4a"/></linearGradient></defs>
  <rect width="512" height="512" rx="108" fill="url(#g)"/>
  <circle cx="370" cy="150" r="58" fill="#f3e3b0" opacity="0.9"/>
  <path d="M60 430 L150 250 L200 330 L262 200 L340 360 L380 300 L452 430 Z" fill="#0b0d14" opacity="0.85"/>
  <text x="256" y="300" text-anchor="middle" font-family="Segoe UI Black, Arial Black, sans-serif" font-size="190" font-weight="900" fill="#ffffff">ma</text>
</svg>`
await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'build', 'icon.png'))
console.log('build/icon.png')
