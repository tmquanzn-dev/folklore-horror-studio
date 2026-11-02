/**
 * Logger: ghi ra file (mỗi ngày 1 file) + bộ đệm trong RAM + đẩy về panel "Nhật ký" của UI.
 * Không phụ thuộc Electron ⇒ dùng được trong smoke test.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { LogEntry } from '../shared/ipc'

type Listener = (entry: LogEntry) => void

class Logger {
  private file: string | null = null
  private buffer: LogEntry[] = []
  private listeners = new Set<Listener>()
  private nextId = 1
  private writeChain: Promise<void> = Promise.resolve()

  init(logDir: string): void {
    fs.mkdirSync(logDir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    this.file = path.join(logDir, `app-${day}.log`)
  }

  get logFile(): string | null {
    return this.file
  }

  onEntry(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  history(): LogEntry[] {
    return [...this.buffer]
  }

  info(message: string, scope = 'app'): void {
    this.push('info', message, scope)
  }

  warn(message: string, scope = 'app'): void {
    this.push('warn', message, scope)
  }

  error(message: string, scope = 'app'): void {
    this.push('error', message, scope)
  }

  private push(level: LogEntry['level'], message: string, scope: string): void {
    const entry: LogEntry = { id: this.nextId++, time: new Date().toISOString(), level, scope, message }
    this.buffer.push(entry)
    if (this.buffer.length > 1000) this.buffer.splice(0, this.buffer.length - 1000)
    for (const l of this.listeners) l(entry)
    const line = `${entry.time} [${level.toUpperCase()}] [${scope}] ${message}\n`
    if (level === 'error') console.error(line.trim())
    else console.log(line.trim())
    const file = this.file
    if (file) {
      // Ghi tuần tự để không lẫn dòng
      this.writeChain = this.writeChain.then(() => fs.promises.appendFile(file, line, 'utf8')).catch(() => undefined)
    }
  }
}

export const logger = new Logger()
