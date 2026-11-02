import { useMemo } from 'react'
import { buildCompositionProps, type CompositionProps } from '../../../shared/composition'
import { platformsConfig } from '../../../shared/config'
import { buildMediaUrl } from '../../../shared/media'
import type { AspectRatio, Release, Story } from '../../../shared/types'
import { useApp } from '../store/appStore'

/** URL media của Story (qua media server nội bộ) */
export function useMediaUrl(storyId: string | undefined): (rel: string, v?: string) => string {
  const base = useApp((s) => s.appInfo?.mediaBaseUrl ?? '')
  return useMemo(() => (rel: string, v?: string) => (storyId ? buildMediaUrl(base, storyId, rel, v) : ''), [base, storyId])
}

/** URL ảnh nhân vật (thư mục dùng chung _characters) */
export function useCharacterUrl(): (rel: string | null | undefined) => string | null {
  const base = useApp((s) => s.appInfo?.mediaBaseUrl ?? '')
  return useMemo(() => (rel) => (rel ? buildMediaUrl(base, '_characters', rel) : null), [base])
}

/** Props cho Remotion Player – cùng hàm với lúc render ⇒ xem trước khớp với video xuất ra */
export function usePreviewProps(
  story: Story | null,
  release: Release | null,
  aspect: AspectRatio
): CompositionProps | null {
  const library = useApp((s) => s.library)
  const mediaUrl = useMediaUrl(story?.id)
  return useMemo(() => {
    if (!story || !release || !library || release.scenes.length === 0) return null
    const channel = library.channelPresets.find((c) => c.id === story.channelPresetId)
    return buildCompositionProps({
      story,
      release,
      glossary: library.pronunciations.filter((p) => p.language === release.language),
      subtitleStyle: channel?.subtitleStyleByPlatform[release.platform] ?? null,
      mediaUrl,
      fps: platformsConfig.fps,
      sizes: platformsConfig.aspectSizes,
      aspect,
      parallaxFactors: platformsConfig.parallax.layerFactors
    })
  }, [story, release, library, mediaUrl, aspect])
}
