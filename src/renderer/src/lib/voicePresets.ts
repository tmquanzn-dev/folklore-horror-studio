import type { VoiceProcessChain } from '../../../shared/types'

/** Preset xử lý giọng (lọc tần thấp → nén → EQ ấm → reverb) */
export const PROCESS_PRESETS: { id: string; label: string; chain: VoiceProcessChain }[] = [
  { id: 'warm', label: 'Ấm áp kể chuyện', chain: { highpassHz: 80, compressor: { thresholdDb: -18, ratio: 3 }, warmthDb: 2, reverbAmount: 0.12 } },
  { id: 'dry', label: 'Khô, gần micro', chain: { highpassHz: 70, compressor: { thresholdDb: -20, ratio: 2.5 }, warmthDb: 1, reverbAmount: 0 } },
  { id: 'ghost', label: 'Thì thầm ma (xa, vọng)', chain: { highpassHz: 180, compressor: { thresholdDb: -22, ratio: 4 }, warmthDb: -2, reverbAmount: 0.4 } },
  { id: 'radio', label: 'Radio cũ / ký ức', chain: { highpassHz: 400, compressor: { thresholdDb: -24, ratio: 6 }, warmthDb: -4, reverbAmount: 0.05 } }
]

export function presetIdOf(chain: VoiceProcessChain): string {
  return PROCESS_PRESETS.find((p) => JSON.stringify(p.chain) === JSON.stringify(chain))?.id ?? 'custom'
}
