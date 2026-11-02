import { defineConfig } from 'vitest/config'

// Smoke test: chạy TOÀN BỘ pipeline giả lập + render MP4 thật bằng Remotion (không cần mở UI).
// Lần đầu sẽ tải Chrome Headless Shell (~100MB) nên có thể mất vài phút.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000
  }
})
