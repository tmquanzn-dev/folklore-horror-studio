/**
 * HTTP server nội bộ (chỉ 127.0.0.1, cổng ngẫu nhiên, có token bí mật trong URL) phục vụ media của Story
 * cho Remotion Player (renderer) và Chrome headless (khi render).
 * Hỗ trợ HTTP Range ⇒ tua audio/video mượt.
 */
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json'
}

export interface MediaServer {
  baseUrl: string
  close(): Promise<void>
}

export async function startMediaServer(getStoriesRoot: () => string): Promise<MediaServer> {
  const token = randomBytes(12).toString('hex')
  const prefix = `/m/${token}/`

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(prefix) || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404).end()
        return
      }
      const segments = url.pathname
        .slice(prefix.length)
        .split('/')
        .filter(Boolean)
        .map((s) => decodeURIComponent(s))
      if (segments.length < 2 || segments.some((s) => s === '..' || s.includes('\\') || s.includes(':'))) {
        res.writeHead(400).end()
        return
      }
      const root = path.resolve(getStoriesRoot())
      const file = path.resolve(root, ...segments)
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end()
        return
      }
      const stat = await fs.stat(file).catch(() => null)
      if (!stat || !stat.isFile()) {
        res.writeHead(404).end()
        return
      }
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
      const headers: Record<string, string | number> = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }
      const range = req.headers.range
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        let start = m && m[1] ? Number(m[1]) : 0
        let end = m && m[2] ? Number(m[2]) : stat.size - 1
        if (m && !m[1] && m[2]) {
          // dạng "bytes=-500" (500 byte cuối)
          start = Math.max(0, stat.size - Number(m[2]))
          end = stat.size - 1
        }
        if (start >= stat.size || end < start) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end()
          return
        }
        end = Math.min(end, stat.size - 1)
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': end - start + 1
        })
        if (req.method === 'HEAD') return void res.end()
        createReadStream(file, { start, end }).pipe(res)
        return
      }
      res.writeHead(200, { ...headers, 'Content-Length': stat.size })
      if (req.method === 'HEAD') return void res.end()
      createReadStream(file).pipe(res)
    } catch {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}/m/${token}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
