/** Phần dùng chung cho adapter TTS thật: tải audio về file tạm → chuẩn hoá WAV → đo thời lượng */
import fs from 'node:fs/promises'
import { providersConfig } from '../../../shared/config'
import { probeDuration, toWav44kMono } from '../../media/ffmpeg'
import { logger } from '../../logger'
import type { RetryOptions } from '../http'

export async function saveAsWav(audio: ArrayBuffer, ext: string, outputPath: string, signal?: AbortSignal): Promise<number> {
  const tmp = `${outputPath}.dl.${ext}`
  const tmpWav = `${outputPath}.tmp.wav`
  await fs.writeFile(tmp, Buffer.from(audio))
  try {
    await toWav44kMono(tmp, tmpWav, signal)
    await fs.rename(tmpWav, outputPath)
  } finally {
    await fs.rm(tmp, { force: true })
  }
  return probeDuration(outputPath)
}

export function retryOptions(providerName: string, timeoutMs: number, signal?: AbortSignal): RetryOptions {
  return {
    maxAttempts: providersConfig.queue.maxAttempts,
    baseMs: providersConfig.queue.backoffBaseMs,
    maxMs: providersConfig.queue.backoffMaxMs,
    timeoutMs,
    signal,
    onRetry: (a, d, r) => logger.warn(`${providerName}: thử lại lần ${a} sau ${d}ms (${r})`, 'tts')
  }
}

/** Gộp tag mặc định của giọng + tag của câu, bỏ trùng */
export function mergeTags(defaultTags: string[], tags: string[]): string[] {
  return [...new Set([...defaultTags, ...tags].map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

export function paceHint(pace: number): string {
  if (pace <= 0.85) return 'Speak slowly.'
  if (pace < 0.97) return 'Speak a little slower than normal.'
  if (pace >= 1.1) return 'Speak a little faster than normal.'
  return ''
}
