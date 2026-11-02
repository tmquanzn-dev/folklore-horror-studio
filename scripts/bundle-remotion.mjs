/**
 * Dựng sẵn bundle Remotion (composition FolkloreVideo) cho bản cài đặt:
 * app đã cài không chạy webpack lúc render – renderCore dùng thẳng thư mục này (resources/remotion-bundle).
 * Chạy: node scripts/bundle-remotion.mjs  (npm run dist tự gọi)
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { bundle } from '@remotion/bundler'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'out', 'remotion-bundle')
await fs.rm(outDir, { recursive: true, force: true })
let last = -1
const dir = await bundle({
  entryPoint: path.join(root, 'src', 'remotion', 'index.ts'),
  outDir,
  onProgress: (p) => {
    if (p - last >= 25 || p === 100) {
      last = p
      console.log(`Bundle Remotion ${p}%`)
    }
  }
})
console.log(`Đã dựng bundle Remotion: ${dir}`)
