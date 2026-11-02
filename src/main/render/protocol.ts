/** Giao thức tin nhắn giữa main ⇄ utility process render */
import type { CompositionProps } from '../../shared/composition'

export interface RenderRequest {
  /** Đường dẫn tuyệt đối tới src/remotion/index.ts */
  entryPoint: string
  inputProps: CompositionProps
  outputPath: string
}

export type RenderStage = 'bundle' | 'browser' | 'render'

export interface RenderProgress {
  stage: RenderStage
  /** 0..1 trong stage hiện tại */
  progress: number
}

export type WorkerInbound =
  | { type: 'render'; jobId: string; request: RenderRequest }
  | { type: 'cancel'; jobId: string }

export type WorkerOutbound =
  | { type: 'progress'; jobId: string; progress: RenderProgress }
  | { type: 'done'; jobId: string }
  | { type: 'error'; jobId: string; message: string; aborted: boolean }
  | { type: 'log'; message: string }

/** Ai cũng render được qua interface này: utility process (app) hoặc gọi trực tiếp (smoke test) */
export interface VideoRenderer {
  render(req: RenderRequest, onProgress: (p: RenderProgress) => void, signal?: AbortSignal): Promise<void>
}
