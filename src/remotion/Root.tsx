import { Composition } from 'remotion'
import { FolkloreVideo } from './FolkloreVideo'
import { COMPOSITION_ID, DEFAULT_COMPOSITION_PROPS, type CompositionProps } from '../shared/composition'

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={FolkloreVideo}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={DEFAULT_COMPOSITION_PROPS}
      // Kích thước, fps, thời lượng lấy từ props ⇒ một composition cho cả 16:9 và 9:16
      calculateMetadata={({ props }: { props: CompositionProps }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height
      })}
    />
  )
}
