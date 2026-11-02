/**
 * ImageProvider: Google Gemini image ("Nano Banana") qua @google/genai.
 * - Ảnh tham chiếu nhân vật (đã khoá) gửi kèm dạng inlineData ⇒ giữ đồng nhất khuôn mặt/trang phục.
 * - Tỉ lệ khung qua config.imageConfig.aspectRatio (16:9, 9:16, 1:1…).
 * - Gemini không có negative prompt ⇒ prompt đã chứa "Avoid: …" (xem shared/logic/imagePrompt.ts).
 */
import fs from 'node:fs/promises'
import { GoogleGenAI } from '@google/genai'
import sharp from 'sharp'
import { providersConfig, type ImageProviderConfig } from '../../../shared/config'
import type { ImageProvider, ImageRequest, ImageResult } from '../interfaces'

interface Part {
  text?: string
  inlineData?: { data?: string; mimeType?: string }
}
interface GenerateResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}
/** Phần tối thiểu của SDK mà adapter dùng (để test bằng client giả) */
export interface GenAiClientLike {
  models: { generateContent(req: Record<string, unknown>): Promise<GenerateResponse> }
}

export class GeminiImageProvider implements ImageProvider {
  readonly id = 'gemini'
  readonly displayName: string
  readonly model: string

  constructor(
    private readonly getKey: () => string | null,
    private readonly clientFactory: (apiKey: string) => GenAiClientLike = (apiKey) => new GoogleGenAI({ apiKey }) as unknown as GenAiClientLike,
    private readonly cfg: ImageProviderConfig = providersConfig.image.gemini,
    model?: string
  ) {
    this.displayName = cfg.displayName
    this.model = model ?? cfg.model
  }

  estimateCost(count: number): number {
    return count * this.cfg.pricePerImage
  }

  /** Thu nhỏ ảnh tham chiếu (cạnh dài 1024) ⇒ gửi nhanh, rẻ token */
  private async loadReference(file: string): Promise<string> {
    const buf = await sharp(await fs.readFile(file)).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    return buf.toString('base64')
  }

  buildRequest(req: ImageRequest, refs: string[], signal: AbortSignal): Record<string, unknown> {
    const refNote = refs.length
      ? `\nThe attached ${refs.length} reference image(s) show the locked characters/states: keep their faces, hair and outfits identical. Do not copy the reference backgrounds.`
      : ''
    return {
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: req.prompt + refNote }, ...refs.map((data) => ({ inlineData: { mimeType: 'image/png', data } }))]
        }
      ],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: req.aspect },
        abortSignal: signal
      }
    }
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const key = this.getKey()
    if (!key) throw new Error('Chưa có API key Google Gemini. Cách xử lý: nhập key ở màn Cài đặt hoặc bật Chế độ Mock.')
    const max = this.cfg.maxReferenceImages ?? 4
    const refs = await Promise.all(req.referenceImagePaths.slice(0, max).map((p) => this.loadReference(p)))

    const timeout = AbortSignal.timeout(this.cfg.timeoutMs ?? 120000)
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
    let res: GenerateResponse
    try {
      res = await this.clientFactory(key).models.generateContent(this.buildRequest(req, refs, signal))
    } catch (err) {
      if (req.signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError')
      if (timeout.aborted) throw new Error(`Gemini timeout sau ${(this.cfg.timeoutMs ?? 120000) / 1000}s`)
      throw err // ApiError của SDK có .status ⇒ hàng đợi tự quyết định thử lại (429/5xx)
    }

    const parts = res.candidates?.[0]?.content?.parts ?? []
    const img = parts.find((p) => p.inlineData?.data)
    if (!img?.inlineData?.data) {
      const reason = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? 'không rõ'
      const text = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200)
      throw new Error(`Gemini không trả về ảnh (lý do: ${reason}). ${text} Cách xử lý: sửa prompt cảnh (bớt chi tiết nhạy cảm) rồi tạo lại.`)
    }
    const png = await sharp(Buffer.from(img.inlineData.data, 'base64')).png().toBuffer()
    const meta = await sharp(png).metadata()
    const tmp = `${req.outputPath}.tmp`
    await fs.writeFile(tmp, png)
    await fs.rename(tmp, req.outputPath)
    return {
      path: req.outputPath,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      cost: this.cfg.pricePerImage,
      provider: this.id,
      model: this.model
    }
  }
}
