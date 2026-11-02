/**
 * "Dấu vân tay" của bản render: hash mọi thứ đi vào composition (cảnh, chuyển động, phụ đề, giọng + phiên bản mix,
 * sound cue…) cộng nội dung kịch bản. Lưu lúc render; so lại lúc kiểm tra checklist ⇒ biết bản MP4 đã cũ hay chưa.
 * Không dùng mtime vs release.updatedAt: updatedAt đổi cả khi chỉ sửa gói xuất bản / checklist ⇒ báo cũ sai.
 */
import { createHash } from 'node:crypto'
import { buildCompositionProps } from '../../shared/composition'
import { platformsConfig } from '../../shared/config'
import type { Library, Release, Story } from '../../shared/types'

export function renderFingerprint(story: Story, release: Release, lib: Library): string {
  const channel = lib.channelPresets.find((c) => c.id === story.channelPresetId)
  const props = buildCompositionProps({
    story,
    release,
    glossary: lib.pronunciations.filter((p) => p.language === release.language),
    subtitleStyle: channel?.subtitleStyleByPlatform[release.platform] ?? null,
    // URL trung tính (không có cổng/token của media server – đổi mỗi lần mở app)
    mediaUrl: (rel, v) => `${rel}#${v ?? ''}`,
    sharedUrl: (rel, v) => `_characters/${rel}#${v ?? ''}`,
    puppetLib: lib,
    fps: platformsConfig.fps,
    sizes: platformsConfig.aspectSizes,
    scale: 1,
    parallaxFactors: platformsConfig.parallax.layerFactors
  })
  const script = release.script.lines.map((l) => [l.id, l.speakerId, l.text, l.selectedTakeId ?? null])
  return createHash('sha1')
    .update(JSON.stringify({ props, script, mixStale: release.voiceTrack?.mixStale ?? false }))
    .digest('hex')
}
