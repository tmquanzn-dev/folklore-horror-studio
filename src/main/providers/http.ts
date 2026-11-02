/**
 * fetch có retry: exponential backoff + jitter; 429/503 tôn trọng header Retry-After; timeout; huỷ bằng AbortSignal.
 * Dùng fetch có sẵn của Node/Electron ⇒ không cần thêm thư viện HTTP.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    /** Từ header Retry-After (nếu có) – hàng đợi dùng khi thử lại ở mức job */
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface RetryOptions {
  maxAttempts: number
  baseMs: number
  maxMs: number
  timeoutMs: number
  signal?: AbortSignal
  onRetry?: (attempt: number, delayMs: number, reason: string) => void
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

/** Retry-After: số giây hoặc ngày giờ HTTP ⇒ mili-giây (null nếu không có/không hợp lệ) */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const sec = Number(value.trim())
  if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000)
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - now)
  return null
}

/** base × 2^(attempt-1) + jitter ngẫu nhiên [0, base), không vượt max */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exp = baseMs * Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(maxMs, Math.round(exp + random() * baseMs))
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function abortError(): Error {
  return new DOMException('Đã huỷ', 'AbortError')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch
  const wait = opts.sleep ?? sleep
  const random = opts.random ?? Math.random
  let lastError: unknown = null

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw abortError()
    const ac = new AbortController()
    const onAbort = (): void => ac.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs)
    let retryDelay: number | null = null
    let reason = ''
    try {
      const res = await doFetch(url, { ...init, signal: ac.signal })
      if (res.ok) return res
      const body = (await res.text().catch(() => '')).slice(0, 2000)
      const err = new HttpError(`HTTP ${res.status}: ${body.slice(0, 300)}`, res.status, body, parseRetryAfter(res.headers.get('retry-after')))
      if (!isRetryableStatus(res.status) || attempt === opts.maxAttempts) throw err
      lastError = err
      reason = `HTTP ${res.status}`
      retryDelay = parseRetryAfter(res.headers.get('retry-after'))
    } catch (err) {
      if (opts.signal?.aborted) throw abortError()
      if (err instanceof HttpError) throw err
      // Lỗi mạng hoặc timeout ⇒ thử lại
      lastError = err
      reason = ac.signal.aborted ? 'timeout' : err instanceof Error ? err.message : String(err)
      if (attempt === opts.maxAttempts) break
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const delay = Math.min(opts.maxMs, retryDelay ?? backoffDelay(attempt, opts.baseMs, opts.maxMs, random))
    opts.onRetry?.(attempt, delay, reason)
    await wait(delay, opts.signal)
  }
  throw lastError instanceof Error ? lastError : new Error(`Gọi API thất bại: ${String(lastError)}`)
}
