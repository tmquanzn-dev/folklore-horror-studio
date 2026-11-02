/**
 * (GĐ6) Các adapter từng là stub nay đã triển khai:
 *   - Chép lời: providers/stt/whisper.ts (OpenAI Whisper) + providers/stt/mockTranscriber.ts
 *   - Xuất cho phần mềm dựng: main/exporters (SRT, FCPXML, CapCut template)
 * File này giữ lại để import cũ không gãy.
 */
export { WhisperTranscriber } from './stt/whisper'
export { MockTranscriber } from './stt/mockTranscriber'
