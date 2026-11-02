import { providersConfig } from '../../../../shared/config'
import type { Language, VoiceProfile } from '../../../../shared/types'
import { Area, AsyncButton, ListText, Num, Select, Text } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { playAudio } from '../../lib/audio'
import { PROCESS_PRESETS, presetIdOf } from '../../lib/voicePresets'

const SAMPLE: Record<Language, string> = {
  en: 'There is a bend in the river where the water never seems to move.',
  vi: 'Có một khúc quanh trên sông nơi mặt nước chẳng bao giờ gợn sóng.'
}

/** Hồ sơ giọng: provider, voice id, chỉ dẫn, tag mặc định, tốc độ, giấy phép, xử lý giọng */
export function VoiceEditor({
  v,
  onChange,
  onDelete,
  onDuplicate,
  canListen
}: {
  v: VoiceProfile
  onChange: (patch: Partial<VoiceProfile>) => void
  onDelete: () => void
  onDuplicate: () => void
  canListen: boolean
}): JSX.Element {
  const openaiVoices = providersConfig.tts.openai.voices
  return (
    <div className="rounded-md border border-ink-600 bg-ink-850 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_110px_150px] gap-3">
        <Text label="Tên giọng" value={v.name} onChange={(x) => onChange({ name: x })} />
        <Select
          label="Ngôn ngữ"
          value={v.language}
          onChange={(x: Language) => onChange({ language: x })}
          options={[
            { value: 'vi', label: 'Tiếng Việt' },
            { value: 'en', label: 'Tiếng Anh' }
          ]}
        />
        <Select
          label="Provider"
          value={v.providerId}
          onChange={(x) => onChange({ providerId: x, providerVoiceId: x === 'openai' ? openaiVoices[0] : x === 'mock' ? 'mock' : '' })}
          options={[
            { value: 'mock', label: 'Mock (offline)' },
            { value: 'elevenlabs', label: 'ElevenLabs v3' },
            { value: 'openai', label: 'OpenAI TTS' }
          ]}
        />
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px] gap-3">
        {v.providerId === 'openai' ? (
          <Select label="Voice OpenAI" value={v.providerVoiceId} onChange={(x) => onChange({ providerVoiceId: x })} options={openaiVoices.map((x) => ({ value: x, label: x }))} />
        ) : (
          <Text
            label={v.providerId === 'elevenlabs' ? 'Voice ID ElevenLabs' : 'Voice ID'}
            value={v.providerVoiceId}
            onChange={(x) => onChange({ providerVoiceId: x })}
            placeholder={v.providerId === 'elevenlabs' ? 'dán voice_id từ Voice Library' : ''}
          />
        )}
        <ListText label="Tag mặc định" value={v.defaultTags} onChange={(x) => onChange({ defaultTags: x })} placeholder="softly" />
        <Num label="Tốc độ" value={v.speed} onChange={(x) => onChange({ speed: x })} step={0.05} min={0.7} max={1.2} className="w-full" />
      </div>
      <div className="mt-3">
        <Area label="Chỉ dẫn giọng (OpenAI dùng làm instructions)" value={v.baseInstructions} onChange={(x) => onChange({ baseInstructions: x })} rows={2} />
      </div>
      {v.providerId === 'mock' ? (
        <div className="mt-3 w-40">
          <Num
            label="Cao độ Mock (Hz)"
            value={Number(v.providerSettings['toneHz'] ?? 180)}
            onChange={(x) => onChange({ providerSettings: { ...v.providerSettings, toneHz: x } })}
            step={5}
            min={80}
            max={500}
            className="w-full"
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <select
          className="input py-1 text-xs"
          value={presetIdOf(v.postProcessChain)}
          onChange={(e) => {
            const p = PROCESS_PRESETS.find((x) => x.id === e.target.value)
            if (p) onChange({ postProcessChain: p.chain })
          }}
        >
          {PROCESS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              Xử lý: {p.label}
            </option>
          ))}
          {presetIdOf(v.postProcessChain) === 'custom' ? <option value="custom">Xử lý: tuỳ chỉnh</option> : null}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" className="accent-blood-500" checked={v.commercialLicenseConfirmed} onChange={(e) => onChange({ commercialLicenseConfirmed: e.target.checked })} />
          Đã xác nhận giấy phép thương mại
        </label>
        {v.providerId !== 'mock' && !v.commercialLicenseConfirmed ? <span className="text-[11px] text-amber-300">⚠ chưa xác nhận</span> : null}
        <div className="flex-1" />
        <AsyncButton
          className="btn-ghost px-2 py-1 text-xs"
          disabled={!canListen}
          title={canListen ? `Nghe: "${SAMPLE[v.language]}"` : 'Lưu trước khi nghe thử'}
          onClick={async () => {
            const r = await window.api.invoke('tts:preview', { text: SAMPLE[v.language], voiceProfileId: v.id })
            playAudio(r.dataUrl)
          }}
        >
          <Icon name="play" className="h-3 w-3" /> Nghe thử
        </AsyncButton>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={onDuplicate}>
          Nhân bản
        </button>
        <button className="btn-ghost px-2 py-1 text-xs text-red-300" onClick={onDelete}>
          Xoá
        </button>
      </div>
    </div>
  )
}
