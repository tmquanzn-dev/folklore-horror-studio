/**
 * MockTts: sinh "giọng" giả bằng ffmpeg – một âm trầm nhỏ, nhấp nhô theo nhịp âm tiết,
 * thời lượng ước tính theo số từ/âm tiết. Giúp chạy toàn bộ app không cần API key.
 */
import fs from 'node:fs/promises'
import { providersConfig } from '../../../shared/config'
import { estimateSpeechSeconds } from '../../../shared/logic/speech'
import type { Delivery, Language, VoiceProfile } from '../../../shared/types'
import { runFfmpeg } from '../../media/ffmpeg'
import type { TtsProvider, TtsRequest, TtsResult } from '../interfaces'

export class MockTtsProvider implements TtsProvider {
  readonly id = 'mock'
  readonly displayName = providersConfig.tts.mock.displayName
  readonly model = providersConfig.tts.mock.model
  readonly languages: Language[] = ['en', 'vi']
  readonly commercialLicenseKnown = true

  estimateCost(): number {
    return 0
  }

  toProviderPayload(text: string, delivery: Delivery, voice: VoiceProfile): Record<string, unknown> {
    return { text, tags: delivery.tags, pace: delivery.pace * voice.speed }
  }

  estimateDuration(text: string, language: Language, speed: number): number {
    return estimateSpeechSeconds(text, language, speed, providersConfig.tts.mock)
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const cfg = providersConfig.tts.mock
    const speed = req.delivery.pace * req.voice.speed
    const duration = this.estimateDuration(req.text, req.language, speed)
    // Câu thì thầm ⇒ nhỏ hơn; câu căng thẳng ⇒ cao hơn một chút (để nghe được khác biệt)
    const whisper = req.delivery.tags.includes('whispers')
    const tense = req.delivery.tags.some((t) => t === 'tense' || t === 'nervous' || t === 'fearful')
    // Mỗi giọng nhân vật một cao độ (providerSettings.toneHz) ⇒ nghe phân biệt người kể / nhân vật
    const custom = Number(req.voice.providerSettings['toneHz'])
    const baseHz = Number.isFinite(custom) && custom > 50 ? custom : cfg.toneHz[req.language]
    const freq = Math.round(baseHz * (tense ? 1.12 : 1))
    const volume = cfg.volume * (whisper ? 0.6 : 1)
    const fadeOutStart = Math.max(0, duration - 0.12).toFixed(3)
    const tmp = `${req.outputPath}.tmp.wav`
    await runFfmpeg(
      [
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${freq}:sample_rate=44100:duration=${duration.toFixed(3)}`,
        '-af',
        `tremolo=f=${cfg.syllableRateHz}:d=0.85,volume=${volume.toFixed(3)},afade=t=in:d=0.06,afade=t=out:st=${fadeOutStart}:d=0.12`,
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        tmp
      ],
      req.signal
    )
    await fs.rename(tmp, req.outputPath)
    return {
      path: req.outputPath,
      duration,
      characters: req.text.length,
      cost: 0,
      provider: this.id,
      model: this.model
    }
  }
}
