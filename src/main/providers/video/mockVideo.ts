/**
 * Mock image-to-video: dựng clip ngắn từ ảnh bằng ffmpeg (zoom chậm + hạt phim + ánh sáng chập chờn) – không tốn phí.
 */
import fs from 'node:fs/promises'
import { providersConfig, type VideoProviderConfig } from '../../../shared/config'
import { probeDuration, runFfmpeg } from '../../media/ffmpeg'
import type { VideoProvider, VideoRequest, VideoResult } from '../interfaces'

export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock'
  readonly displayName: string
  readonly model: string

  constructor(private readonly cfg: VideoProviderConfig = providersConfig.video.mock) {
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
    const [w, h] = req.aspect === '9:16' ? [720, 1280] : [1280, 720]
    const fps = 30
    const d = Math.max(1, req.durationSec)
    const frames = Math.round(d * fps)
    const tmp = `${req.outputPath}.tmp.mp4`
    await runFfmpeg(
      [
        '-loop',
        '1',
        '-i',
        req.imagePath,
        '-t',
        d.toFixed(2),
        '-vf',
        [
          `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase`,
          `crop=${w * 2}:${h * 2}`,
          `zoompan=z='min(1+0.10*on/${frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`,
          'noise=alls=8:allf=t',
          "eq=brightness='0.03*sin(2*PI*t*0.9)':eval=frame",
          'format=yuv420p'
        ].join(','),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-an',
        '-movflags',
        '+faststart',
        tmp
      ],
      req.signal
    )
    await fs.rename(tmp, req.outputPath)
    const duration = await probeDuration(req.outputPath).catch(() => d)
    return { path: req.outputPath, duration, cost: this.estimateCost(d), provider: this.id, model: this.model }
  }
}
