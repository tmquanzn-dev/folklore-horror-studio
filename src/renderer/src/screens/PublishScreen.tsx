/**
 * Màn hình Xuất bản (GĐ5): preset render, video đã xuất, gói xuất bản theo nền tảng (EN | VI),
 * thumbnail/ảnh bìa, Shorts teaser, checklist trước khi đăng.
 * App KHÔNG tự đăng bài – người dùng sao chép nội dung và tự đăng lên nền tảng.
 */
import { useCallback, useEffect, useState } from 'react'
import { platformsConfig } from '../../../shared/config'
import type { ExportFile, PublicSettings } from '../../../shared/ipc'
import type { PublishingPackage, Release, Story, ThumbnailConcept } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { Area, AsyncButton, ListText, Text } from '../components/forms'
import { Empty, LangBadge, Panel, PlatformBadge } from '../components/ui'
import { formatBytes, formatTime, formatUsd } from '../lib/format'
import { useMediaUrl } from '../lib/preview'
import { EditExportPanel } from './publish/EditExportPanel'
import { useApp, useCurrentRelease, useCurrentStory, useMockMode } from '../store/appStore'

/** Sao chép vào clipboard + toast */
function CopyBtn({ text, label = 'Sao chép' }: { text: string; label?: string }): JSX.Element {
  const toast = useApp((s) => s.toast)
  return (
    <button
      className="btn-ghost px-2 py-1 text-xs"
      disabled={!text}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => toast('Đã sao chép', 'info'),
          () => toast('Không sao chép được')
        )
      }
    >
      {label}
    </button>
  )
}

export function PublishScreen(): JSX.Element {
  const story = useCurrentStory()
  const release = useCurrentRelease()
  const runAction = useApp((s) => s.runAction)
  const [files, setFiles] = useState<ExportFile[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)

  const load = useCallback(async () => {
    if (!story || !release) return
    setFiles(await window.api.invoke('exports:list', story.id, release.id))
  }, [story, release])

  useEffect(() => {
    void load()
    void window.api.invoke('settings:get').then(setSettings)
  }, [load, release?.updatedAt])

  if (!story || !release) return <Empty>Chọn Story và bản phát hành ở thanh trên.</Empty>

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex items-center gap-2">
        <LangBadge language={release.language} />
        <PlatformBadge platform={release.platform} />
        <h2 className="text-lg font-semibold text-slate-100">{release.title}</h2>
        {release.partCount > 1 ? <span className="chip">Phần {release.partIndex}/{release.partCount}</span> : null}
      </div>

      <PackagePanel story={story} release={release} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ThumbnailPanel story={story} release={release} />
        <ChecklistPanel story={story} release={release} />
      </div>

      {release.platform === 'youtube' ? <ShortsPanel story={story} release={release} onDone={load} /> : null}

      <Panel
        title="Video đã xuất"
        actions={
          <>
            <button className="btn-ghost text-xs" onClick={() => void load()}>
              <Icon name="refresh" className="h-4 w-4" /> Làm mới
            </button>
            <button className="btn-secondary text-xs" onClick={() => void runAction(() => window.api.invoke('exports:openFolder', story.id, release.id))}>
              <Icon name="folder" className="h-4 w-4" /> Mở thư mục
            </button>
          </>
        }
      >
        {files.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có video. Chạy pipeline trong AutoEdit tới bước 21 (Render MP4).</p>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 rounded-md border border-ink-600 bg-ink-850 p-3 text-sm">
                <Icon name="film" className="h-5 w-5 text-blood-300" />
                <span className="min-w-0 flex-1 truncate text-slate-200">{f.name}</span>
                {f.name.includes('_shorts_teaser_') ? <span className="chip">Shorts teaser</span> : null}
                <span className="text-xs text-slate-500">{formatBytes(f.sizeBytes)}</span>
                <span className="text-xs text-slate-500">{new Date(f.modifiedAt).toLocaleString('vi-VN')}</span>
                <button className="btn-secondary px-2 py-1 text-xs" onClick={() => void runAction(() => window.api.invoke('exports:openFile', story.id, release.id, f.name))}>
                  <Icon name="play" className="h-3.5 w-3.5" /> Mở
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <EditExportPanel release={release} />

      <Panel title="Preset render">
        <div className="flex flex-wrap gap-2">
          {platformsConfig.renderPresets.map((p) => (
            <button
              key={p.id}
              className={settings?.renderPresetId === p.id ? 'btn-primary' : 'btn-secondary'}
              onClick={() => void runAction(async () => setSettings(await window.api.invoke('settings:update', { renderPresetId: p.id })))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Áp dụng cho lần render tiếp theo (bước 21) và Shorts teaser. Khung {release.aspectRatio} lấy theo bản phát hành. Mỗi lần render ghi{' '}
          <span className="font-mono">sources.json</span> (nguồn media, giọng, giấy phép âm thanh, nhãn AI).
        </p>
      </Panel>
    </div>
  )
}

// ============================================================================ Gói xuất bản

function PackagePanel({ story, release }: { story: Story; release: Release }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const mock = useMockMode()
  const pkg = release.publishing
  // Bản nháp chỉnh tay – đồng bộ lại khi gói trên đĩa đổi (soạn lại / pipeline bước 22)
  const [draft, setDraft] = useState<PublishingPackage | null>(pkg)
  const [lang, setLang] = useState<'main' | 'vi'>('main')
  useEffect(() => setDraft(release.publishing), [release.publishing])

  const dirty = JSON.stringify(draft) !== JSON.stringify(pkg)
  const save = async (): Promise<void> => {
    if (!draft) return
    await window.api.invoke('publish:update', story.id, release.id, draft)
    await refresh()
  }
  const generate = async (): Promise<void> => {
    await window.api.invoke('publish:generate', story.id, release.id)
    await refresh()
  }

  const actions = (
    <>
      {dirty ? (
        <AsyncButton className="btn-primary text-xs" onClick={save}>
          Lưu thay đổi
        </AsyncButton>
      ) : null}
      <AsyncButton
        className="btn-secondary text-xs"
        onClick={generate}
        confirm={pkg ? 'Soạn lại gói xuất bản bằng LLM? Nội dung đã chỉnh tay sẽ bị thay thế (thumbnail, checklist tay được giữ).' : undefined}
      >
        <Icon name="refresh" className="h-4 w-4" /> {pkg ? 'Soạn lại' : 'Soạn gói xuất bản'}
        {mock ? ' (Mock)' : ' (~$0.01)'}
      </AsyncButton>
    </>
  )

  if (!draft) {
    return (
      <Panel title="Gói xuất bản" actions={actions}>
        <p className="text-sm text-slate-500">
          Chưa có gói xuất bản. Pipeline bước 22 tự soạn, hoặc bấm "Soạn gói xuất bản". Cần kịch bản đã chuyển thể (bước 8).
        </p>
      </Panel>
    )
  }

  const yt = draft.youtube
  const tt = draft.tiktok
  const en = release.language === 'en'

  return (
    <Panel
      title={`Gói xuất bản ${release.platform === 'tiktok' ? 'TikTok' : 'YouTube'}`}
      actions={
        <>
          {en && yt ? (
            <div className="flex rounded-md border border-ink-600 text-xs">
              <button className={`px-2 py-1 ${lang === 'main' ? 'bg-ink-600 text-slate-100' : 'text-slate-400'}`} onClick={() => setLang('main')}>
                EN
              </button>
              <button className={`px-2 py-1 ${lang === 'vi' ? 'bg-ink-600 text-slate-100' : 'text-slate-400'}`} onClick={() => setLang('vi')}>
                VI (tham khảo)
              </button>
            </div>
          ) : null}
          {actions}
        </>
      }
    >
      {draft.aiDisclosureNeeded ? (
        <div className="mb-4 flex gap-2 rounded-md border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-200">
          <Icon name="warn" className="h-4 w-4 shrink-0" />
          Video có giọng/hình/video do AI tạo – khi đăng hãy bật nhãn nội dung AI (YouTube: "Altered or synthetic content"; TikTok: "AI-generated content").
        </div>
      ) : null}

      {yt ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Tiêu đề (chọn 1)</span>
            </div>
            <div className="space-y-1.5">
              {yt.titleOptions.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  {lang === 'vi' ? (
                    <div className="flex-1 rounded border border-ink-600 bg-ink-850 px-2 py-1.5 text-sm text-slate-300">{yt.titleOptionsVi[i] ?? '—'}</div>
                  ) : (
                    <Text
                      value={t}
                      onChange={(v) => setDraft({ ...draft, youtube: { ...yt, titleOptions: yt.titleOptions.map((x, j) => (j === i ? v : x)) } })}
                    />
                  )}
                  <span className={`w-12 text-right text-[10px] ${t.length > 100 ? 'text-red-400' : 'text-slate-500'}`}>{t.length}/100</span>
                  <CopyBtn text={t} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Mô tả (chapters + glossary + nguồn truyền thuyết) · {yt.description.length}/5000
              </span>
              <CopyBtn text={lang === 'vi' ? yt.descriptionVi : yt.description} />
            </div>
            {lang === 'vi' ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-ink-600 bg-ink-850 p-3 text-xs text-slate-300">{yt.descriptionVi || '—'}</pre>
            ) : (
              <Area value={yt.description} onChange={(v) => setDraft({ ...draft, youtube: { ...yt, description: v } })} rows={12} className="font-mono text-xs" />
            )}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <ListText label={`Tags (${yt.tags.join(',').length}/500 ký tự)`} value={yt.tags} onChange={(v) => setDraft({ ...draft, youtube: { ...yt, tags: v } })} />
            </div>
            <CopyBtn text={yt.tags.join(', ')} />
          </div>

          {yt.shortsHook ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded border border-ink-600 bg-ink-850 p-2">
                <div className="text-[10px] uppercase text-slate-500">Móc Shorts</div>
                <div className="text-slate-200">{yt.shortsHook}</div>
                {yt.shortsHookVi ? <div className="text-slate-500">{yt.shortsHookVi}</div> : null}
              </div>
              <div className="rounded border border-ink-600 bg-ink-850 p-2">
                <div className="text-[10px] uppercase text-slate-500">Lời kêu gọi xem bản dài</div>
                <div className="text-slate-200">{yt.shortsCta}</div>
                {yt.shortsCtaVi ? <div className="text-slate-500">{yt.shortsCtaVi}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tt ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Caption tiếng Việt · {tt.captionVi.length}/2200</span>
              <CopyBtn text={`${tt.captionVi}\n\n${tt.hashtags.join(' ')}`} label="Sao chép caption + hashtag" />
            </div>
            <Area value={tt.captionVi} onChange={(v) => setDraft({ ...draft, tiktok: { ...tt, captionVi: v } })} rows={4} />
          </div>
          <div className="grid grid-cols-[1fr_200px] gap-3">
            <ListText label="Hashtag" value={tt.hashtags} onChange={(v) => setDraft({ ...draft, tiktok: { ...tt, hashtags: v } })} />
            <Text label="Nhãn phần" value={tt.partLabel} onChange={(v) => setDraft({ ...draft, tiktok: { ...tt, partLabel: v } })} />
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-[11px] text-slate-500">
        Soạn lúc {new Date(draft.generatedAt).toLocaleString('vi-VN')}. App không tự đăng bài – sao chép nội dung và đăng thủ công.
      </p>
    </Panel>
  )
}

// ============================================================================ Thumbnail / ảnh bìa

function ThumbnailPanel({ story, release }: { story: Story; release: Release }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useApp((s) => s.toast)
  const mediaUrl = useMediaUrl(story.id)
  const pkg = release.publishing
  const yt = release.platform !== 'tiktok'
  const concepts: ThumbnailConcept[] = (yt ? pkg?.youtube?.thumbnailConcepts : pkg?.tiktok?.coverConcepts) ?? []
  const thumbs = pkg?.thumbnails ?? []
  const [text, setText] = useState('')

  const select = async (path: string): Promise<void> => {
    if (!pkg) return
    await window.api.invoke('publish:update', story.id, release.id, { ...pkg, selectedThumbnail: path })
    await refresh()
  }

  return (
    <Panel title={yt ? 'Thumbnail YouTube (1280×720)' : 'Ảnh bìa TikTok (1080×1920)'}>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Text label="Chữ trên ảnh (để trống = lấy từ ý tưởng)" value={text} onChange={setText} placeholder="VD: ĐỪNG NHÌN VÀO GƯƠNG" />
        </div>
        <AsyncButton
          className="btn-secondary text-xs"
          title="Ghép chữ lên ảnh cảnh có sẵn – miễn phí"
          onClick={async () => {
            await window.api.invoke('publish:quickThumbnail', story.id, release.id, { text: text.trim() || undefined })
            await refresh()
          }}
        >
          Tạo nhanh từ cảnh
        </AsyncButton>
      </div>

      {concepts.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Ý tưởng từ gói xuất bản</div>
          {concepts.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded border border-ink-600 bg-ink-850 p-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-100">{c.text}</div>
                {c.textVi ? <div className="text-slate-500">{c.textVi}</div> : null}
                <div className="mt-0.5 text-slate-400">{c.visual}</div>
              </div>
              <AsyncButton
                className="btn-ghost px-2 py-1 text-xs"
                onClick={async () => {
                  const r = await window.api.invoke('publish:aiThumbnail', story.id, release.id, i)
                  toast(`Đã đưa vào hàng đợi ảnh (ước tính ${formatUsd(r.cost)}) – theo dõi ở Film Studio`, 'info')
                }}
              >
                Tạo bằng AI
              </AsyncButton>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {thumbs.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có thumbnail.</p>
        ) : (
          <div className={`grid gap-2 ${yt ? 'grid-cols-2' : 'grid-cols-4'}`}>
            {thumbs.map((t) => {
              const sel = pkg?.selectedThumbnail === t.path
              return (
                <button
                  key={t.path}
                  onClick={() => void select(t.path).catch((e: unknown) => toast(String(e)))}
                  className={`relative overflow-hidden rounded border-2 ${sel ? 'border-blood-500' : 'border-ink-600 hover:border-ink-400'}`}
                  title={`${t.provider} · ${new Date(t.createdAt).toLocaleString('vi-VN')}`}
                >
                  <img src={mediaUrl(t.path, t.createdAt)} alt="" className={`w-full object-cover ${yt ? 'aspect-video' : 'aspect-[9/16]'}`} loading="lazy" />
                  {sel ? (
                    <span className="absolute left-1 top-1 rounded bg-blood-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Đã chọn</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Panel>
  )
}

// ============================================================================ Checklist

function ChecklistPanel({ story, release }: { story: Story; release: Release }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useApp((s) => s.toast)
  const pkg = release.publishing
  const list = pkg?.checklist ?? []
  const doneCount = list.filter((c) => c.done).length

  const toggle = async (id: string): Promise<void> => {
    if (!pkg) return
    await window.api.invoke('publish:update', story.id, release.id, {
      ...pkg,
      checklist: pkg.checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c))
    })
    await refresh()
  }

  return (
    <Panel
      title={`Checklist trước khi đăng${list.length ? ` (${doneCount}/${list.length})` : ''}`}
      actions={
        pkg ? (
          <AsyncButton
            className="btn-ghost text-xs"
            onClick={async () => {
              await window.api.invoke('publish:refreshChecklist', story.id, release.id)
              await refresh()
            }}
          >
            <Icon name="refresh" className="h-4 w-4" /> Kiểm tra lại
          </AsyncButton>
        ) : null
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">Checklist có sau khi soạn gói xuất bản.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <button
                disabled={c.auto}
                onClick={() => void toggle(c.id).catch((e: unknown) => toast(String(e)))}
                title={c.auto ? 'Tự kiểm tra – bấm "Kiểm tra lại" sau khi sửa' : 'Đánh dấu thủ công'}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  c.done ? 'border-emerald-600 bg-emerald-700 text-white' : c.auto ? 'border-red-700 bg-red-950/50' : 'border-ink-400 hover:border-slate-300'
                }`}
              >
                {c.done ? <Icon name="check" className="h-3 w-3" /> : null}
              </button>
              <div className="min-w-0">
                <span className={c.done ? 'text-slate-300' : 'text-slate-100'}>{c.labelVi}</span>
                {c.auto ? <span className="ml-1.5 text-[10px] text-slate-500">(tự động)</span> : null}
                {c.detail ? <div className={`text-xs ${c.done ? 'text-slate-500' : 'text-amber-300'}`}>{c.detail}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ============================================================================ Shorts teaser

function ShortsPanel({ story, release, onDone }: { story: Story; release: Release; onDone: () => Promise<void> }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const mediaUrl = useMediaUrl(story.id)
  const sh = release.publishing?.shorts
  const cfg = platformsConfig.publishing.shorts
  const relPath = sh?.path ?? null

  return (
    <Panel
      title={`Shorts teaser (${cfg.minSec}–${cfg.maxSec}s, 9:16)`}
      actions={
        <AsyncButton
          className="btn-secondary text-xs"
          disabled={!release.voiceTrack?.mixedPath}
          title={release.voiceTrack?.mixedPath ? undefined : 'Cần bản mix giọng + âm thanh (chạy pipeline tới bước 19)'}
          onClick={async () => {
            await window.api.invoke('publish:cutShorts', story.id, release.id)
            await refresh()
            await onDone()
          }}
        >
          <Icon name="film" className="h-4 w-4" /> {sh ? 'Cắt lại' : 'Cắt Shorts teaser'}
        </AsyncButton>
      }
    >
      {sh ? (
        <div className="flex gap-4">
          {relPath ? <video src={mediaUrl(relPath, sh.createdAt)} controls className="h-72 rounded border border-ink-600 bg-black" /> : null}
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-slate-500">Đoạn: </span>
              <span className="text-slate-200">
                {formatTime(sh.start)} → {formatTime(sh.end)} ({Math.round(sh.end - sh.start)}s)
              </span>
            </div>
            <div>
              <span className="text-slate-500">Móc mở đầu: </span>
              <span className="text-slate-200">{sh.hookText}</span>
            </div>
            <div>
              <span className="text-slate-500">Thẻ cuối: </span>
              <span className="text-slate-200">{sh.ctaText}</span>
            </div>
            <p className="text-xs text-slate-500">
              App chọn đoạn căng nhất (liền mạch, không cắt giữa câu), thêm thẻ móc {cfg.hookCardSec}s đầu và thẻ "xem bản đầy đủ" {cfg.endCardSec}s cuối. Đăng
              Shorts kèm link tới video dài.
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Tuỳ chọn: cắt đoạn {cfg.minSec}–{cfg.maxSec}s căng nhất làm teaser dọc dẫn về video dài (pipeline bước 23 làm tự động).
        </p>
      )}
    </Panel>
  )
}
