/**
 * Lõi render Remotion: bundle composition (cache theo entryPoint) → đảm bảo có Chrome Headless Shell
 * → selectComposition → renderMedia ra MP4 (H.264 + AAC).
 * Chạy trong utility process (app) hoặc trực tiếp trong Node (smoke test).
 */
import { bundle } from '@remotion/bundler'
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'
import { COMPOSITION_ID } from '../../shared/composition'
import type { RenderProgress, RenderRequest } from './protocol'

const bundleCache = new Map<string, Promise<string>>()

function getBundle(entryPoint: string, onProgress: (p: RenderProgress) => void): Promise<string> {
  let cached = bundleCache.get(entryPoint)
  if (!cached) {
    cached = bundle({
      entryPoint,
      onProgress: (pct: number) => onProgress({ stage: 'bundle', progress: pct / 100 })
    })
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
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps })

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
      onProgress: ({ progress }) => onProgress({ stage: 'render', progress })
    })
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
