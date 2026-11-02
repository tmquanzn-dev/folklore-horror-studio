/**
 * Chuyển lỗi kỹ thuật thành thông báo tiếng Việt kèm cách xử lý.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted|cancel/i.test(err.message))
}

export function toVietnameseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string } | null)?.code

  if (isAbortError(err)) return 'Đã huỷ theo yêu cầu.'
  const status = (err as { status?: number } | null)?.status
  if (status === 401 || status === 403) return 'API key không hợp lệ hoặc không có quyền. Cách xử lý: kiểm tra/nhập lại key ở màn Cài đặt.'
  if (status === 402 || /quota|insufficient|credits?/i.test(raw))
    return 'Tài khoản provider hết hạn mức/credit. Cách xử lý: nạp thêm credit hoặc bật Chế độ Mock.'
  if (status === 429) return 'Provider đang giới hạn tốc độ (429) sau nhiều lần thử lại. Cách xử lý: đợi vài phút rồi chạy lại bước.'
  if (status === 400 || status === 422) return `Provider từ chối yêu cầu (${status}). Cách xử lý: kiểm tra voice_id / model trong giọng hoặc file config. Chi tiết: ${raw.slice(0, 300)}`
  if (status && status >= 500) return `Máy chủ provider đang lỗi (${status}). Cách xử lý: thử lại sau ít phút.`
  if (code === 'ENOENT' && /ffmpeg|ffprobe/i.test(raw))
    return `Không tìm thấy ffmpeg/ffprobe. Cách xử lý: chạy lại "npm install". (${raw})`
  if (code === 'ENOENT') return `Không tìm thấy file hoặc thư mục. Cách xử lý: kiểm tra đường dẫn dữ liệu trong Cài đặt. (${raw})`
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
    return `File đang bị chương trình khác mở hoặc không có quyền ghi. Cách xử lý: đóng trình phát video/Explorer đang mở file rồi chạy lại bước. (${raw})`
  if (code === 'ENOSPC') return 'Ổ đĩa đã đầy. Cách xử lý: giải phóng dung lượng rồi chạy lại bước.'
  if (/browser|chrom/i.test(raw) && /download|fetch|ENOTFOUND|ECONN/i.test(raw))
    return `Không tải được Chrome Headless Shell cho Remotion. Cách xử lý: kiểm tra kết nối mạng rồi chạy lại bước Render (chỉ cần tải 1 lần). (${raw})`
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(raw))
    return `Lỗi mạng. Cách xử lý: kiểm tra kết nối Internet rồi chạy lại bước. (${raw})`
  if (/\b401\b|unauthori[sz]ed|invalid api key/i.test(raw))
    return 'API key không hợp lệ. Cách xử lý: nhập lại key trong màn Cài đặt.'
  if (/\b429\b|rate limit/i.test(raw)) return 'Provider đang giới hạn tốc độ (429). Cách xử lý: giảm số luồng hoặc đợi vài phút rồi chạy lại.'
  if (/Chưa triển khai/.test(raw)) return raw
  // Thông báo đã kèm hướng dẫn (lỗi do app tự ném) ⇒ giữ nguyên, không ghép thêm câu "Cách xử lý" thứ hai
  if (/Cách xử lý:|–\s*(AutoEdit|Storyboard|Voice Studio|Story|màn)\b/.test(raw)) return raw.replace(/^Error:\s*/, '')
  return `Lỗi: ${raw}. Cách xử lý: xem panel Nhật ký để biết chi tiết, sửa nguyên nhân rồi bấm "Bắt đầu" để chạy lại bước lỗi.`
}
