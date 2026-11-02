import { describe, expect, it } from 'vitest'
import { backoffDelay, fetchWithRetry, HttpError, parseRetryAfter } from '../src/main/providers/http'

function res(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
}

function fakeFetch(responses: (Response | Error)[]) {
  const calls: string[] = []
  const impl = (async (url: string) => {
    calls.push(url)
    const r = responses.shift()
    if (!r) throw new Error('hết response giả')
    if (r instanceof Error) throw r
    return r
  }) as unknown as typeof fetch
  return { impl, calls }
}

const waits: number[] = []
const base = {
  maxAttempts: 4,
  baseMs: 100,
  maxMs: 5000,
  timeoutMs: 1000,
  random: () => 0,
  sleep: async (ms: number) => {
    waits.push(ms)
  }
}

describe('parseRetryAfter / backoffDelay', () => {
  it('đọc giây và ngày giờ HTTP', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(10000)
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('abc')).toBeNull()
  })
  it('exponential + jitter, chặn trần', () => {
    expect(backoffDelay(1, 100, 5000, () => 0)).toBe(100)
    expect(backoffDelay(3, 100, 5000, () => 0)).toBe(400)
    expect(backoffDelay(3, 100, 5000, () => 0.5)).toBe(450)
    expect(backoffDelay(20, 100, 5000, () => 0)).toBe(5000)
  })
})

describe('fetchWithRetry', () => {
  it('429 ⇒ chờ đúng Retry-After rồi thử lại', async () => {
    waits.length = 0
    const f = fakeFetch([res(429, 'slow down', { 'retry-after': '2' }), res(200, 'ok')])
    const r = await fetchWithRetry('u', {}, { ...base, fetchImpl: f.impl })
    expect(await r.text()).toBe('ok')
    expect(waits).toEqual([2000])
  })

  it('500 / lỗi mạng ⇒ backoff tăng dần', async () => {
    waits.length = 0
    const f = fakeFetch([res(500), new TypeError('fetch failed'), res(200, 'ok')])
    await fetchWithRetry('u', {}, { ...base, fetchImpl: f.impl })
    expect(waits).toEqual([100, 200])
    expect(f.calls.length).toBe(3)
  })

  it('400 / 401 ⇒ không thử lại, ném HttpError có status', async () => {
    const f = fakeFetch([res(401, 'bad key')])
    await expect(fetchWithRetry('u', {}, { ...base, fetchImpl: f.impl })).rejects.toMatchObject({ status: 401 })
    expect(f.calls.length).toBe(1)
  })

  it('hết số lần thử ⇒ ném lỗi cuối', async () => {
    const f = fakeFetch([res(503), res(503), res(503), res(503)])
    await expect(fetchWithRetry('u', {}, { ...base, fetchImpl: f.impl })).rejects.toBeInstanceOf(HttpError)
    expect(f.calls.length).toBe(4)
  })

  it('huỷ bằng AbortSignal', async () => {
    const ac = new AbortController()
    ac.abort()
    const f = fakeFetch([res(200)])
    await expect(fetchWithRetry('u', {}, { ...base, fetchImpl: f.impl, signal: ac.signal })).rejects.toThrow(/huỷ/)
  })
})
