/**
 * Đọc file config JSON (src/config/*.json) và gán kiểu.
 * Không hardcode model/giá/preset trong code – sửa trong file JSON.
 */
import providersJson from '../config/providers.json'
import platformsJson from '../config/platforms.json'
import type { AspectRatio, Platform, PlatformDefaults, SubtitleStyle, SubtitleStyleId } from './types'

export interface MockTtsConfig {
  displayName: string
  model: string
  commercialLicense: boolean
  pricePer1kChars: number
  unitsPerSecond: { en: number; vi: number }
  commaPauseSec: number
  stopPauseSec: number
  minSec: number
  toneHz: { en: number; vi: number }
  volume: number
  syllableRateHz: number
}

export interface ProviderPriceConfig {
  displayName: string
  model: string
  endpoint?: string
  timeoutMs?: number
  commercialLicense?: boolean
  pricePer1kChars?: number
  pricePerImage?: number
  pricePerSecond?: number
  pricePerMinute?: number
  maxConcurrency?: number
  rateLimitPerMinute?: number
  languages?: string[]
  audioTags?: string[]
}

export interface ElevenLabsConfig extends ProviderPriceConfig {
  endpoint: string
  outputFormat: string
  sendLanguageCode: boolean
  defaultVoiceSettings: Record<string, number | boolean>
}

export interface OpenAiTtsConfig extends ProviderPriceConfig {
  endpoint: string
  voices: string[]
}

export interface ImageProviderConfig extends ProviderPriceConfig {
  models: string[]
  pricePerImage: number
  maxConcurrency: number
  maxReferenceImages?: number
}

export interface VideoProviderConfig extends ProviderPriceConfig {
  pricePerSecond: number
  clipSeconds: number
  maxConcurrency: number
  resolution?: string
  generateAudio?: boolean
  pollIntervalMs?: number
}

export interface DepthConfig {
  modelFile: string
  downloadUrl: string
  inputSize: number
  mean: [number, number, number]
  std: [number, number, number]
  higherIsNearer: boolean
}

export interface LlmConfig {
  displayName: string
  model: string
  endpoint?: string
  pricePer1kInputTokens: number
  pricePer1kOutputTokens: number
  maxRetriesOnSchemaError: number
  temperature?: number
  timeoutMs?: number
}

export interface ProvidersConfig {
  tts: { mock: MockTtsConfig; elevenlabs: ElevenLabsConfig; openai: OpenAiTtsConfig }
  llm: { mock: LlmConfig; openai: LlmConfig & { endpoint: string } }
  image: { mock: ImageProviderConfig; gemini: ImageProviderConfig }
  video: { mock: VideoProviderConfig; veo: VideoProviderConfig }
  depth: DepthConfig
  stt: Record<string, ProviderPriceConfig>
  queue: {
    defaultConcurrency: number
    maxConcurrency: number
    maxAttempts: number
    backoffBaseMs: number
    backoffMaxMs: number
  }
}

export interface RenderPreset {
  id: string
  label: string
  scale: number
}

export interface PlatformsConfig {
  fps: number
  aspectSizes: Record<AspectRatio, { width: number; height: number }>
  verticalFraming: { cropAspect: number; backgroundBlur: number; backgroundBrightness: number }
  sceneTiming: { minSec: number; targetSec: number; maxSec: number; cutLeadSec: number }
  voiceAssembly: { leadInSec: number; tailSec: number }
  parallax: { layerFactors: [number, number, number]; nearPercentile: number; midPercentile: number; edgeSoftness: number; maxDimension: number }
  audio: {
    truePeakDb: number
    lra: number
    sampleRate: number
    defaultVolume: Record<'ambience' | 'music' | 'sfx' | 'stinger', number>
    duck: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number }
    silenceBeforeClimaxSec: number
  }
  publishing: {
    shorts: { minSec: number; maxSec: number; hookCardSec: number; endCardSec: number }
    thumbnail: { youtube: { width: number; height: number }; cover: { width: number; height: number } }
    performanceDefaults: { minViews: number; minAvgWatchPercent: number }
  }
  /** Chia phần TikTok/Shorts */
  series: { hookSec: number; cliffhangerSec: number; toleranceRatio: number; minLastPartRatio: number }
  platforms: Record<Platform, PlatformDefaults>
  subtitleStyles: Record<SubtitleStyleId, SubtitleStyle>
  renderPresets: RenderPreset[]
}

export const providersConfig = providersJson as unknown as ProvidersConfig
export const platformsConfig = platformsJson as unknown as PlatformsConfig
