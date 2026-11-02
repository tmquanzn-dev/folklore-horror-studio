/**
 * PRELOAD – cầu nối an toàn duy nhất giữa renderer và main (contextIsolation: true).
 * Chỉ cho phép các kênh đã khai báo trong shared/ipc.ts (INVOKE_CHANNELS được TypeScript kiểm tra đủ).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INVOKE_CHANNELS, type FhsApi, type IpcEventChannel } from '../shared/ipc'

const EVENT_CHANNELS: readonly IpcEventChannel[] = ['pipeline:progress', 'data:changed', 'log:entry', 'queue:changed']

const api: FhsApi = {
  invoke: (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) return Promise.reject(new Error(`Kênh IPC không hợp lệ: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, listener) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Kênh sự kiện không hợp lệ: ${channel}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
