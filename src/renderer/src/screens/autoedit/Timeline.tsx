import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PlayerRef } from '@remotion/player'
import { dragCue, lineGapSnapPoints, moveSceneBoundary, snap, type CueDragMode } from '../../../../shared/logic/timelineEdit'
import type { Release, ReleaseScene, SoundCue, Story } from '../../../../shared/types'
import { AsyncButton } from '../../components/forms'
import { errorMessage, formatTime, SHOT_LABEL } from '../../lib/format'
import { useApp } from '../../store/appStore'

const TRACK_H = 30
const LABEL_W = 92

const LEVEL_COLOR: Record<string, string> = {
  kenBurns: 'border-night-600 bg-night-700/70',
  parallax: 'border-teal-700 bg-teal-900/60',
  aiVideo: 'border-amber-600 bg-amber-900/50'
}

/** Vạch phát – tự lắng nghe Player để không render lại cả timeline mỗi khung hình */
function Playhead({ playerRef, fps, pxPerSec, onFrame }: { playerRef: RefObject<PlayerRef | null>; fps: number; pxPerSec: number; onFrame: (f: number) => void }): JSX.Element {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    const h = (e: { detail: { frame: number } }): void => {
      setFrame(e.detail.frame)
      onFrame(e.detail.frame)
    }
    p.addEventListener('frameupdate', h)
    return () => p.removeEventListener('frameupdate', h)
  }, [playerRef, onFrame])
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-blood-400" style={{ left: LABEL_W + (frame / fps) * pxPerSec }}>
      <div className="absolute -left-1.5 top-0 h-3 w-3 rotate-45 bg-blood-400" />
    </div>
  )
}

/** Waveform của voice track (đỉnh biên độ tính ở main) */
function VoiceWave({ storyId, relPath, duration, pxPerSec }: { storyId: string; relPath: string | null; duration: number; pxPerSec: number }): JSX.Element | null {
  const [peaks, setPeaks] = useState<number[]>([])
  useEffect(() => {
    if (!relPath) return
    let alive = true
    void window.api
      .invoke('voice:peaks', storyId, relPath, Math.min(4000, Math.max(200, Math.round(duration * 8))))
      .then((p) => alive && setPeaks(p))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [storyId, relPath, duration])
  if (!peaks.length) return null
  const w = duration * pxPerSec
  const bw = w / peaks.length
  const peak = Math.max(0.001, ...peaks)
  return (
    <svg className="pointer-events-none absolute left-0 top-0" width={w} height={TRACK_H}>
      {peaks.map((p, i) => {
        const h = Math.max(1, (p / peak) * (TRACK_H - 6))
        return <rect key={i} x={i * bw} y={(TRACK_H - h) / 2} width={Math.max(0.6, bw - 0.3)} height={h} fill="#10b981" opacity={0.45} />
      })}
    </svg>
  )
}

type Drag =
  | { kind: 'boundary'; index: number; x0: number; orig: ReleaseScene[] }
  | { kind: 'cue'; id: string; mode: CueDragMode; x0: number; orig: SoundCue }

export function Timeline({ story, release, playerRef, fps }: { story: Story; release: Release; playerRef: RefObject<PlayerRef | null>; fps: number }): JSX.Element {
  const [pxPerSec, setPxPerSec] = useState(14)
  const selectedSceneId = useApp((s) => s.selectedSceneId)
  const selectedCueId = useApp((s) => s.selectedCueId)
  const selectScene = useApp((s) => s.selectScene)
  const selectCue = useApp((s) => s.selectCue)
  const toast = useApp((s) => s.toast)
  const refresh = useApp((s) => s.refresh)
  const [scenes, setScenes] = useState(release.scenes)
  const [cues, setCues] = useState(release.soundCues)
  const drag = useRef<Drag | null>(null)
  const frameRef = useRef(0)
  const onFrame = useCallback((f: number) => {
    frameRef.current = f
  }, [])
  const running = !!release.pipelineState?.running

  // Đồng bộ khi dữ liệu thay đổi từ main (không ghi đè lúc đang kéo)
  useEffect(() => {
    if (!drag.current) {
      setScenes(release.scenes)
      setCues(release.soundCues)
    }
  }, [release.scenes, release.soundCues])

  const duration = release.voiceTrack?.duration ?? release.scenes[release.scenes.length - 1]?.end ?? 0
  const width = Math.max(600, duration * pxPerSec)
  const bankById = new Map(story.sceneBank.map((b) => [b.id, b]))
  const snapPts = lineGapSnapPoints(release.script.lines)
  const seek = (sec: number): void => playerRef.current?.seekTo(Math.round(sec * fps))

  const commit = async (d: Drag, nextScenes: ReleaseScene[], nextCues: SoundCue[]): Promise<void> => {
    try {
      if (d.kind === 'boundary') await window.api.invoke('release:updateScenes', story.id, release.id, nextScenes)
      else await window.api.invoke('release:updateSoundCues', story.id, release.id, nextCues)
      await refresh()
    } catch (err) {
      toast(errorMessage(err))
      setScenes(release.scenes)
      setCues(release.soundCues)
    }
  }

  useEffect(() => {
    let latestScenes = scenes
    let latestCues = cues
    const move = (e: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      const dt = (e.clientX - d.x0) / pxPerSec
      if (d.kind === 'boundary') {
        let t = d.orig[d.index].start + dt
        if (!e.altKey) t = snap(t, snapPts, 0.35)
        latestScenes = moveSceneBoundary(d.orig, d.index, t)
        setScenes(latestScenes)
      } else {
        latestCues = cues.map((c) => (c.id === d.id ? dragCue(d.orig, d.mode, dt, duration) : c))
        setCues(latestCues)
      }
    }
    const up = (): void => {
      const d = drag.current
      if (!d) return
      drag.current = null
      document.body.style.cursor = ''
      const moved = d.kind === 'boundary' ? latestScenes !== d.orig : JSON.stringify(latestCues.find((c) => c.id === d.id)) !== JSON.stringify(d.orig)
      if (moved) void commit(d, latestScenes, latestCues)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  const startDrag = (e: React.MouseEvent, d: Drag, cursor: string): void => {
    if (running) return toast('Pipeline đang chạy – đợi tới điểm duyệt để chỉnh timeline')
    e.preventDefault()
    e.stopPropagation()
    drag.current = d
    document.body.style.cursor = cursor
  }

  const cueBlock = (c: SoundCue): JSX.Element => {
    const active = c.id === selectedCueId
    const colors: Record<SoundCue['kind'], string> = {
      ambience: 'border-sky-700 bg-sky-900/50 text-sky-100',
      music: 'border-violet-700 bg-violet-900/50 text-violet-100',
      sfx: 'border-orange-700 bg-orange-900/50 text-orange-100',
      stinger: 'border-red-600 bg-red-900/60 text-red-100',
      silence: 'border-slate-500 bg-[repeating-linear-gradient(45deg,#1f2937_0,#1f2937_4px,#0b0d14_4px,#0b0d14_8px)] text-slate-300'
    }
    return (
      <div
        key={c.id}
        title={`${c.kind} · ${c.start.toFixed(2)}–${c.end.toFixed(2)}s${c.reason ? `\n${c.reason}` : ''}`}
        className={`absolute top-0.5 cursor-grab overflow-hidden rounded border px-1 text-[10px] leading-[24px] ${colors[c.kind]} ${active ? 'ring-2 ring-white' : ''}`}
        style={{ left: c.start * pxPerSec, width: Math.max(4, (c.end - c.start) * pxPerSec), height: TRACK_H - 4 }}
        onMouseDown={(e) => {
          selectCue(c.id)
          startDrag(e, { kind: 'cue', id: c.id, mode: 'move', x0: e.clientX, orig: c }, 'grabbing')
        }}
      >
        <span className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize" onMouseDown={(e) => startDrag(e, { kind: 'cue', id: c.id, mode: 'start', x0: e.clientX, orig: c }, 'ew-resize')} />
        {c.kind === 'silence' ? 'lặng' : c.kind === 'stinger' ? '⚡ ' : ''}
        {c.reason?.slice(0, 40) ?? c.assetId}
        <span className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize" onMouseDown={(e) => startDrag(e, { kind: 'cue', id: c.id, mode: 'end', x0: e.clientX, orig: c }, 'ew-resize')} />
      </div>
    )
  }

  const addCue = (kind: SoundCue['kind']): void =>
    void (async () => {
      try {
        const lib = useApp.getState().library
        const asset = lib?.soundAssets.find((a) => a.kind === kind && a.licenseConfirmed)
        if (kind !== 'silence' && !asset) return toast(`Chưa có âm thanh loại "${kind}" đã xác nhận giấy phép – thêm ở Cài đặt → Thư viện âm thanh`)
        const t = frameRef.current / fps
        const len = kind === 'silence' ? 0.8 : Math.min(asset?.durationSec || 3, kind === 'ambience' || kind === 'music' ? 20 : 3)
        const cue: SoundCue = { id: `cue-u${Date.now().toString(36)}`, kind, assetId: kind === 'silence' ? null : (asset?.id ?? null), start: Math.round(t * 100) / 100, end: Math.round(Math.min(duration, t + len) * 100) / 100, volume: kind === 'silence' ? 0 : 1, fadeIn: kind === 'ambience' ? 1 : 0, fadeOut: 0.3, reason: 'Thêm thủ công' }
        await window.api.invoke('release:updateSoundCues', story.id, release.id, [...release.soundCues, cue])
        await refresh()
        selectCue(cue.id)
      } catch (err) {
        toast(errorMessage(err))
      }
    })()

  const tracks: { label: string; content: JSX.Element | null }[] = [
    {
      label: 'Video',
      content: (
        <>
          {scenes.map((s, i) => {
            const bank = bankById.get(s.sceneBankId)
            const active = s.id === selectedSceneId
            return (
              <div key={s.id}>
                <button
                  title={`${i + 1}. ${bank?.description ?? ''}\n${s.motion.level} · ${s.motion.type} · ${s.transition.type}`}
                  onClick={() => {
                    selectScene(s.id)
                    seek(s.start)
                  }}
                  className={`absolute top-0.5 overflow-hidden rounded border px-1 text-left text-[10px] leading-[24px] text-slate-100 ${LEVEL_COLOR[s.motion.level]} ${active ? 'ring-2 ring-blood-400' : ''}`}
                  style={{ left: s.start * pxPerSec, width: Math.max(2, (s.end - s.start) * pxPerSec - 1), height: TRACK_H - 4 }}
                >
                  {s.isHero ? '★ ' : ''}
                  {i + 1} · {bank ? SHOT_LABEL[bank.shotType] : ''} · {s.motion.level === 'parallax' ? '2.5D' : s.motion.level === 'aiVideo' ? 'video AI' : s.motion.type}
                </button>
                {i > 0 ? (
                  <span
                    title="Kéo để dời biên cảnh (giữ Alt để không hút về khoảng lặng giữa câu)"
                    className="absolute top-0 z-10 h-full w-2 -translate-x-1 cursor-ew-resize hover:bg-blood-400/60"
                    style={{ left: s.start * pxPerSec }}
                    onMouseDown={(e) => startDrag(e, { kind: 'boundary', index: i, x0: e.clientX, orig: scenes }, 'ew-resize')}
                  />
                ) : null}
              </div>
            )
          })}
        </>
      )
    },
    {
      label: 'Voice',
      content: (
        <>
          <VoiceWave storyId={story.id} relPath={release.voiceTrack?.processedPath ?? null} duration={duration} pxPerSec={pxPerSec} />
          {release.script.lines
            .filter((l) => l.start != null && l.end != null)
            .map((l) => (
              <button
                key={l.id}
                title={l.text}
                onClick={() => seek(l.start ?? 0)}
                className="absolute top-0.5 overflow-hidden rounded border border-emerald-800/70 bg-transparent px-1 text-left text-[10px] leading-[24px] text-emerald-100 hover:bg-emerald-800/30"
                style={{ left: (l.start ?? 0) * pxPerSec, width: Math.max(2, ((l.end ?? 0) - (l.start ?? 0)) * pxPerSec), height: TRACK_H - 4 }}
              >
                {l.text}
              </button>
            ))}
        </>
      )
    },
    { label: 'Ambience', content: <>{cues.filter((c) => c.kind === 'ambience').map(cueBlock)}</> },
    { label: 'SFX', content: <>{cues.filter((c) => c.kind === 'sfx' || c.kind === 'stinger').map(cueBlock)}</> },
    { label: 'Music', content: <>{cues.filter((c) => c.kind === 'music' || c.kind === 'silence').map(cueBlock)}</> },
    {
      label: 'Subtitle',
      content: (
        <>
          {release.subtitles.map((c) => (
            <button
              key={c.id}
              title={c.text}
              onClick={() => seek(c.start)}
              className="absolute top-0.5 overflow-hidden rounded border border-sky-800 bg-sky-950/60 px-1 text-left text-[10px] leading-[24px] text-sky-100 hover:bg-sky-900/60"
              style={{ left: c.start * pxPerSec, width: Math.max(2, (c.end - c.start) * pxPerSec), height: TRACK_H - 4 }}
            >
              {c.text}
            </button>
          ))}
        </>
      )
    }
  ]

  const ticks: number[] = []
  const step = pxPerSec >= 40 ? 1 : pxPerSec >= 15 ? 5 : 10
  for (let t = 0; t <= duration; t += step) ticks.push(t)
  const stale = !!release.voiceTrack?.mixStale

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-600 px-3 py-1.5">
        <span className="panel-title">Timeline</span>
        <span className="text-[11px] text-slate-500">{formatTime(duration)}</span>
        {release.voiceTrack?.mixLufs != null ? <span className="text-[11px] text-slate-500">· mix {release.voiceTrack.mixLufs} LUFS</span> : null}
        <span className="ml-2 text-[11px] text-slate-500">Thêm cue tại vạch phát:</span>
        {(['ambience', 'sfx', 'stinger', 'music', 'silence'] as const).map((k) => (
          <button key={k} className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={running || !release.voiceTrack} onClick={() => addCue(k)}>
            +{k === 'silence' ? 'lặng' : k}
          </button>
        ))}
        {stale ? (
          <AsyncButton
            className="btn-primary px-2 py-0.5 text-[11px]"
            onClick={async () => {
              await window.api.invoke('audio:remix', story.id, release.id)
              await refresh()
            }}
          >
            Âm thanh đã đổi – Mix lại
          </AsyncButton>
        ) : null}
        <div className="flex-1" />
        <span className="text-[11px] text-slate-500">Zoom</span>
        <input type="range" min={4} max={120} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} className="w-36 accent-blood-500" />
      </div>
      <div className="relative flex-1 overflow-auto">
        <div className="relative" style={{ width: width + LABEL_W + 20 }}>
          <div className="sticky top-0 z-10 flex h-5 border-b border-ink-600 bg-ink-850">
            <div className="sticky left-0 z-10 shrink-0 bg-ink-850" style={{ width: LABEL_W }} />
            <div className="relative flex-1 cursor-pointer" onClick={(e) => seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / pxPerSec)}>
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 border-l border-ink-500 pl-0.5 text-[9px] text-slate-500" style={{ left: t * pxPerSec }}>
                  {formatTime(t)}
                </span>
              ))}
            </div>
          </div>
          {tracks.map((tr) => (
            <div key={tr.label} className="flex border-b border-ink-700" style={{ height: TRACK_H }}>
              <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-ink-600 bg-ink-850 px-2 text-[11px] text-slate-400" style={{ width: LABEL_W }}>
                {tr.label}
              </div>
              <div className="relative flex-1">{tr.content}</div>
            </div>
          ))}
          <Playhead playerRef={playerRef} fps={fps} pxPerSec={pxPerSec} onFrame={onFrame} />
        </div>
      </div>
    </div>
  )
}
