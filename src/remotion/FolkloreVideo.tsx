import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion'
import type { CompositionProps } from '../shared/composition'
import { SceneLayer } from './SceneLayer'
import { SubtitleLayer } from './SubtitleLayer'
import { EndCard, GlossaryCards, HookCard, PartBadge, Vignette } from './Overlays'

export const FolkloreVideo: React.FC<CompositionProps> = (props) => {
  const { fps } = useVideoConfig()

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {props.scenes.map((scene, i) => {
        const next = props.scenes[i + 1]
        const from = Math.round(scene.startSec * fps)
        const end = Math.round(scene.endSec * fps)
        // Cảnh kế tiếp "fade" ⇒ kéo dài cảnh này thêm một đoạn để 2 cảnh chồng lên nhau
        const overlap = next && next.transition.type === 'fade' ? Math.round(next.transition.durationSec * fps) : 0
        const duration = Math.max(1, end - from + overlap)
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} name={`Cảnh ${i + 1}`}>
            <SceneLayer scene={scene} durationInFrames={duration} parallaxFactors={props.parallaxFactors ?? [0.2, 0.55, 1]} />
          </Sequence>
        )
      })}
      <Vignette />
      {props.voiceSrc ? <Audio src={props.voiceSrc} /> : null}
      {props.subtitleStyle ? <SubtitleLayer cues={props.subtitles} style={props.subtitleStyle} /> : null}
      <GlossaryCards cards={props.glossaryCards} />
      {props.partLabel ? <PartBadge label={props.partLabel} /> : null}
      {props.hookCard ? <HookCard text={props.hookCard.text} untilSec={props.hookCard.untilSec} /> : null}
      {props.endCard ? <EndCard title={props.endCard.title} sub={props.endCard.sub} fromSec={props.endCard.fromSec} /> : null}
    </AbsoluteFill>
  )
}
