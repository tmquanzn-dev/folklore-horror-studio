/**
 * Ghép URL media cho renderer (Remotion Player) và cho Chrome headless khi render.
 * Mọi media được phục vụ bởi một HTTP server nội bộ (127.0.0.1) trong main process:
 *   <base>/<storyId>/<đường dẫn tương đối đã encode từng đoạn>?v=<phiên bản>
 * Encode từng đoạn để đường dẫn có dấu tiếng Việt / khoảng trắng vẫn hoạt động.
 */
export function buildMediaUrl(baseUrl: string, storyId: string, relPath: string, version?: string): string {
  const encoded = relPath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/')
  const v = version ? `?v=${encodeURIComponent(version)}` : ''
  return `${baseUrl}/${encodeURIComponent(storyId)}/${encoded}${v}`
}

/** Chuẩn hoá đường dẫn tương đối về dạng "a/b/c" */
export function toRelPath(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p.length > 0 && p !== '.')
    .join('/')
}
