/**
 * Cài đặt app (electron-store) + API key mã hoá bằng Electron safeStorage.
 * API key KHÔNG BAO GIỜ gửi sang renderer – renderer chỉ biết "đã có key hay chưa".
 */
import path from 'node:path'
import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { platformsConfig } from '../shared/config'
import type { PublicSettings } from '../shared/ipc'

interface SettingsSchema {
  dataRoot: string
  mockMode: boolean
  monthlyBudgetUsd: number
  renderPresetId: string
  /** providerId → chuỗi base64 đã mã hoá */
  apiKeys: Record<string, string>
  filmStudio: FilmSettings
  soundLibraryDir: string
  /** Ngưỡng hiệu quả để gợi ý "Chuyển thể sang YouTube" */
  perfMinViews: number
  perfMinAvgWatch: number
  /** Draft CapCut mẫu (template mode) và thư mục draft của CapCut */
  capcutTemplateDir: string
  capcutDraftsDir: string
}

export interface FilmSettings {
  /** Số luồng hàng đợi 1–20 */
  concurrency: number
  /** AUTO: ON – job mới tự chạy; OFF – chờ bấm Bắt đầu */
  autoRun: boolean
  /** AUTO DL – kết quả ảnh tự áp vào cảnh; tắt = lưu thành biến thể chờ chọn */
  autoDl: boolean
}

export function getFilmSettings(): FilmSettings {
  const defaults: FilmSettings = { concurrency: 4, autoRun: true, autoDl: true }
  return { ...defaults, ...(getStore().get('filmStudio') as Partial<FilmSettings> | undefined) }
}

export function updateFilmSettings(patch: Partial<FilmSettings>): FilmSettings {
  const next = { ...getFilmSettings(), ...patch }
  next.concurrency = Math.min(20, Math.max(1, Math.round(next.concurrency)))
  getStore().set('filmStudio', next)
  return next
}

const PROVIDERS_WITH_KEYS = ['openai', 'elevenlabs', 'gemini']

let store: Store<SettingsSchema> | null = null

function getStore(): Store<SettingsSchema> {
  if (!store) {
    store = new Store<SettingsSchema>({
      name: 'settings',
      defaults: {
        dataRoot: path.join(app.getPath('documents'), 'Folklore Horror Studio'),
        mockMode: true,
        monthlyBudgetUsd: 20,
        renderPresetId: 'full1080',
        apiKeys: {},
        filmStudio: { concurrency: 4, autoRun: true, autoDl: true },
        soundLibraryDir: '',
        perfMinViews: platformsConfig.publishing.performanceDefaults.minViews,
        perfMinAvgWatch: platformsConfig.publishing.performanceDefaults.minAvgWatchPercent,
        capcutTemplateDir: '',
        capcutDraftsDir: ''
      }
    })
  }
  return store
}

export function getDataRoot(): string {
  // FHS_DATA_ROOT: thư mục dữ liệu riêng cho kiểm thử
  return process.env['FHS_DATA_ROOT'] || getStore().get('dataRoot')
}

/** Thư mục thư viện âm thanh của người dùng (mặc định <dataRoot>/Âm thanh) */
export function getSoundLibraryDir(): string {
  const v = getStore().get('soundLibraryDir') as string | undefined
  return v || path.join(getDataRoot(), 'Âm thanh')
}

export function setSoundLibraryDir(dir: string): void {
  getStore().set('soundLibraryDir', dir)
}

/** Thư mục draft mặc định của CapCut trên Windows */
export function defaultCapcutDraftsDir(): string {
  const local = process.env['LOCALAPPDATA'] ?? path.join(app.getPath('home'), 'AppData', 'Local')
  return path.join(local, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')
}

export function getCapcutDirs(): { templateDir: string; draftsDir: string } {
  const s = getStore()
  return { templateDir: (s.get('capcutTemplateDir') as string | undefined) ?? '', draftsDir: (s.get('capcutDraftsDir') as string | undefined) || defaultCapcutDraftsDir() }
}

export function setCapcutDirs(patch: { templateDir?: string; draftsDir?: string }): void {
  const s = getStore()
  if (patch.templateDir !== undefined) s.set('capcutTemplateDir', patch.templateDir)
  if (patch.draftsDir !== undefined) s.set('capcutDraftsDir', patch.draftsDir)
}

export function getMonthlyBudget(): number {
  return getStore().get('monthlyBudgetUsd')
}

export function getRenderScale(): number {
  const id = getStore().get('renderPresetId')
  return platformsConfig.renderPresets.find((p) => p.id === id)?.scale ?? 1
}

export function getPublicSettings(): PublicSettings {
  const s = getStore()
  const keys = s.get('apiKeys')
  return {
    dataRoot: s.get('dataRoot'),
    mockMode: s.get('mockMode'),
    monthlyBudgetUsd: s.get('monthlyBudgetUsd'),
    renderPresetId: s.get('renderPresetId'),
    apiKeyStatus: Object.fromEntries(PROVIDERS_WITH_KEYS.map((p) => [p, !!keys[p]])),
    perfMinViews: s.get('perfMinViews') ?? platformsConfig.publishing.performanceDefaults.minViews,
    perfMinAvgWatch: s.get('perfMinAvgWatch') ?? platformsConfig.publishing.performanceDefaults.minAvgWatchPercent,
    capcutTemplateDir: getCapcutDirs().templateDir,
    capcutDraftsDir: getCapcutDirs().draftsDir,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export function isMockMode(): boolean {
  return getStore().get('mockMode')
}

export function updateSettings(patch: { monthlyBudgetUsd?: number; renderPresetId?: string; mockMode?: boolean; perfMinViews?: number; perfMinAvgWatch?: number }): PublicSettings {
  const s = getStore()
  if (patch.perfMinViews !== undefined) s.set('perfMinViews', Math.max(0, Math.round(patch.perfMinViews)))
  if (patch.perfMinAvgWatch !== undefined) s.set('perfMinAvgWatch', Math.min(100, Math.max(0, patch.perfMinAvgWatch)))
  if (patch.mockMode !== undefined) s.set('mockMode', !!patch.mockMode)
  if (patch.monthlyBudgetUsd !== undefined) {
    if (!(patch.monthlyBudgetUsd >= 0)) throw new Error('Ngân sách tháng phải ≥ 0')
    s.set('monthlyBudgetUsd', patch.monthlyBudgetUsd)
  }
  if (patch.renderPresetId !== undefined) {
    if (!platformsConfig.renderPresets.some((p) => p.id === patch.renderPresetId)) throw new Error('Preset render không tồn tại')
    s.set('renderPresetId', patch.renderPresetId)
  }
  return getPublicSettings()
}

export function setApiKey(providerId: string, apiKey: string): PublicSettings {
  if (!PROVIDERS_WITH_KEYS.includes(providerId)) throw new Error(`Provider không hợp lệ: ${providerId}`)
  const s = getStore()
  const keys = { ...s.get('apiKeys') }
  if (!apiKey.trim()) {
    delete keys[providerId]
  } else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không hỗ trợ mã hoá safeStorage – không thể lưu API key an toàn')
    keys[providerId] = safeStorage.encryptString(apiKey.trim()).toString('base64')
  }
  s.set('apiKeys', keys)
  return getPublicSettings()
}

/** Chỉ dùng trong main process (adapter thật ở GĐ2+) */
export function getApiKey(providerId: string): string | null {
  const enc = getStore().get('apiKeys')[providerId]
  if (!enc) return null
  return safeStorage.decryptString(Buffer.from(enc, 'base64'))
}
