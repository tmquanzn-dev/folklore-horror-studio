import { defineConfig } from 'vitest/config'

// Unit test cho logic thuần (không cần Electron).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/smoke/**', 'node_modules/**']
  }
})
