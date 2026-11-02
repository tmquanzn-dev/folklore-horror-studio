import type { FhsApi } from '../shared/ipc'

declare global {
  interface Window {
    api: FhsApi
  }
}

export {}
