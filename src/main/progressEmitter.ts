/**
 * Gửi sự kiện tiến độ về renderer, giới hạn ~200ms/lần cho mỗi khoá (tránh làm ngập IPC).
 * force = gửi ngay (dùng khi đổi trạng thái bước).
 */
export class ThrottledEmitter<T> {
  private last = new Map<string, number>()
  private timers = new Map<string, NodeJS.Timeout>()
  private pending = new Map<string, T>()

  constructor(
    private readonly send: (key: string, payload: T) => void,
    private readonly intervalMs = 200
  ) {}

  emit(key: string, payload: T, force = false): void {
    const now = Date.now()
    const last = this.last.get(key) ?? 0
    if (force || now - last >= this.intervalMs) {
      const t = this.timers.get(key)
      if (t) clearTimeout(t)
      this.timers.delete(key)
      this.pending.delete(key)
      this.last.set(key, now)
      this.send(key, payload)
      return
    }
    this.pending.set(key, payload)
    if (!this.timers.has(key)) {
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key)
          const p = this.pending.get(key)
          this.pending.delete(key)
          if (p !== undefined) {
            this.last.set(key, Date.now())
            this.send(key, p)
          }
        }, this.intervalMs - (now - last))
      )
    }
  }
}
