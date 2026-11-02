import { useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { FolkloreVideo } from '../../../remotion/FolkloreVideo'
import type { AspectRatio } from '../../../shared/types'
import { Empty } from '../components/ui'
import { usePreviewProps } from '../lib/preview'
import { useApp, useCurrentRelease, useCurrentStory } from '../store/appStore'
import { ProgressHeader, StepList } from './autoedit/ProgressHeader'
import { RunPanel } from './autoedit/RunPanel'
import { ScenePanel } from './autoedit/ScenePanel'
import { SoundCuePanel } from './autoedit/SoundCuePanel'
import { Timeline } from './autoedit/Timeline'

export function AutoEditScreen(): JSX.Element {
  const story = useCurrentStory()
  const release = useCurrentRelease()
  const [aspect, setAspect] = useState<AspectRatio>(release?.aspectRatio ?? '16:9')
  const playerRef = useRef<PlayerRef>(null)
  const props = usePreviewProps(story, release, aspect)
  const selectScene = useApp((s) => s.selectScene)
  const selectedCueId = useApp((s) => s.selectedCueId)

  // Đổi Release ⇒ khung xem trước mặc định theo Release
  useEffect(() => {
    if (release) setAspect(release.aspectRatio)
  }, [release?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!story || !release) return <Empty>Chọn Story và bản phát hành ở thanh trên.</Empty>

  const state = release.pipelineState
  const durationInFrames = props ? Math.max(1, Math.round(props.durationSec * props.fps)) : 1

  return (
    <div className="grid h-full min-h-0 grid-cols-[250px_minmax(0,1fr)_290px] grid-rows-[minmax(0,1fr)_230px]">
      {/* TRÁI */}
      <aside className="row-span-1 border-r border-ink-700 bg-ink-850">
        <RunPanel key={release.id} release={release} />
      </aside>

      {/* GIỮA */}
      <main className="flex min-h-0 flex-col gap-3 overflow-hidden p-4">
        <div className="panel p-3">
          <ProgressHeader state={state} />
        </div>
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="panel w-64 shrink-0 overflow-auto p-2">
            <StepList state={state} />
          </div>
          <div className="panel flex min-w-0 flex-1 flex-col p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="panel-title">Xem trước (Remotion Player)</span>
              <div className="flex overflow-hidden rounded-md border border-ink-500">
                {(['16:9', '9:16'] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setAspect(a)}
                    className={`px-3 py-1 text-xs ${aspect === a ? 'bg-blood-600 text-white' : 'bg-ink-700 text-slate-300 hover:bg-ink-600'}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded bg-black">
              {props ? (
                <Player
                  ref={playerRef}
                  component={FolkloreVideo}
                  inputProps={props}
                  durationInFrames={durationInFrames}
                  fps={props.fps}
                  compositionWidth={props.width}
                  compositionHeight={props.height}
                  controls
                  acknowledgeRemotionLicense
                  clickToPlay
                  style={
                    aspect === '16:9'
                      ? { width: '100%', maxHeight: '100%', aspectRatio: '16 / 9' }
                      : { height: '100%', maxWidth: '100%', aspectRatio: '9 / 16' }
                  }
                />
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">
                  Chưa có dữ liệu xem trước.
                  <br />
                  Chạy pipeline tới bước 14 (Khớp cảnh) để xem trước; tới bước 19 sẽ có phụ đề.
                </div>
              )}
            </div>
            {aspect !== release.aspectRatio ? (
              <div className="mt-1 text-[11px] text-amber-300">
                Đang xem khung {aspect} khác với khung của bản phát hành ({release.aspectRatio}) – chỉ để tham khảo.
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {/* PHẢI */}
      <aside className="row-span-1 border-l border-ink-700 bg-ink-850">
        {selectedCueId && release.soundCues.some((c) => c.id === selectedCueId) ? (
          <SoundCuePanel story={story} release={release} />
        ) : (
          <ScenePanel story={story} release={release} />
        )}
      </aside>

      {/* DƯỚI */}
      <section className="col-span-3 border-t border-ink-700 bg-ink-850" onDoubleClick={() => selectScene(null)}>
        <Timeline story={story} release={release} playerRef={playerRef} fps={props?.fps ?? 30} />
      </section>
    </div>
  )
}
