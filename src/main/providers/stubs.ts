/**
 * Adapter của giai đoạn sau – giữ để kiến trúc đầy đủ.
 * (TTS ElevenLabs/OpenAI và LLM OpenAI đã triển khai ở GĐ2: xem providers/tts và llm/.)
 */
import { providersConfig } from '../../shared/config'
import type {
  Exporter,
  ExportFormat,
  ExportResult,
  Transcriber,
  Transcript
} from './interfaces'

export class WhisperTranscriber implements Transcriber {
  readonly id = 'openai-whisper'
  readonly model = providersConfig.stt.openai.model
  transcribe(): Promise<Transcript> {
    throw new Error('Chưa triển khai – Giai đoạn 6')
  }
}

export class NotImplementedExporter implements Exporter {
  constructor(
    readonly format: ExportFormat,
    readonly displayName: string
  ) {}
  export(): Promise<ExportResult> {
    throw new Error('Chưa triển khai – Giai đoạn 6')
  }
}
