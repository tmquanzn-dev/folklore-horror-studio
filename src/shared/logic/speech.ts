/**
 * Ước tính thời lượng đọc của một câu.
 * Tiếng Anh: đếm từ; tiếng Việt: đếm âm tiết (mỗi âm tiết cách nhau dấu cách) → cùng cách tách token.
 */
import type { Language } from '../types'

export interface SpeechRateConfig {
  unitsPerSecond: Record<Language, number>
  commaPauseSec: number
  stopPauseSec: number
  minSec: number
}

export function countSpeechUnits(text: string): number {
  return text
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

export function estimateSpeechSeconds(
  text: string,
  language: Language,
  speed: number,
  cfg: SpeechRateConfig
): number {
  const units = countSpeechUnits(text)
  const rate = cfg.unitsPerSecond[language] * Math.max(0.3, speed)
  const commas = (text.match(/[,;:—–]/g) ?? []).length
  const stops = (text.match(/[.!?…]+/g) ?? []).length
  const seconds = units / rate + commas * cfg.commaPauseSec + stops * cfg.stopPauseSec
  return Math.round(Math.max(cfg.minSec, seconds) * 1000) / 1000
}
