import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite build 3 phần: main (Node), preload (cầu nối an toàn), renderer (React UI).
export default defineConfig({
  main: {
    // Không bundle thư viện trong "dependencies" (sharp, remotion, ffmpeg-static...) – require lúc chạy.
    // Riêng p-queue được bundle vào để xử lý đúng default export (CJS/ESM interop).
    plugins: [externalizeDepsPlugin({ exclude: ['p-queue'] })],
    build: {
      rollupOptions: {
        // 2 entry: tiến trình chính + utility process render Remotion (chạy tách biệt để UI không đứng).
        input: {
          index: resolve('src/main/index.ts'),
          renderWorker: resolve('src/main/render/renderWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
