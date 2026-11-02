import { useState } from 'react'
import { platformsConfig } from '../../../../shared/config'
import type { Language, Platform } from '../../../../shared/types'
import { AsyncButton, Modal, Num, Select } from '../../components/forms'
import { useApp } from '../../store/appStore'

/** Thêm bản phát hành: kịch bản sẽ được LLM chuyển thể ở bước 8 của pipeline */
export function AddReleaseModal({
  storyId,
  onClose,
  preset
}: {
  storyId: string
  onClose: () => void
  /** Chọn sẵn nền tảng/ngôn ngữ (vd từ gợi ý "Chuyển thể sang YouTube tiếng Anh") */
  preset?: { platform: Platform; language: Language }
}): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const selectRelease = useApp((s) => s.selectRelease)
  const setScreen = useApp((s) => s.setScreen)
  const [platform, setPlatform] = useState<Platform>(preset?.platform ?? 'youtube')
  const [language, setLanguage] = useState<Language>(preset?.language ?? 'en')
  const [minutes, setMinutes] = useState(15)
  const [parts, setParts] = useState(3)
  const pd = platformsConfig.platforms[platform]
  const series = pd.partDurationSec != null

  return (
    <Modal title={preset ? 'Chuyển thể sang YouTube tiếng Anh' : 'Thêm bản phát hành'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Nền tảng"
            value={platform}
            onChange={(p) => {
              setPlatform(p)
              setLanguage(p === 'tiktok' ? 'vi' : 'en')
            }}
            options={[
              { value: 'youtube', label: 'YouTube (16:9)' },
              { value: 'tiktok', label: 'TikTok (9:16, chia phần)' },
              { value: 'youtubeShorts', label: 'YouTube Shorts (9:16)' }
            ]}
          />
          <Select
            label="Ngôn ngữ"
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'vi', label: 'Tiếng Việt' },
              { value: 'en', label: 'Tiếng Anh' }
            ]}
          />
        </div>
        {series ? (
          <Num label={`Số phần dự kiến (~${pd.partDurationSec}s/phần)`} value={parts} onChange={setParts} min={1} max={10} />
        ) : (
          <Num
            label={`Độ dài mục tiêu (phút, gợi ý ${Math.round(pd.targetDurationSec.min / 60)}–${Math.round(pd.targetDurationSec.max / 60)})`}
            value={minutes}
            onChange={setMinutes}
            min={1}
            max={60}
          />
        )}
        <p className="text-[11px] text-slate-500">
          Cấu trúc: {pd.structure.join(' → ')}. {series ? 'LLM viết toàn bộ truyện rồi tự chia phần theo thời lượng thật; mỗi phần có móc mở đầu và câu treo.' : ''}
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Huỷ
          </button>
          <AsyncButton
            className="btn-primary"
            onClick={async () => {
              const rel = await window.api.invoke('release:create', storyId, {
                platform,
                language,
                targetDurationSec: Math.round(minutes * 60),
                plannedParts: parts
              })
              await refresh()
              selectRelease(rel.id)
              setScreen('autoedit')
              onClose()
            }}
          >
            Thêm & mở AutoEdit
          </AsyncButton>
        </div>
      </div>
    </Modal>
  )
}
