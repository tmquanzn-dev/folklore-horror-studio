import { useEffect, useState } from 'react'
import type { Easing, MotionLevel, MotionType, Release, ReleaseScene, Story, TransitionType } from '../../../../shared/types'
import { providersConfig } from '../../../../shared/config'
import { AsyncButton } from '../../components/forms'
import { Field } from '../../components/ui'
import { SceneEditModal } from '../../components/SceneEditModal'
import { charactersForStory } from '../../../../shared/logic/voices'
import { formatTimePrecise, SHOT_LABEL } from '../../lib/format'
import { useMediaUrl } from '../../lib/preview'
import { useApp } from '../../store/appStore'

const TYPES_BY_LEVEL: Record<MotionLevel, MotionType[]> = {
  kenBurns: ['zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown'],
  parallax: ['dollyIn', 'dollyOut', 'truckLeft', 'truckRight'],
  aiVideo: ['aiClip']
}
const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut']
const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: 'cut', label: 'Cắt thẳng' },
  { value: 'fade', label: 'Fade' },
  { value: 'dipToBlack', label: 'Dip to black' },
  { value: 'flash', label: 'Flash (cao trào)' }
]

/** Cột phải AutoEdit: thuộc tính cảnh đang chọn (chỉnh được chuyển động, chuyển cảnh, hero) */
export function ScenePanel({ story, release }: { story: Story; release: Release }): JSX.Element {
  const selectedId = useApp((s) => s.selectedSceneId)
  const runAction = useApp((s) => s.runAction)
  const library = useApp((s) => s.library)
  const [editingScene, setEditingScene] = useState(false)
  const mediaUrl = useMediaUrl(story.id)
  const scene = release.scenes.find((s) => s.id === selectedId) ?? null
  const [draft, setDraft] = useState<ReleaseScene | null>(scene)

  useEffect(() => setDraft(scene), [scene])

  if (!scene || !draft) {
    return (
      <div className="p-4 text-sm text-slate-500">
        Chọn một cảnh trên timeline để xem và chỉnh thuộc tính.
        <div className="mt-4 text-[11px]">Bấm một sound cue (Ambience / SFX / Music) để chỉnh âm thanh.</div>
      </div>
    )
  }
  const bank = story.sceneBank.find((b) => b.id === scene.sceneBankId)
  const media = scene.mediaOverride ?? (release.aspectRatio === '9:16' ? bank?.media['9:16'] ?? bank?.media['16:9'] : bank?.media['16:9'])
  const locked = !!release.pipelineState?.running
  const aspect = release.aspectRatio
  const layers = bank?.parallax?.[aspect] && bank.parallax[aspect]?.sourcePath === bank.media[aspect]?.path ? bank.parallax[aspect] : null
  const clip = bank?.heroClip[aspect] ?? null
  const mock = useApp.getState().appInfo?.mockMode ?? true
  const vcfg = mock ? providersConfig.video.mock : providersConfig.video.veo
  const providerLabel = mock ? 'Mock' : vcfg.displayName
  const quote = vcfg.pricePerSecond > 0 ? `~$${(vcfg.pricePerSecond * vcfg.clipSeconds).toFixed(2)}` : '$0 (Mock)'
  const dirty = JSON.stringify(draft) !== JSON.stringify(scene)

  const save = (): void =>
    void runAction(() =>
      window.api.invoke('release:updateScene', story.id, release.id, scene.id, {
        motion: { level: draft.motion.level, type: draft.motion.type, intensity: draft.motion.intensity, easing: draft.motion.easing },
        transition: { type: draft.transition.type, durationSec: draft.transition.durationSec },
        isHero: draft.isHero
      })
    )

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm">
      <div>
        <div className="panel-title">Cảnh {release.scenes.indexOf(scene) + 1}</div>
        <div className="mt-1 text-slate-200">{bank?.description}</div>
        {scene.kind === 'puppet' && scene.puppet ? (
          <div className="mt-2 rounded border border-emerald-800 bg-emerald-950/30 p-2 text-xs text-emerald-200">
            Cảnh rối 2D:{' '}
            {scene.puppet.actors.map((a) => useApp.getState().library?.characters.find((c) => c.id === a.characterId)?.name ?? a.characterId).join(', ')} trên bối cảnh{' '}
            {useApp.getState().library?.puppetStages.find((s) => s.id === scene.puppet?.stageId)?.name ?? scene.puppet.stageId} · chớp mắt, khớp môi, thở tự động · camera{' '}
            {scene.puppet.camera === 'pushIn' ? 'đẩy chậm' : scene.puppet.camera}. Chuyển động Ken Burns bên dưới không áp cho cảnh này.
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="chip">{bank ? SHOT_LABEL[bank.shotType] : '?'}</span>
          <span className="chip">{bank?.cameraAngle}</span>
          {scene.isHero ? <span className="chip border-amber-600 text-amber-300">★ hero</span> : null}
        </div>
        {bank?.cast.length ? (
          <ul className="mt-2 space-y-0.5 text-[11px] text-teal-300">
            {bank.cast.map((m) => {
              const c = library?.characters.find((x) => x.id === m.characterId)
              const st = c?.states.find((x) => x.id === m.stateId)
              return (
                <li key={m.characterId}>
                  {c?.name ?? m.characterId} · {m.position}
                  {m.expression ? ` · ${m.expression}` : ''}
                  {st ? ` · [${st.name}]` : ''}
                  {m.action ? ` – ${m.action}` : ''}
                </li>
              )
            })}
          </ul>
        ) : null}
        <button className="btn-ghost mt-1 px-1.5 py-0.5 text-[11px]" disabled={!bank} onClick={() => setEditingScene(true)}>
          Sửa cảnh & cast (nhân vật, trạng thái, biểu cảm, vị trí)
        </button>
        {editingScene && bank && library ? (
          <SceneEditModal
            scene={bank}
            characters={charactersForStory(story.id, library.characters)}
            onClose={() => setEditingScene(false)}
            onSave={async (patch) => {
              await window.api.invoke('scene:update', story.id, bank.id, patch)
              await useApp.getState().refresh()
            }}
          />
        ) : null}
      </div>
      {media ? (
        <img
          src={mediaUrl(media.path, media.createdAt)}
          className="w-full rounded border border-ink-600 object-contain"
          style={{ maxHeight: 160 }}
          alt=""
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
        <span>Bắt đầu: {formatTimePrecise(scene.start)}</span>
        <span>Kết thúc: {formatTimePrecise(scene.end)}</span>
        <span>Thời lượng: {(scene.end - scene.start).toFixed(2)}s</span>
        <span>
          Focus: {draft.motion.focusPoint.x.toFixed(2)}, {draft.motion.focusPoint.y.toFixed(2)}
        </span>
      </div>

      <Field label="Mức chuyển động">
        <select
          className="input w-full"
          disabled={locked}
          value={draft.motion.level}
          onChange={(e) => {
            const level = e.target.value as MotionLevel
            setDraft({ ...draft, motion: { ...draft.motion, level, type: TYPES_BY_LEVEL[level][0] } })
          }}
        >
          <option value="kenBurns">Mức 1 – Ken Burns (miễn phí)</option>
          <option value="parallax">Mức 2 – Parallax 2.5D (local){layers ? '' : ' – chưa tách lớp'}</option>
          <option value="aiVideo">Mức 3 – Video AI{clip ? '' : ' – chưa có clip'}</option>
        </select>
      </Field>
      {draft.motion.level === 'parallax' ? (
        <div className="space-y-1 text-[11px]">
          {layers ? (
            <div className="text-teal-300">
              ✓ Đã tách 3 lớp ({layers.depthSource === 'model' ? 'depth từ model' : 'depth ước lượng – tải model ở Cài đặt để chính xác hơn'})
            </div>
          ) : (
            <div className="text-amber-300">Chưa có lớp parallax cho khung {aspect} – xem trước/render sẽ dùng Ken Burns.</div>
          )}
          <AsyncButton
            className="btn-secondary px-2 py-1 text-xs"
            disabled={locked || !bank?.media[aspect]}
            onClick={async () => {
              await window.api.invoke('scene:computeParallax', story.id, scene.sceneBankId, aspect)
              await useApp.getState().refresh()
            }}
          >
            {layers ? 'Tách lại lớp' : 'Tách lớp parallax'} (depth map local)
          </AsyncButton>
        </div>
      ) : null}
      {draft.motion.level === 'aiVideo' ? (
        <div className="space-y-1 text-[11px]">
          {clip ? (
            <video src={mediaUrl(clip.path, clip.createdAt)} className="w-full rounded border border-ink-600" style={{ maxHeight: 150 }} muted loop autoPlay />
          ) : (
            <div className="text-amber-300">Chưa có clip video AI khung {aspect} – xem trước/render sẽ dùng Ken Burns.</div>
          )}
          <AsyncButton
            className="btn-secondary px-2 py-1 text-xs"
            disabled={locked || !bank?.media[aspect]}
            confirm={`Tạo clip video AI cho cảnh này (${providerLabel}, ${quote}) qua hàng đợi Film Studio?`}
            onClick={async () => {
              const r = await window.api.invoke('scene:generateHeroClip', story.id, scene.sceneBankId, aspect)
              useApp.getState().toast(`Đã đưa vào hàng chờ (${r.cost > 0 ? `~$${r.cost.toFixed(2)}` : 'miễn phí'}) – xem Film Studio`, 'info')
            }}
          >
            {clip ? 'Tạo lại clip' : 'Tạo clip video AI'} · {quote}
          </AsyncButton>
        </div>
      ) : null}
      <Field label="Kiểu chuyển động">
        <select
          className="input w-full"
          disabled={locked || draft.motion.level === 'aiVideo'}
          value={draft.motion.type}
          onChange={(e) => setDraft({ ...draft, motion: { ...draft.motion, type: e.target.value as MotionType } })}
        >
          {TYPES_BY_LEVEL[draft.motion.level].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Cường độ: ${draft.motion.intensity.toFixed(2)}`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          disabled={locked}
          className="w-full accent-blood-500"
          value={draft.motion.intensity}
          onChange={(e) => setDraft({ ...draft, motion: { ...draft.motion, intensity: Number(e.target.value) } })}
        />
      </Field>
      <Field label="Easing">
        <select
          className="input w-full"
          disabled={locked}
          value={draft.motion.easing}
          onChange={(e) => setDraft({ ...draft, motion: { ...draft.motion, easing: e.target.value as Easing } })}
        >
          {EASINGS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Chuyển cảnh vào">
        <div className="flex gap-2">
          <select
            className="input flex-1"
            disabled={locked}
            value={draft.transition.type}
            onChange={(e) =>
              setDraft({ ...draft, transition: { ...draft.transition, type: e.target.value as TransitionType } })
            }
          >
            {TRANSITIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            disabled={locked}
            className="input w-20"
            value={draft.transition.durationSec}
            onChange={(e) =>
              setDraft({ ...draft, transition: { ...draft.transition, durationSec: Number(e.target.value) } })
            }
          />
        </div>
      </Field>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          className="accent-blood-500"
          disabled={locked}
          checked={draft.isHero}
          onChange={(e) => setDraft({ ...draft, isHero: e.target.checked })}
        />
        Cảnh hero (video AI – GĐ4)
      </label>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={!dirty || locked} onClick={save}>
          Lưu cảnh
        </button>
        <button className="btn-secondary" disabled={!dirty} onClick={() => setDraft(scene)}>
          Hoàn tác
        </button>
      </div>
      {locked ? <div className="text-[11px] text-amber-300">Đang chạy pipeline – đợi tới điểm duyệt để chỉnh.</div> : null}
    </div>
  )
}
