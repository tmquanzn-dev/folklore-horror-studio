export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '–'
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatTimePrecise(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '–'
  const m = Math.floor(sec / 60)
  const r = (sec % 60).toFixed(2).padStart(5, '0')
  return `${m}:${r}`
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} giây`
  const m = Math.floor(s / 60)
  return `${m} phút ${s % 60} giây`
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  youtubeShorts: 'Shorts'
}

export const SHOT_LABEL: Record<string, string> = {
  wide: 'Toàn cảnh',
  medium: 'Trung cảnh',
  closeUp: 'Cận cảnh',
  overShoulder: 'Qua vai',
  topDown: 'Từ trên xuống',
  insert: 'Chi tiết'
}

export const SECTION_LABEL: Record<string, string> = {
  hook: 'Móc',
  coldOpen: 'Cold open',
  context: 'Bối cảnh',
  story: 'Câu chuyện',
  folkloreExplainer: 'Giải thích truyền thuyết',
  cliffhanger: 'Câu treo',
  outro: 'Kết'
}

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron thêm tiền tố "Error invoking remote method 'x': Error: ..."
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
