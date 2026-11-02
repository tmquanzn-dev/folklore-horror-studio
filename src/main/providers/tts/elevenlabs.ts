/**
 * ElevenLabs (eleven_v3): delivery chung → audio tag dạng [whispers] đặt đầu câu.
 * Endpoint dialogue (nhiều nhân vật trong một lần gọi) không dùng: app tạo TỪNG CÂU độc lập để tạo lại riêng được.
 */
import { providersConfig, type ElevenLabsConfig } from '../../../shared/config'
import type { Delivery, Language, VoiceProfile } from '../../../shared/types'
import { fetchWithRetry } from '../http'
import type { TtsProvider, TtsRequest, TtsResult } from '../interfaces'
import { mergeTags, retryOptions, saveAsWav } from './common'

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly id = 'elevenlabs'
  readonly languages: Language[] = ['en', 'vi']
  readonly commercialLicenseKnown = false
  readonly displayName: string
  readonly model: string

  constructor(
    private readonly getKey: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly cfg: ElevenLabsConfig = providersConfig.tts.elevenlabs
  ) {
    this.displayName = cfg.displayName
    this.model = cfg.model
  }

  estimateCost(characters: number): number {
    return (characters / 1000) * (this.cfg.pricePer1kChars ?? 0)
  }

  toProviderPayload(text: string, delivery: Delivery, voice: VoiceProfile): Record<string, unknown> {
    const allowed = new Set(this.cfg.audioTags ?? [])
    const tags = mergeTags(voice.defaultTags, delivery.tags).filter((t) => allowed.has(t))
    const prefix = tags.map((t) => `[${t}]`).join(' ')
    const custom = (voice.providerSettings['voice_settings'] ?? {}) as Record<string, unknown>
    const speed = Math.min(1.2, Math.max(0.7, voice.speed * delivery.pace))
    const payload: Record<string, unknown> = {
      text: prefix ? `${prefix} ${text}` : text,
      model_id: this.model,
      voice_settings: { ...this.cfg.defaultVoiceSettings, ...custom, speed: Math.round(speed * 100) / 100 }
    }
    if (this.cfg.sendLanguageCode) payload['language_code'] = voice.language
    return payload
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const key = this.getKey()
    if (!key) throw new Error('Chưa có API key ElevenLabs. Cách xử lý: nhập key ở màn Cài đặt, hoặc đổi giọng sang Mock.')
    if (!req.voice.providerVoiceId) throw new Error(`Giọng "${req.voice.name}" chưa có voice_id ElevenLabs`)
    const payload = this.toProviderPayload(req.text, req.delivery, req.voice)
    const url = `${this.cfg.endpoint}/${encodeURIComponent(req.voice.providerVoiceId)}?output_format=${encodeURIComponent(this.cfg.outputFormat)}`
    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(payload)
      },
      { ...retryOptions('ElevenLabs', this.cfg.timeoutMs ?? 90000, req.signal), fetchImpl: this.fetchImpl }
    )
    const duration = await saveAsWav(await res.arrayBuffer(), 'mp3', req.outputPath, req.signal)
    const characters = String(payload['text']).length
    return { path: req.outputPath, duration, characters, cost: this.estimateCost(characters), provider: this.id, model: this.model }
  }
}
