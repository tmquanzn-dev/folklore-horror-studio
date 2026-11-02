/**
 * OpenAI gpt-4o-mini-tts: điều khiển giọng bằng trường "instructions"
 * (baseInstructions của giọng + chỉ dẫn câu + tag + gợi ý nhịp).
 */
import { providersConfig, type OpenAiTtsConfig } from '../../../shared/config'
import type { Delivery, Language, VoiceProfile } from '../../../shared/types'
import { fetchWithRetry } from '../http'
import type { TtsProvider, TtsRequest, TtsResult } from '../interfaces'
import { mergeTags, paceHint, retryOptions, saveAsWav } from './common'

export class OpenAiTtsProvider implements TtsProvider {
  readonly id = 'openai'
  readonly languages: Language[] = ['en', 'vi']
  readonly commercialLicenseKnown = false
  readonly displayName: string
  readonly model: string

  constructor(
    private readonly getKey: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly cfg: OpenAiTtsConfig = providersConfig.tts.openai
  ) {
    this.displayName = cfg.displayName
    this.model = cfg.model
  }

  estimateCost(characters: number): number {
    return (characters / 1000) * (this.cfg.pricePer1kChars ?? 0)
  }

  toProviderPayload(text: string, delivery: Delivery, voice: VoiceProfile): Record<string, unknown> {
    const tags = mergeTags(voice.defaultTags, delivery.tags)
    const parts = [
      voice.baseInstructions,
      delivery.instructions,
      tags.length ? `Delivery: ${tags.join(', ')}.` : '',
      paceHint(voice.speed * delivery.pace),
      voice.language === 'vi' ? 'Speak natural Vietnamese with correct tones.' : ''
    ]
    return {
      model: this.model,
      voice: voice.providerVoiceId || 'ballad',
      input: text,
      instructions: parts.filter(Boolean).join(' ').trim(),
      response_format: 'wav'
    }
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const key = this.getKey()
    if (!key) throw new Error('Chưa có API key OpenAI. Cách xử lý: nhập key ở màn Cài đặt, hoặc đổi giọng sang Mock.')
    const payload = this.toProviderPayload(req.text, req.delivery, req.voice)
    const res = await fetchWithRetry(
      this.cfg.endpoint,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      { ...retryOptions('OpenAI TTS', this.cfg.timeoutMs ?? 90000, req.signal), fetchImpl: this.fetchImpl }
    )
    const duration = await saveAsWav(await res.arrayBuffer(), 'wav', req.outputPath, req.signal)
    return {
      path: req.outputPath,
      duration,
      characters: req.text.length,
      cost: this.estimateCost(req.text.length),
      provider: this.id,
      model: this.model
    }
  }
}
