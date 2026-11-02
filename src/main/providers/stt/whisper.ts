/**
 * OpenAI Whisper (whisper-1): chép lời giọng tự thu, trả mốc từng từ + từng đoạn.
 * - Nén về MP3 16 kHz mono trước khi gửi (giới hạn 25 MB/lần gọi).
 * - File dài vẫn quá giới hạn ⇒ cắt khúc 10 phút, cộng offset mốc thời gian.
 * - Chi phí theo phút (providers.json → stt.openai.pricePerMinute), ghi vào sổ chi phí loại 'stt'.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { providersConfig } from '../../../shared/config'
import type { Language } from '../../../shared/types'
import { probeDuration, runFfmpeg } from '../../media/ffmpeg'
import { fetchWithRetry } from '../http'
import type { Transcriber, TranscribeOptions, Transcript, TranscriptSegment, TranscriptWord } from '../interfaces'
import { retryOptions } from '../tts/common'

const MAX_BYTES = 24 * 1024 * 1024
const CHUNK_SEC = 600
const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'

interface VerboseJson {
  text: string
  language?: string
  words?: { word: string; start: number; end: number }[]
  segments?: { text: string; start: number; end: number }[]
}

export class WhisperTranscriber implements Transcriber {
  readonly id = 'openai-whisper'
  readonly model = providersConfig.stt.openai.model

  constructor(
    private readonly getKey: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  estimateCost(durationSec: number): number {
    return (Math.max(0, durationSec) / 60) * (providersConfig.stt.openai.pricePerMinute ?? 0.006)
  }

  async transcribe(audioPath: string, language: Language, opts: TranscribeOptions = {}): Promise<Transcript> {
    const key = this.getKey()
    if (!key) throw new Error('Chưa có API key OpenAI để chép lời bằng Whisper. Cách xử lý: nhập key ở Cài đặt, hoặc bật Chế độ Mock để thử.')
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fhs-stt-'))
    try {
      const duration = await probeDuration(audioPath)
      const whole = path.join(tmp, 'all.mp3')
      await runFfmpeg(['-i', audioPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', whole], opts.signal)
      const chunks: { file: string; offset: number }[] = []
      if ((await fs.stat(whole)).size <= MAX_BYTES) chunks.push({ file: whole, offset: 0 })
      else {
        for (let t = 0, k = 0; t < duration; t += CHUNK_SEC, k++) {
          const f = path.join(tmp, `part${k}.mp3`)
          await runFfmpeg(['-ss', String(t), '-t', String(CHUNK_SEC), '-i', whole, '-c', 'copy', f], opts.signal)
          chunks.push({ file: f, offset: t })
        }
      }
      const words: TranscriptWord[] = []
      const segments: TranscriptSegment[] = []
      const texts: string[] = []
      let lang: string = language
      for (const c of chunks) {
        const r = await this.call(key, c.file, language, opts)
        texts.push(r.text.trim())
        lang = r.language ?? lang
        for (const w of r.words ?? []) words.push({ word: w.word, start: w.start + c.offset, end: w.end + c.offset })
        for (const s of r.segments ?? []) segments.push({ text: s.text, start: s.start + c.offset, end: s.end + c.offset })
      }
      if (words.length === 0) throw new Error('Whisper không trả mốc từng từ – kiểm tra file có tiếng nói không')
      return { text: texts.join(' '), language: lang, words, segments, cost: this.estimateCost(duration) }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async call(key: string, file: string, language: Language, opts: TranscribeOptions): Promise<VerboseJson> {
    const buf = await fs.readFile(file)
    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), path.basename(file))
    form.append('model', this.model)
    form.append('language', language)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 800))
    const res = await fetchWithRetry(
      ENDPOINT,
      { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
      { ...retryOptions('OpenAI Whisper', 300000, opts.signal), fetchImpl: this.fetchImpl }
    )
    return (await res.json()) as VerboseJson
  }
}
