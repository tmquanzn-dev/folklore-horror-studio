/**
 * Lõi render Remotion: bundle composition (cache theo entryPoint) → đảm bảo có Chrome Headless Shell
 * → selectComposition → renderMedia ra MP4 (H.264 + AAC).
 * Chạy trong utility process (app) hoặc trực tiếp trong Node (smoke test).
 *
 * Bản cài đặt (GĐ6): entryPoint là THƯ MỤC bundle dựng sẵn lúc build (scripts/bundle-remotion.mjs) ⇒ không cần
 * webpack lúc chạy; binary compositor nằm trong app.asar.unpacked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'
import { COMPOSITION_ID } from '../../shared/composition'
import type { RenderProgress, RenderRequest } from './protocol'

const bundleCache = new Map<string, Promise<string>>()

/** Thư mục binary compositor của Remotion – khi đóng gói phải trỏ ra app.asar.unpacked (không chạy được exe trong asar) */
function binariesDirectory(): string | null {
  try {
    const dir = path.dirname(require.resolve('@remotion/compositor-win32-x64-msvc/package.json'))
    return dir.includes('app.asar') ? dir.replace('app.asar', 'app.asar.unpacked') : null
  } catch {
    return null
  }
}

function getBundle(entryPoint: string, onProgress: (p: RenderProgress) => void): Promise<string> {
  // Bundle dựng sẵn (bản cài đặt)
  if (fs.existsSync(path.join(entryPoint, 'index.html'))) return Promise.resolve(entryPoint)
  let cached = bundleCache.get(entryPoint)
  if (!cached) {
    // Import động: bản cài đặt không cần nạp webpack
    cached = import('@remotion/bundler').then(({ bundle }) =>
      bundle({
        entryPoint,
        onProgress: (pct: number) => onProgress({ stage: 'bundle', progress: pct / 100 })
      })
    )
    bundleCache.set(entryPoint, cached)
    cached.catch(() => bundleCache.delete(entryPoint))
  }
  return cached
}

export async function renderVideo(
  req: RenderRequest,
  onProgress: (p: RenderProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const serveUrl = await getBundle(req.entryPoint, onProgress)
  onProgress({ stage: 'bundle', progress: 1 })
  if (signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError')

  // Lần đầu: tải Chrome Headless Shell (~100MB), các lần sau dùng lại
  await ensureBrowser({
    onBrowserDownload: () => ({
      version: null,
      onProgress: ({ percent }) => onProgress({ stage: 'browser', progress: percent })
    })
  })
  onProgress({ stage: 'browser', progress: 1 })

  const inputProps = req.inputProps as unknown as Record<string, unknown>
  const bin = binariesDirectory()
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, binariesDirectory: bin })

  const { cancelSignal, cancel } = makeCancelSignal()
  const onAbort = (): void => cancel()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      outputLocation: req.outputPath,
      inputProps,
      cancelSignal,
      timeoutInMilliseconds: 120000,
      binariesDirectory: bin,
      onProgress: ({ progress }) => onProgress({ stage: 'render', progress })
    })
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
