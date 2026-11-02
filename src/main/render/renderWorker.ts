/**
 * Utility process render: nhận lệnh từ main qua parentPort, render bằng Remotion, báo tiến độ.
 * Tách riêng khỏi main ⇒ webpack bundle + Chrome + mã hoá video không làm đứng UI.
 */
import { renderVideo } from './renderCore'
import type { WorkerInbound, WorkerOutbound } from './protocol'

const port = process.parentPort
const controllers = new Map<string, AbortController>()

function post(msg: WorkerOutbound): void {
  port.postMessage(msg)
}

port.on('message', (event: { data: WorkerInbound }) => {
  const msg = event.data
  if (msg.type === 'cancel') {
    controllers.get(msg.jobId)?.abort()
    return
  }
  if (msg.type === 'render') {
    const ac = new AbortController()
    controllers.set(msg.jobId, ac)
    let last = 0
    renderVideo(
      msg.request,
      (progress) => {
        // Giảm tần suất gửi tin (tối đa ~10 lần/giây)
        const now = Date.now()
        if (now - last < 100 && progress.progress < 1) return
        last = now
        post({ type: 'progress', jobId: msg.jobId, progress })
      },
      ac.signal
    )
      .then(() => post({ type: 'done', jobId: msg.jobId }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
        post({ type: 'error', jobId: msg.jobId, message, aborted: ac.signal.aborted })
      })
      .finally(() => controllers.delete(msg.jobId))
  }
})

post({ type: 'log', message: 'Render worker đã sẵn sàng' })
