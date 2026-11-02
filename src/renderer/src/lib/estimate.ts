/** Nhãn ước tính chi phí hiển thị cạnh nút gọi LLM / TTS (báo giá trước khi chạy) */
import { providersConfig } from '../../../shared/config'
import { estimateLlmCost, estimateTtsCost, formatUsdShort } from '../../../shared/logic/costEstimate'

export function llmEstimateLabel(mock: boolean, inputChars: number, outputChars: number): string {
  if (mock) return '$0 (Mock)'
  return `~${formatUsdShort(estimateLlmCost(inputChars, outputChars, providersConfig.llm.openai))}`
}

export function imagePrice(providerId: string): number {
  return providerId === 'gemini' ? providersConfig.image.gemini.pricePerImage : 0
}

export function imageEstimateLabel(mock: boolean, providerId: string, count: number): string {
  if (mock || providerId === 'mock' || count === 0) return '$0 (Mock)'
  return `~${formatUsdShort(count * imagePrice(providerId))}`
}

export function ttsPricePer1k(providerId: string): number {
  if (providerId === 'elevenlabs') return providersConfig.tts.elevenlabs.pricePer1kChars ?? 0
  if (providerId === 'openai') return providersConfig.tts.openai.pricePer1kChars ?? 0
  return 0
}

export function ttsEstimateLabel(mock: boolean, providerId: string, chars: number): string {
  if (mock || providerId === 'mock') return '$0 (Mock)'
  return `~${formatUsdShort(estimateTtsCost(chars, ttsPricePer1k(providerId)))}`
}
