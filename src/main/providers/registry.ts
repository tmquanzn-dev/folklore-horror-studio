/**
 * Chọn provider theo cài đặt:
 * - Chế độ Mock BẬT ⇒ mọi LLM/TTS là Mock (không tốn phí, không cần key).
 * - Chế độ Mock TẮT ⇒ LLM = OpenAI; TTS theo providerId của từng VoiceProfile (mock | elevenlabs | openai).
 */
import { MockLlmProvider } from '../llm/mockLlm'
import { OpenAiLlmProvider } from '../llm/openaiLlm'
import { GeminiImageProvider } from './image/gemini'
import type { ImageProvider, LlmProvider, TtsProvider, VideoProvider } from './interfaces'
import { MockVideoProvider } from './video/mockVideo'
import { VeoVideoProvider } from './video/veo'
import { MockImageProvider } from './mock/mockImage'
import { MockTtsProvider } from './mock/mockTts'
import { ElevenLabsTtsProvider } from './tts/elevenlabs'
import { OpenAiTtsProvider } from './tts/openaiTts'

export interface ProviderRegistry {
  llm(): LlmProvider
  tts(providerId: string): TtsProvider
  /** providerId mặc định: gemini khi tắt Mock, mock khi bật Mock */
  image(providerId?: string): ImageProvider
  /** Provider ảnh mặc định theo chế độ hiện tại */
  defaultImageProvider(): string
  /** Video AI (image-to-video): mock khi bật Mock, veo khi tắt */
  video(providerId?: string): VideoProvider & { clipSeconds: number }
  defaultVideoProvider(): string
  isMock(): boolean
}

export const TTS_PROVIDER_IDS = ['mock', 'elevenlabs', 'openai'] as const

export function createProviderRegistry(opts: {
  isMock: () => boolean
  getKey: (providerId: string) => string | null
  fetchImpl?: typeof fetch
  /** Thay provider khi kiểm thử (vd video giả có tính phí để thử luồng báo giá) */
  overrides?: { video?: VideoProvider & { clipSeconds: number } }
}): ProviderRegistry {
  const f = opts.fetchImpl ?? fetch
  const mockTts = new MockTtsProvider()
  const mockLlm = new MockLlmProvider()
  const mockImage = new MockImageProvider()
  const openaiLlm = new OpenAiLlmProvider(() => opts.getKey('openai'), f)
  const eleven = new ElevenLabsTtsProvider(() => opts.getKey('elevenlabs'), f)
  const openaiTts = new OpenAiTtsProvider(() => opts.getKey('openai'), f)
  const gemini = new GeminiImageProvider(() => opts.getKey('gemini'))
  const mockVideo = opts.overrides?.video ?? new MockVideoProvider()
  const veo = new VeoVideoProvider(() => opts.getKey('gemini'))

  return {
    isMock: opts.isMock,
    llm: () => (opts.isMock() ? mockLlm : openaiLlm),
    tts: (providerId) => {
      if (opts.isMock() || providerId === 'mock') return mockTts
      if (providerId === 'elevenlabs') return eleven
      if (providerId === 'openai') return openaiTts
      throw new Error(`Provider giọng không hợp lệ: "${providerId}"`)
    },
    defaultImageProvider: () => (opts.isMock() ? 'mock' : 'gemini'),
    defaultVideoProvider: () => (opts.isMock() ? 'mock' : 'veo'),
    video: (providerId) => {
      const id = providerId ?? (opts.isMock() ? 'mock' : 'veo')
      if (opts.isMock() || id === 'mock') return mockVideo
      if (id === 'veo') return veo
      throw new Error(`Provider video không hợp lệ: "${id}"`)
    },
    image: (providerId) => {
      const id = providerId ?? (opts.isMock() ? 'mock' : 'gemini')
      if (opts.isMock() || id === 'mock') return mockImage
      if (id === 'gemini') return gemini
      throw new Error(`Provider ảnh không hợp lệ: "${id}"`)
    }
  }
}
