/**
 * MAIN PROCESS – khởi động app:
 *   logger → dữ liệu mẫu → media server → render service → pipeline runner → IPC → cửa sổ.
 */
import path from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import type { PipelineState } from '../shared/types'
import { registerIpc, sendToRenderer } from './ipc'
import { logger } from './logger'
import { startMediaServer, type MediaServer } from './media/mediaServer'
import { PipelineRunner } from './pipeline/runner'
import { ThrottledEmitter } from './progressEmitter'
import { createProviderRegistry } from './providers/registry'
import { RenderService } from './render/renderService'
import { StoryService } from './services/storyService'
import { VoiceService } from './services/voiceService'
import { getApiKey, getDataRoot, getFilmSettings, getMonthlyBudget, getRenderScale, isMockMode } from './settings'
import { createAppQueue } from './queue/appQueue'
import { ImageService } from './services/imageService'
import { MotionService } from './services/motionService'
import { PublishService } from './services/publishService'
import { SoundService } from './services/soundService'
import { DepthEstimator } from './media/depth'
import { getSoundLibraryDir } from './settings'
import type { QueueSnapshot } from '../shared/ipc'
import { runUiSmoke } from './uiSmoke'

// Kiểm thử UI: dùng thư mục userData riêng để không đụng cài đặt thật của người dùng
if (process.env['FHS_USER_DATA']) app.setPath('userData', process.env['FHS_USER_DATA'])
import { StoryRepository } from './storage/storyRepo'

let mainWindow: BrowserWindow | null = null
let mediaServer: MediaServer | null = null
let renderService: RenderService | null = null
let appQueue: { pause(): void; persist(): Promise<void> } | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    backgroundColor: '#0b0d14',
    title: 'Folklore Horror Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => {
    if (!process.env['FHS_UI_SMOKE']) win.show()
  })
  // Không cho mở cửa sổ mới / điều hướng lạ trong app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Lỗi JavaScript trong giao diện → ghi vào Nhật ký/file log (dễ gỡ lỗi khi màn hình trắng)
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) logger.error(`${message} (${sourceId}:${line})`, 'renderer')
  })
  win.webContents.on('render-process-gone', (_e, details) => logger.error(`Renderer dừng: ${details.reason}`, 'renderer'))
  win.webContents.on('will-navigate', (e, url) => {
    if (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
    e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

async function bootstrap(): Promise<void> {
  logger.init(path.join(app.getPath('userData'), 'logs'))
  logger.info(`Folklore Horror Studio ${app.getVersion()} khởi động`)

  const repo = new StoryRepository(getDataRoot())
  await repo.ensureSampleData()
  logger.info(`Thư mục dữ liệu: ${repo.dataRoot}`)

  mediaServer = await startMediaServer(() => repo.storiesRoot)
  renderService = new RenderService(path.join(__dirname, 'renderWorker.js'))

  // Bản đóng gói: thêm CSP qua header (bản dev cần HMR của Vite nên bỏ qua)
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:*; media-src 'self' blob: data: http://127.0.0.1:*; connect-src 'self' http://127.0.0.1:*"
          ]
        }
      })
    })
  }

  const progressEmitter = new ThrottledEmitter<{ storyId: string; releaseId: string; state: PipelineState }>(
    (_key, payload) => sendToRenderer(mainWindow, 'pipeline:progress', payload)
  )
  const dataEmitter = new ThrottledEmitter<string>((_key, storyId) =>
    sendToRenderer(mainWindow, 'data:changed', { storyId })
  , 300)

  // API key chỉ đọc ở main (giải mã safeStorage khi cần), không bao giờ gửi sang renderer
  const providers = createProviderRegistry({
    isMock: isMockMode,
    getKey: (id) => {
      try {
        return getApiKey(id)
      } catch {
        return null
      }
    }
  })
  logger.info(`Chế độ: ${isMockMode() ? 'Mock (offline, không tốn phí)' : 'API thật (OpenAI / ElevenLabs / Gemini)'}`)

  // Hàng đợi job dùng chung (ảnh, sau này video/TTS hàng loạt) – lưu xuống đĩa, khôi phục khi mở lại
  const film = getFilmSettings()
  const queue = createAppQueue({
    repo,
    persistPath: path.join(repo.dataRoot, 'queue.json'),
    concurrency: film.concurrency,
    getMonthlyBudget,
    onCostRecorded: (storyId) => dataEmitter.emit(storyId, storyId)
  })
  const notifyAll = async (storyId: string | null): Promise<void> => {
    if (storyId) return dataEmitter.emit(storyId, storyId)
    for (const s of await repo.listStories()) dataEmitter.emit(s.id, s.id)
  }
  const images = new ImageService(repo, providers, queue, () => getFilmSettings().autoDl, (sid) => void notifyAll(sid))
  appQueue = queue
  await queue.restore()
  if (!film.autoRun) queue.pause()
  else if (queue.state().counts.queued === 0) queue.resume()
  if (queue.state().paused && queue.state().counts.queued > 0) logger.warn(`Khôi phục ${queue.state().counts.queued} job ảnh đang chờ – bấm "Tiếp tục" ở Film Studio để chạy`, 'queue')
  const queueSnapshot = (): QueueSnapshot => ({ state: queue.state(), jobs: queue.list(), settings: getFilmSettings() })
  const queueEmitter = new ThrottledEmitter<null>(() => sendToRenderer(mainWindow, 'queue:changed', queueSnapshot()), 300)
  queue.onChange(() => queueEmitter.emit('q', null))

  const depth = new DepthEstimator(path.join(repo.dataRoot, 'models'))
  const motion = new MotionService(repo, providers, queue, depth, (sid) => void notifyAll(sid))
  const sound = new SoundService(repo, providers, getSoundLibraryDir)
  logger.info(depth.hasModel() ? `Model depth: ${depth.modelPath}` : 'Chưa có model depth – parallax dùng depth ước lượng (tải model ở Cài đặt)', 'depth')

  const remotionEntry = path.join(app.getAppPath(), 'src', 'remotion', 'index.ts')
  const publish = new PublishService({ repo, providers, renderer: renderService, remotionEntry, mediaBaseUrl: mediaServer.baseUrl, getRenderScale })

  const runner = new PipelineRunner({
    repo,
    providers,
    images,
    motion,
    sound,
    publish,
    renderer: renderService,
    // Dev: app.getAppPath() = thư mục dự án. Đóng gói (GĐ6) sẽ dùng bundle dựng sẵn.
    remotionEntry,
    mediaBaseUrl: mediaServer.baseUrl,
    getRenderScale,
    emitProgress: (storyId, releaseId, state, force) =>
      // structuredClone: gửi ảnh chụp trạng thái, tránh renderer nhận object đang bị sửa
      progressEmitter.emit(`${storyId}/${releaseId}`, { storyId, releaseId, state: structuredClone(state) }, force),
    emitDataChanged: (storyId) => dataEmitter.emit(storyId, storyId)
  })

  registerIpc({
    repo,
    runner,
    providers,
    stories: new StoryService(repo, () => providers.llm()),
    voices: new VoiceService(repo, providers, path.join(repo.dataRoot, 'cache', 'previews')),
    images,
    publish,
    motion,
    sound,
    depth,
    queue,
    queueSnapshot,
    getWindow: () => mainWindow,
    mediaBaseUrl: mediaServer.baseUrl,
    emitDataChanged: (storyId) => dataEmitter.emit(storyId, storyId, true)
  })
  logger.onEntry((entry) => sendToRenderer(mainWindow, 'log:entry', entry))

  mainWindow = createWindow()
  mainWindow.on('closed', () => (mainWindow = null))
  const uiSmokeDir = process.env['FHS_UI_SMOKE']
  if (uiSmokeDir) {
    const win = mainWindow
    win.webContents.once('did-finish-load', () => void runUiSmoke(win, uiSmokeDir))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(bootstrap).catch((err: unknown) => {
    logger.error(`Không khởi động được: ${err instanceof Error ? err.stack : String(err)}`)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mediaServer) mainWindow = createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    appQueue?.pause()
    void appQueue?.persist()
    renderService?.dispose()
    void mediaServer?.close()
  })
}
