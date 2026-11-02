/**
 * Ước lượng độ sâu (depth map) chạy LOCAL bằng onnxruntime-node – model cấu hình trong providers.json → "depth".
 * Chưa có file model ⇒ dùng depth ước lượng (heuristic) để pipeline vẫn chạy; UI có nút tải model.
 * onnxruntime chạy suy luận trên luồng native riêng (session.run là async) ⇒ không làm đứng UI.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { providersConfig, type DepthConfig } from '../../shared/config'
import { heuristicDepth, normalizeDepth } from '../../shared/logic/parallaxMath'
import { logger } from '../logger'

interface OrtSession {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>
}
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}

export interface DepthResult {
  /** 0..1, 1 = gần; kích thước width × height */
  depth: Float32Array
  width: number
  height: number
  source: 'model' | 'heuristic'
}

export class DepthEstimator {
  private session: Promise<OrtSession> | null = null
  private ort: OrtModule | null = null

  constructor(
    private readonly modelsDir: string,
    private readonly cfg: DepthConfig = providersConfig.depth
  ) {}

  get modelPath(): string {
    return path.join(this.modelsDir, this.cfg.modelFile)
  }

  hasModel(): boolean {
    try {
      return fs.statSync(this.modelPath).size > 1_000_000
    } catch {
      return false
    }
  }

  private async getSession(): Promise<OrtSession> {
    if (!this.session) {
      this.session = (async () => {
        // Nạp lười: nếu module native lỗi thì vẫn dùng được depth ước lượng
        this.ort = (await import('onnxruntime-node')).default as unknown as OrtModule
        const s = await this.ort.InferenceSession.create(this.modelPath)
        logger.info(`Đã nạp model depth ${this.cfg.modelFile}`, 'depth')
        return s
      })()
      this.session.catch(() => (this.session = null))
    }
    return this.session
  }

  /** Depth ở kích thước width×height cho ảnh đầu vào */
  async estimate(image: Buffer, width: number, height: number, focus: { x: number; y: number }): Promise<DepthResult> {
    if (!this.hasModel()) return { depth: heuristicDepth(width, height, focus), width, height, source: 'heuristic' }
    try {
      const s = await this.getSession()
      const S = this.cfg.inputSize
      const { data } = await sharp(image).removeAlpha().resize(S, S, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
      const input = new Float32Array(3 * S * S)
      for (let i = 0; i < S * S; i++) {
        for (let c = 0; c < 3; c++) input[c * S * S + i] = (data[i * 3 + c] / 255 - this.cfg.mean[c]) / this.cfg.std[c]
      }
      const out = await s.run({ [s.inputNames[0]]: new this.ort!.Tensor('float32', input, [1, 3, S, S]) })
      const t = out[s.outputNames[0]]
      const [oh, ow] = t.dims.slice(-2)
      const norm = normalizeDepth(t.data, this.cfg.higherIsNearer)
      // Phóng depth về kích thước ảnh (qua ảnh xám 8-bit, nội suy của sharp)
      const gray = Buffer.alloc(norm.length)
      for (let i = 0; i < norm.length; i++) gray[i] = Math.round(norm[i] * 255)
      const up = await sharp(gray, { raw: { width: ow, height: oh, channels: 1 } }).resize(width, height, { fit: 'fill' }).extractChannel(0).raw().toBuffer()
      const depth = new Float32Array(width * height)
      for (let i = 0; i < depth.length; i++) depth[i] = up[i] / 255
      return { depth, width, height, source: 'model' }
    } catch (err) {
      logger.warn(`Model depth lỗi (${err instanceof Error ? err.message : String(err)}) – dùng depth ước lượng`, 'depth')
      return { depth: heuristicDepth(width, height, focus), width, height, source: 'heuristic' }
    }
  }

  /** Tải model về thư mục models (một lần, ~27MB) */
  async download(onProgress: (pct: number) => void): Promise<string> {
    await fsp.mkdir(this.modelsDir, { recursive: true })
    const res = await fetch(this.cfg.downloadUrl)
    if (!res.ok || !res.body) throw new Error(`Không tải được model depth (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const tmp = `${this.modelPath}.part`
    const file = await fsp.open(tmp, 'w')
    let got = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await file.write(value)
        got += value.length
        if (total) onProgress(got / total)
      }
    } finally {
      await file.close()
    }
    await fsp.rename(tmp, this.modelPath)
    this.session = null
    logger.info(`Đã tải model depth (${(got / 1024 / 1024).toFixed(1)} MB) → ${this.modelPath}`, 'depth')
    return this.modelPath
  }
}
