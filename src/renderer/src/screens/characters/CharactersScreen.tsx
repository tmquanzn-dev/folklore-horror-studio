import { useState } from 'react'
import type { ChannelPreset, Character, Language } from '../../../../shared/types'
import { Area, AsyncButton, Select } from '../../components/forms'
import { Empty, Panel } from '../../components/ui'
import { llmEstimateLabel } from '../../lib/estimate'
import { useLibraryDraft } from '../../lib/useLibraryDraft'
import { useApp, useCurrentStory, useMockMode } from '../../store/appStore'
import { CharacterEditor } from './CharacterEditor'
import { VoiceEditor } from './VoiceEditor'

type Tab = 'channel' | 'channelChars' | 'storyChars' | 'voices'
const NL = '\n'

function newCharacter(scope: Character['scope'], storyId: string | null): Character {
  return {
    id: `char-${Date.now().toString(36)}`,
    name: 'Nhân vật mới',
    role: scope === 'channel' ? 'narrator' : 'character',
    scope,
    storyId,
    age: null,
    gender: 'unknown',
    appearance: '',
    defaultOutfit: '',
    description: '',
    referenceImages: [],
    characterSheet: { front: null, threeQuarter: null, profile: null, fullBody: null },
    expressionSheet: [],
    states: [],
    voiceProfileIdByLanguage: {},
    locked: false,
    approval: { status: 'pending' }
  }
}

/** Kênh & Nhân vật: kênh, nhân vật kênh (xuyên mọi Story), nhân vật truyện (Story đang chọn), hồ sơ giọng */
export function ChannelScreen(): JSX.Element {
  const [tab, setTab] = useState<Tab>('storyChars')
  const story = useCurrentStory()
  const mock = useMockMode()
  const { draft, dirty, setDraft, reset, save } = useLibraryDraft()
  if (!draft) return <Empty>Đang tải…</Empty>
  const ch = draft.channelPresets[0]

  const setChar = (id: string, patch: Partial<Character>): void =>
    setDraft((l) => ({ ...l, characters: l.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const delChar = (id: string): void => setDraft((l) => ({ ...l, characters: l.characters.filter((c) => c.id !== id) }))

  const setCh = (patch: Partial<ChannelPreset>): void =>
    setDraft((l) => ({ ...l, channelPresets: l.channelPresets.map((x) => (x.id === ch?.id ? { ...x, ...patch } : x)) }))
  const channelChars = draft.characters.filter((c) => c.scope === 'channel')
  const storyChars = story ? draft.characters.filter((c) => c.scope === 'story' && c.storyId === story.id) : []

  const tabs: { id: Tab; label: string }[] = [
    { id: 'storyChars', label: `Nhân vật truyện (${storyChars.length})` },
    { id: 'channelChars', label: `Nhân vật kênh (${channelChars.length})` },
    { id: 'voices', label: `Giọng (${draft.voiceProfiles.length})` },
    { id: 'channel', label: 'Kênh' }
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center gap-1 border-b border-ink-600">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.id ? 'border-blood-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {dirty ? (
          <>
            <span className="text-xs text-amber-300">Chưa lưu</span>
            <button className="btn-secondary text-xs" onClick={reset}>
              Huỷ
            </button>
            <AsyncButton className="btn-primary text-xs" onClick={() => save(['characters', 'voiceProfiles', 'channelPresets'])}>
              Lưu thay đổi
            </AsyncButton>
          </>
        ) : null}
      </div>

      {tab === 'storyChars' ? (
        !story ? (
          <Empty>Chọn Story ở thanh trên.</Empty>
        ) : (
          <Panel
            title={`Nhân vật truyện – ${story.name}`}
            actions={
              <>
                <button className="btn-secondary text-xs" onClick={() => setDraft((l) => ({ ...l, characters: [...l.characters, newCharacter('story', story.id)] }))}>
                  + Thêm thủ công
                </button>
                <AsyncButton
                  className="btn-secondary text-xs"
                  disabled={dirty || story.outline.approval.status !== 'approved'}
                  title={story.outline.approval.status !== 'approved' ? 'Duyệt dàn ý trước' : dirty ? 'Lưu trước' : ''}
                  confirm="LLM đề xuất lại dàn nhân vật từ dàn ý – nhân vật CHƯA khoá sẽ bị thay. Tiếp tục?"
                  onClick={async () => {
                    await window.api.invoke('story:proposeCast', story.id)
                    await useApp.getState().reloadAll()
                  }}
                >
                  Đề xuất bằng LLM · {llmEstimateLabel(mock, 4000, 5000)}
                </AsyncButton>
              </>
            }
          >
            <div className="space-y-4">
              {storyChars.map((c) => (
                <CharacterEditor key={c.id} c={c} storyId={story?.id ?? null} voices={draft.voiceProfiles} canListen={!dirty} onChange={(p) => setChar(c.id, p)} onDelete={() => delChar(c.id)} />
              ))}
              {storyChars.length === 0 ? <p className="text-sm text-slate-500">Chưa có nhân vật truyện.</p> : null}
            </div>
          </Panel>
        )
      ) : null}

      {tab === 'channelChars' ? (
        <Panel
          title="Nhân vật kênh – xuất hiện xuyên suốt mọi Story (intro, chuyển chương, outro)"
          actions={
            <button className="btn-secondary text-xs" onClick={() => setDraft((l) => ({ ...l, characters: [...l.characters, newCharacter('channel', null)] }))}>
              + Thêm nhân vật kênh
            </button>
          }
        >
          <div className="space-y-4">
            {channelChars.map((c) => (
              <CharacterEditor
                key={c.id}
                c={c}
                storyId={story?.id ?? null}
                voices={draft.voiceProfiles}
                canListen={!dirty}
                onChange={(p) => setChar(c.id, p)}
                onDelete={channelChars.length > 1 ? () => delChar(c.id) : undefined}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {tab === 'voices' ? (
        <Panel
          title="Hồ sơ giọng (VoiceProfile)"
          actions={
            <button
              className="btn-secondary text-xs"
              onClick={() =>
                setDraft((l) => ({
                  ...l,
                  voiceProfiles: [
                    ...l.voiceProfiles,
                    {
                      id: `voice-${Date.now().toString(36)}`,
                      name: 'Giọng mới',
                      language: 'vi',
                      providerId: 'mock',
                      providerVoiceId: 'mock',
                      baseInstructions: '',
                      defaultTags: [],
                      speed: 1,
                      providerSettings: {},
                      postProcessChain: { highpassHz: 80, compressor: { thresholdDb: -18, ratio: 3 }, warmthDb: 2, reverbAmount: 0.12 },
                      commercialLicenseConfirmed: false
                    }
                  ]
                }))
              }
            >
              + Thêm giọng
            </button>
          }
        >
          <div className="space-y-3">
            {draft.voiceProfiles.map((v) => (
              <VoiceEditor
                key={v.id}
                v={v}
                canListen={!dirty}
                onChange={(p) => setDraft((l) => ({ ...l, voiceProfiles: l.voiceProfiles.map((x) => (x.id === v.id ? { ...x, ...p } : x)) }))}
                onDuplicate={() =>
                  setDraft((l) => ({ ...l, voiceProfiles: [...l.voiceProfiles, { ...structuredClone(v), id: `voice-${Date.now().toString(36)}`, name: `${v.name} (bản sao)` }] }))
                }
                onDelete={() => setDraft((l) => ({ ...l, voiceProfiles: l.voiceProfiles.filter((x) => x.id !== v.id) }))}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {tab === 'channel' && ch ? (
        <Panel title="Kênh (ChannelPreset)">
          <h3 className="text-lg font-semibold text-slate-100">{ch.name}</h3>
          <div className="mt-3 grid grid-cols-2 gap-5 text-sm">
            <div className="space-y-3">
              <Area label="Phong cách ảnh (artStyle – đầu mọi prompt ảnh)" value={ch.artStyle} rows={3} onChange={(v) => setCh({ artStyle: v })} />
              <Area label="Negative prompt (nối thành “Avoid: …”)" value={ch.negativePrompt} rows={3} onChange={(v) => setCh({ negativePrompt: v })} />
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Bảng màu</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ch.palette.map((c, i) => (
                    <input
                      key={i}
                      type="color"
                      value={c}
                      className="h-8 w-10 cursor-pointer rounded border border-ink-500 bg-transparent"
                      onChange={(e) => setCh({ palette: ch.palette.map((x, k) => (k === i ? e.target.value : x)) })}
                    />
                  ))}
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setCh({ palette: [...ch.palette, '#444444'] })}>+</button>
                  {ch.palette.length > 1 ? <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setCh({ palette: ch.palette.slice(0, -1) })}>−</button> : null}
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Area
                label="Cultural visual bible (mỗi dòng một yếu tố – bối cảnh bắt buộc trong ảnh)"
                value={ch.culturalVisualBible.join(NL)}
                rows={8}
                onChange={(v) => setCh({ culturalVisualBible: v.split(NL).map((x) => x.trim()).filter(Boolean) })}
              />
              {(['vi', 'en'] as Language[]).map((lang) => (
                <Select
                  key={lang}
                  label={`Giọng mặc định ${lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'} (người kể)`}
                  value={ch.defaultVoiceByLanguage[lang]}
                  onChange={(id) =>
                    setDraft((l) => ({
                      ...l,
                      channelPresets: l.channelPresets.map((x) => (x.id === ch.id ? { ...x, defaultVoiceByLanguage: { ...x.defaultVoiceByLanguage, [lang]: id } } : x))
                    }))
                  }
                  options={draft.voiceProfiles.filter((v) => v.language === lang).map((v) => ({ value: v.id, label: v.name }))}
                />
              ))}
              <p className="text-[11px] text-slate-500">Đổi phong cách/bible ⇒ prompt ảnh thay đổi ⇒ lần tạo sau sẽ vẽ ảnh mới (cache theo prompt).</p>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
