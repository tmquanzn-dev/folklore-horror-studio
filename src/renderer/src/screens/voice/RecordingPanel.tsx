/**
 * Giọng tự thu (Voice Studio): chọn nguồn giọng, nhập file đọc cả bài, chép lời + căn mốc (Whisper / Mock),
 * xem độ khớp. Pipeline bước 11 tự chép lời nếu chưa có; bước 12 dựng voice track từ file này.
 */
import { providersConfig } from '../../../../shared/config'
import type { Release } from '../../../../shared/types'
import { AsyncButton } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { formatTime, formatUsd } from '../../lib/format'
import { useMediaUrl } from '../../lib/preview'
import { useApp, useMockMode } from '../../store/appStore'

export function RecordingPanel({ release }: { release: Release }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useApp((s) => s.toast)
  const mock = useMockMode()
  const mediaUrl = useMediaUrl(release.storyId)
  const rec = release.recording
  const recorded = release.voiceSource === 'recorded'
  const running = !!release.pipelineState?.running
  const needTranscript = !!rec && rec.transcript?.forHash !== rec.hash
  const cost = rec && needTranscript && !mock ? (rec.duration / 60) * (providersConfig.stt.openai.pricePerMinute ?? 0.006) : 0
  const low = release.script.lines.filter((l) => l.alignConfidence != null && l.alignConfidence < 0.6).length

  const setSource = async (source: 'tts' | 'recorded'): Promise<void> => {
    await window.api.invoke('recording:setSource', release.storyId, release.id, source)
    await refresh()
  }

  return (
    <div className="space-y-2">
      <div className="panel-title">Nguồn giọng</div>
      <div className="flex rounded-md border border-ink-600 text-xs">
        {(['tts', 'recorded'] as const).map((s) => (
          <button
            key={s}
            disabled={running}
            className={`flex-1 px-2 py-1.5 ${(s === 'recorded') === recorded ? 'bg-night-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => void setSource(s).catch((e: unknown) => toast(String(e)))}
          >
            {s === 'tts' ? 'TTS từng câu' : 'Tự thu cả bài'}
          </button>
        ))}
      </div>

      {recorded ? (
        <div className="space-y-2 rounded-md border border-ink-600 bg-ink-800 p-3 text-xs">
          {rec ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Icon name="voice" className="h-4 w-4 text-blood-300" />
                <span className="min-w-0 flex-1 truncate text-slate-100" title={rec.originalName}>
                  {rec.originalName}
                </span>
                <span className="text-slate-500">{formatTime(rec.duration)}</span>
              </div>
              <audio src={mediaUrl(rec.path, rec.hash.slice(0, 8))} controls className="h-8 w-full" />
              {rec.transcript && !needTranscript ? (
                <div className={rec.coverage != null && rec.coverage < 0.7 ? 'text-amber-300' : 'text-emerald-300'}>
                  Đã căn mốc: khớp {Math.round((rec.coverage ?? 0) * 100)}% từ kịch bản
                  {rec.extraWords ? ` · ${rec.extraWords} từ đọc thừa` : ''}
                  {low ? ` · ${low} câu khớp kém (đánh dấu đỏ)` : ''}
                  <span className="block text-slate-500">
                    {rec.transcript.provider} · {new Date(rec.transcript.createdAt).toLocaleString('vi-VN')}
                  </span>
                </div>
              ) : (
                <div className="text-slate-400">Chưa chép lời file này. Pipeline bước 11 sẽ tự làm, hoặc bấm bên dưới để xem trước độ khớp.</div>
              )}
            </>
          ) : (
            <p className="text-slate-400">
              Đọc toàn bộ kịch bản thành 1 file (wav/mp3/m4a…). App chép lời bằng Whisper rồi căn mốc từng câu, từng từ với kịch bản – phụ đề vẫn lấy chữ từ kịch bản.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <AsyncButton
              className="btn-secondary px-2 py-1 text-xs"
              disabled={running}
              onClick={async () => {
                const r = await window.api.invoke('recording:import', release.storyId, release.id)
                if (r) await refresh()
              }}
            >
              {rec ? 'Đổi file' : 'Nhập file tự thu'}
            </AsyncButton>
            {rec ? (
              <AsyncButton
                className="btn-primary px-2 py-1 text-xs"
                disabled={running}
                confirm={cost > 0 ? `Chép lời ${formatTime(rec.duration)} bằng OpenAI Whisper, ước tính ${formatUsd(cost)}. Tiếp tục?` : undefined}
                onClick={async () => {
                  const r = await window.api.invoke('recording:transcribe', release.storyId, release.id, false)
                  await refresh()
                  toast(`Căn mốc xong: khớp ${Math.round(r.coverage * 100)}% từ${r.lowLines ? `, ${r.lowLines} câu cần nghe lại` : ''}${r.cost ? ` · ${formatUsd(r.cost)}` : ''}`, 'info')
                }}
              >
                Chép lời & căn mốc {mock ? '(Mock)' : needTranscript ? `(~${formatUsd(cost)})` : '(dùng lại bản chép lời)'}
              </AsyncButton>
            ) : null}
          </div>
          <p className="text-[11px] text-slate-500">
            Sửa kịch bản sau khi căn mốc ⇒ bấm lại (không tốn phí – dùng lại bản chép lời). Đổi file ⇒ phải chép lời lại.
          </p>
        </div>
      ) : null}
    </div>
  )
}
