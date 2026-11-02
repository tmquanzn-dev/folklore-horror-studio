/**
 * VideoProvider: Google Veo (image-to-video) qua @google/genai – dùng chung API key Gemini.
 * generateVideos (thao tác dài) → hỏi trạng thái định kỳ → tải file video về.
 * Lưu ý: huỷ phía app KHÔNG huỷ được thao tác phía Google (vẫn có thể bị tính phí) ⇒ app luôn báo giá và chờ xác nhận trước.
 */
import fs from 'node:fs/promises'
import { GoogleGenAI } from '@google/genai'
import sharp from 'sharp'
import { providersConfig, type VideoProviderConfig } from '../../../shared/config'
import { probeDuration } from '../../media/ffmpeg'
import { sleep } from '../http'
import type { VideoProvider, VideoRequest, VideoResult } from '../interfaces'

interface VeoOperation {
  done?: boolean
  error?: { message?: string; code?: number }
  response?: { generatedVideos?: { video?: unknown }[]; raiMediaFilteredReasons?: string[] }
}
export interface VeoClientLike {
  models: { generateVideos(p: Record<string, unknown>): Promise<VeoOperation> }
  operations: { getVideosOperation(p: { operation: VeoOperation }): Promise<VeoOperation> }
  files: { download(p: { file: unknown; downloadPath: string }): Promise<void> }
}

export class VeoVideoProvider implements VideoProvider {
  readonly id = 'veo'
  readonly displayName: string
  readonly model: string

  constructor(
    private readonly getKey: () => string | null,
    private readonly clientFactory: (apiKey: string) => VeoClientLike = (apiKey) => new GoogleGenAI({ apiKey }) as unknown as VeoClientLike,
    private readonly cfg: VideoProviderConfig = providersConfig.video.veo
  ) {
    this.displayName = cfg.displayName
    this.model = cfg.model
  }

  get clipSeconds(): number {
    return this.cfg.clipSeconds
  }

  estimateCost(durationSec: number): number {
    return durationSec * this.cfg.pricePerSecond
  }

  async imageToVideo(req: VideoRequest): Promise<VideoResult> {
    const key = this.getKey()
    if (!key) throw new Error('Chưa có API key Google (Gemini/Veo). Cách xử lý: nhập key ở Cài đặt hoặc dùng Mock.')
    const client = this.clientFactory(key)
    const img = await sharp(await fs.readFile(req.imagePath)).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    const config: Record<string, unknown> = {
      aspectRatio: req.aspect,
      numberOfVideos: 1,
      durationSeconds: req.durationSec,
      negativePrompt: 'gore, blood, wounds, text, watermark, sudden cuts, distorted faces'
    }
    if (this.cfg.resolution) config['resolution'] = this.cfg.resolution
    if (this.cfg.generateAudio !== undefined) config['generateAudio'] = this.cfg.generateAudio

    let op = await client.models.generateVideos({
      model: this.model,
      prompt: req.prompt,
      image: { imageBytes: img.toString('base64'), mimeType: 'image/png' },
      config
    })
    const deadline = Date.now() + (this.cfg.timeoutMs ?? 600000)
    while (!op.done) {
      if (Date.now() > deadline) throw new Error('Veo quá thời gian chờ – thử lại sau')
      await sleep(this.cfg.pollIntervalMs ?? 10000, req.signal)
      op = await client.operations.getVideosOperation({ operation: op })
    }
    if (op.error) throw Object.assign(new Error(`Veo lỗi: ${op.error.message ?? 'không rõ'}`), { status: op.error.code })
    const video = op.response?.generatedVideos?.[0]?.video
    if (!video) {
      const why = op.response?.raiMediaFilteredReasons?.join('; ') ?? 'không có video trả về'
      throw new Error(`Veo không tạo được video (${why}). Cách xử lý: sửa mô tả cảnh hoặc bỏ cảnh khỏi danh sách hero.`)
    }
    const tmp = `${req.outputPath}.tmp.mp4`
    await client.files.download({ file: video, downloadPath: tmp })
    await fs.rename(tmp, req.outputPath)
    const duration = await probeDuration(req.outputPath).catch(() => req.durationSec)
    return { path: req.outputPath, duration, cost: this.estimateCost(req.durationSec), provider: this.id, model: this.model }
  }
}
