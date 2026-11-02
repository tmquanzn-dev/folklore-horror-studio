/**
 * Đăng ký IPC handler có kiểu. Mỗi kênh trong IpcInvokeMap phải có handler tương ứng.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import type { AppInfo, ExportFile, IpcArgs, IpcChannel, IpcEventChannel, IpcEventMap, IpcResult, QueueSnapshot } from '../shared/ipc'
import type { JobQueue } from './providers/interfaces'
import type { ImageService } from './services/imageService'
import type { PublishService } from './services/publishService'
import { RECORDING_EXTS, type RecordingService } from './services/recordingService'
import type { ExportService } from './services/exportService'
import type { PuppetService } from './services/puppetService'
import type { MotionService } from './services/motionService'
import type { SoundService } from './services/soundService'
import type { DepthEstimator } from './media/depth'
import { validateCues } from '../shared/logic/soundDesign'
import { providersConfig } from '../shared/config'
import type { SoundAsset } from '../shared/types'
import { resetStepsFrom } from '../shared/pipeline'
import type { Release, RunMode, Script } from '../shared/types'
import { toVietnameseError } from './errors'
import { logger } from './logger'
import type { PipelineRunner } from './pipeline/runner'
import { HttpError } from './providers/http'
import type { ProviderRegistry } from './providers/registry'
import { rewriteLine } from './services/scriptService'
import type { StoryService } from './services/storyService'
import type { VoiceService } from './services/voiceService'
import { getCapcutDirs, getPublicSettings, getSoundLibraryDir, setApiKey, setCapcutDirs, setSoundLibraryDir, updateFilmSettings, updateSettings } from './settings'
import type { StoryRepository } from './storage/storyRepo'

/** Có thay đổi ảnh hưởng tới giọng (lời, người nói, delivery) không? Chỉ sửa bản dịch thì không. */
function voiceRelevantChanged(before: Script, after: Script): boolean {
  if (before.lines.length !== after.lines.length) return true
  const key = (s: Script): string =>
    JSON.stringify(s.lines.map((l) => [l.id, l.speakerId, l.text, l.delivery, l.sectionId, l.beatId]))
  return key(before) !== key(after)
}

function sanitizeScript(release: Release, script: Script): Script {
  const takesById = new Map(release.script.lines.map((l) => [l.id, l]))
  const sectionIds = new Set(script.sections.map((s) => s.id))
  const ids = new Set<string>()
  for (const l of script.lines) {
    if (!l.id || ids.has(l.id)) throw new Error(`Trùng hoặc thiếu id câu: "${l.id}"`)
    ids.add(l.id)
    if (!sectionIds.has(l.sectionId)) throw new Error(`Câu ${l.id} thuộc section không tồn tại`)
    if (!l.text.trim()) throw new Error(`Câu ${l.id} đang trống`)
    // Giữ take đã tạo (renderer không được sửa take)
    const old = takesById.get(l.id)
    l.takes = old?.takes ?? []
    if (!l.takes.some((t) => t.id === l.selectedTakeId)) l.selectedTakeId = old?.selectedTakeId ?? null
    l.delivery.pace = Math.min(1.3, Math.max(0.6, Number(l.delivery.pace) || 1))
    l.delivery.pauseBeforeMs = Math.min(5000, Math.max(0, Math.round(Number(l.delivery.pauseBeforeMs) || 0)))
    l.delivery.pauseAfterMs = Math.min(5000, Math.max(0, Math.round(Number(l.delivery.pauseAfterMs) || 0)))
  }
  return script
}

type Handler<C extends IpcChannel> = (...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>

function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await fn(...(args as IpcArgs<C>))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[${channel}] ${msg}`, 'ipc')
      // Lỗi kỹ thuật (HTTP, file, mạng) ⇒ thông báo tiếng Việt kèm cách xử lý
      if (err instanceof HttpError || (err as { code?: string } | null)?.code) throw new Error(toVietnameseError(err))
      throw err
    }
  })
}

export function sendToRenderer<E extends IpcEventChannel>(
  win: BrowserWindow | null,
  channel: E,
  payload: IpcEventMap[E]
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export interface IpcDeps {
  repo: StoryRepository
  runner: PipelineRunner
  stories: StoryService
  voices: VoiceService
  images: ImageService
  publish: PublishService
  recording: RecordingService
  exporter: ExportService
  puppet: PuppetService
  motion: MotionService
  sound: SoundService
  depth: DepthEstimator
  queue: JobQueue
  queueSnapshot: () => QueueSnapshot
  getWindow: () => BrowserWindow | null
  providers: ProviderRegistry
  mediaBaseUrl: string
  emitDataChanged: (storyId: string) => void
}

const RUN_MODES: RunMode[] = ['review', 'fullAuto']

export function registerIpc(deps: IpcDeps): void {
  const { repo, runner, stories, voices } = deps

  const assertIdle = (storyId: string, releaseId: string): void => {
    if (runner.isRunning(storyId, releaseId)) throw new Error('Pipeline đang chạy – hãy đợi tới điểm duyệt hoặc bấm Huỷ trước khi sửa')
  }
  const changed = <T>(storyId: string, value: T): T => {
    deps.emitDataChanged(storyId)
    return value
  }

  // ------------------------------------------------------------ Story (cấp Story)
  handle('story:create', async (input) => {
    const s = await stories.createStory(input)
    return changed(s.id, s)
  })
  handle('story:update', async (id, patch) => changed(id, await stories.updateStory(id, patch)))
  handle('story:generateOutline', async (id) => changed(id, await stories.generateOutline(id)))
  handle('story:approveOutline', async (id) => changed(id, await stories.approveOutline(id)))
  handle('story:proposeCast', async (id) => changed(id, (await stories.proposeCast(id)).story))
  handle('story:proposeSceneBank', async (id) => changed(id, await stories.proposeSceneBank(id)))
  handle('library:update', async (patch) => {
    const lib = await stories.updateLibrary(patch)
    for (const s of await repo.listStories()) deps.emitDataChanged(s.id)
    return lib
  })

  // ------------------------------------------------------------ Release & kịch bản
  handle('release:create', async (storyId, input) => changed(storyId, await stories.createRelease(storyId, input)))

  handle('release:updateScript', async (storyId, releaseId, script) => {
    assertIdle(storyId, releaseId)
    const release = await repo.loadRelease(storyId, releaseId)
    const next = sanitizeScript(release, structuredClone(script))
    if (voiceRelevantChanged(release.script, next)) {
      // Sửa lời/giọng ⇒ chạy lại từ bước 10; câu không đổi vẫn dùng take cũ (cache theo hash)
      resetStepsFrom(release.pipelineState, 10)
    }
    release.script = next
    await repo.saveRelease(release)
    return changed(storyId, release)
  })

  handle('release:rewriteLine', async (storyId, releaseId, lineId, instruction) => {
    assertIdle(storyId, releaseId)
    const [release, library] = await Promise.all([repo.loadRelease(storyId, releaseId), repo.loadLibrary()])
    await rewriteLine({ llm: deps.providers.llm(), release, library, lineId, instruction })
    resetStepsFrom(release.pipelineState, 10)
    await repo.saveRelease(release)
    return changed(storyId, release)
  })

  handle('release:clearScript', async (storyId, releaseId) => {
    assertIdle(storyId, releaseId)
    const release = await repo.loadRelease(storyId, releaseId)
    if (release.partIndex > 1) throw new Error('Chỉ chuyển thể lại từ Phần 1 của series')
    release.script = { sections: [], lines: [] }
    release.voiceTrack = null
    release.scenes = []
    release.subtitles = []
    if (!resetStepsFrom(release.pipelineState, 8) && release.pipelineState) release.pipelineState.currentStep = null
    await repo.saveRelease(release)
    logger.info('Đã xoá kịch bản – bấm "Bắt đầu" để LLM chuyển thể lại (bước 8)', releaseId)
    return changed(storyId, release)
  })

  // ------------------------------------------------------------ Voice Studio
  handle('voice:regenerateLine', async (storyId, releaseId, lineId) => {
    assertIdle(storyId, releaseId)
    return changed(storyId, await voices.regenerateLine(storyId, releaseId, lineId))
  })
  handle('voice:selectTake', async (storyId, releaseId, lineId, takeId) => {
    assertIdle(storyId, releaseId)
    return changed(storyId, await voices.selectTake(storyId, releaseId, lineId, takeId))
  })
  handle('voice:peaks', (storyId, relPath, buckets) => voices.peaks(storyId, relPath, buckets))
  handle('voice:processPreview', (storyId, releaseId, lineId) => voices.processPreview(storyId, releaseId, lineId))
  handle('tts:preview', (input) => voices.ttsPreview(input))

  // ------------------------------------------------------------ Hàng đợi (Film Studio)
  const { queue, images } = deps
  const snap = deps.queueSnapshot
  handle('queue:get', () => snap())
  handle('queue:setOptions', (patch) => {
    const s = updateFilmSettings(patch)
    if (patch.concurrency !== undefined) queue.setConcurrency(s.concurrency)
    if (patch.autoRun !== undefined) {
      if (s.autoRun) queue.resume()
      else queue.pause()
    }
    return snap()
  })
  handle('queue:pause', () => (queue.pause(), snap()))
  handle('queue:resume', () => (queue.resume(), snap()))
  handle('queue:cancel', (id) => (queue.cancel(id), snap()))
  handle('queue:cancelAll', () => (queue.cancelAll(), snap()))
  handle('queue:retry', (id) => (queue.retry(id), snap()))
  handle('queue:clearFinished', () => (queue.clearFinished(), snap()))

  // ------------------------------------------------------------ Ảnh & cảnh
  handle('images:generateScenes', async (storyId, sceneIds, aspect, opts) => (await images.generateScenes(storyId, sceneIds, aspect, opts)).length)
  handle('images:generateCharacter', async (characterId, what, opts) => (await images.generateCharacter(characterId, what, opts)).length)
  handle('scene:update', async (storyId, sceneId, patch) => changed(storyId, await images.updateScene(storyId, sceneId, patch)))
  handle('scene:applyVariant', async (storyId, sceneId, variantId) => changed(storyId, await images.applyVariant(storyId, sceneId, variantId)))
  handle('scene:checkConsistency', async (storyId, sceneIds) => changed(storyId, await images.checkConsistency(storyId, sceneIds)))
  // ------------------------------------------------------------ GĐ4: chuyển động, timeline, âm thanh
  const { motion, sound, depth } = deps
  const soundInfo = async (): Promise<{ dir: string; assets: SoundAsset[] }> => ({ dir: getSoundLibraryDir(), assets: (await repo.loadLibrary()).soundAssets })

  handle('scene:computeParallax', async (storyId, sceneId, aspect) => {
    await motion.computeParallax(storyId, sceneId, aspect, true)
    return changed(storyId, await repo.loadStory(storyId))
  })
  handle('scene:generateHeroClip', async (storyId, sceneId, aspect) => {
    const story = await repo.loadStory(storyId)
    const providerId = deps.providers.defaultVideoProvider()
    const p = deps.providers.video(providerId)
    const jobs = motion.enqueueClips(storyId, [sceneId], aspect, providerId, !!story.sceneBank.find((s) => s.id === sceneId)?.heroClip[aspect])
    return { jobs: jobs.length, cost: p.estimateCost(p.clipSeconds) }
  })
  handle('release:update', async (storyId, releaseId, patch) => {
    assertIdle(storyId, releaseId)
    const r = await repo.updateRelease(storyId, releaseId, (rel) => {
      if (patch.heroRatio !== undefined && Math.abs(patch.heroRatio - rel.heroRatio) > 1e-6) {
        rel.heroRatio = Math.min(1, Math.max(0, patch.heroRatio))
        resetStepsFrom(rel.pipelineState, 16)
      }
      // GĐ7: bật/tắt cảnh rối ⇒ chọn lại cảnh từ bước 14
      if (patch.puppetMaxRatio !== undefined && Math.abs(patch.puppetMaxRatio - (rel.puppetMaxRatio ?? -1)) > 1e-6) {
        rel.puppetMaxRatio = Math.min(1, Math.max(0, patch.puppetMaxRatio))
        resetStepsFrom(rel.pipelineState, 14)
      }
    })
    return changed(storyId, r)
  })
  handle('release:updateScenes', async (storyId, releaseId, scenes) => {
    assertIdle(storyId, releaseId)
    const r = await repo.updateRelease(storyId, releaseId, (rel) => {
      if (scenes.length !== rel.scenes.length || scenes.some((s, i) => s.id !== rel.scenes[i].id)) throw new Error('Danh sách cảnh không khớp – tải lại màn hình')
      for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].end - scenes[i].start < 0.3) throw new Error(`Cảnh ${i + 1} quá ngắn`)
        if (i > 0 && Math.abs(scenes[i].start - scenes[i - 1].end) > 0.002) throw new Error('Các cảnh phải liền nhau')
      }
      rel.scenes = rel.scenes.map((old, i) => ({ ...old, start: scenes[i].start, end: scenes[i].end, motion: scenes[i].motion, transition: scenes[i].transition, isHero: scenes[i].isHero }))
      resetStepsFrom(rel.pipelineState, 21)
    })
    return changed(storyId, r)
  })
  handle('release:updateSoundCues', async (storyId, releaseId, cues) => {
    assertIdle(storyId, releaseId)
    const lib = await repo.loadLibrary()
    const r = await repo.updateRelease(storyId, releaseId, (rel) => {
      const v = validateCues(cues, lib.soundAssets, rel.voiceTrack?.duration ?? 0)
      if (v.problems.length) throw new Error(v.problems.join('; '))
      rel.soundCues = v.cues
      if (rel.voiceTrack) rel.voiceTrack.mixStale = true
      resetStepsFrom(rel.pipelineState, 21)
    })
    return changed(storyId, r)
  })
  handle('audio:remix', async (storyId, releaseId) => {
    assertIdle(storyId, releaseId)
    await sound.mix(storyId, releaseId)
    return changed(storyId, await repo.updateRelease(storyId, releaseId, (rel) => void resetStepsFrom(rel.pipelineState, 21)))
  })
  handle('audio:redesign', async (storyId, releaseId) => {
    assertIdle(storyId, releaseId)
    const d = await sound.design(storyId, releaseId)
    await repo.updateRelease(storyId, releaseId, (rel) => {
      rel.soundCues = d.cues
      if (d.cost > 0) {
        rel.costs.actual += d.cost
        rel.costs.entries.push({ provider: deps.providers.llm().id, kind: 'llm', units: 1, cost: d.cost, timestamp: new Date().toISOString() })
      }
    })
    await sound.mix(storyId, releaseId)
    logger.info(`Thiết kế lại âm thanh: ${d.note}`, releaseId)
    return changed(storyId, await repo.updateRelease(storyId, releaseId, (rel) => void resetStepsFrom(rel.pipelineState, 21)))
  })
  handle('sound:info', () => soundInfo())
  handle('sound:chooseFolder', async () => {
    const win = deps.getWindow()
    const opts = { title: 'Chọn thư mục thư viện âm thanh', defaultPath: getSoundLibraryDir(), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    setSoundLibraryDir(r.filePaths[0])
    await sound.scan()
    return soundInfo()
  })
  handle('sound:rescan', async () => {
    await sound.scan()
    return soundInfo()
  })
  handle('sound:generateStarter', async () => {
    await sound.generateStarterPack()
    return soundInfo()
  })
  handle('sound:preview', (assetId) => sound.preview(assetId))
  const depthStatus = (): { hasModel: boolean; path: string; url: string } => ({ hasModel: depth.hasModel(), path: depth.modelPath, url: providersConfig.depth.downloadUrl })
  handle('models:depthStatus', () => depthStatus())
  handle('models:downloadDepth', async () => {
    let last = 0
    await depth.download((p) => {
      if (p - last >= 0.1) {
        last = p
        logger.info(`Tải model depth: ${Math.round(p * 100)}%`, 'depth')
      }
    })
    return depthStatus()
  })

  // ------------------------------------------------------------ GĐ5: xuất bản, hiệu quả, chi phí
  const { publish } = deps
  handle('publish:generate', async (storyId, releaseId) => {
    assertIdle(storyId, releaseId)
    return changed(storyId, (await publish.generatePackage(storyId, releaseId)).release)
  })
  handle('publish:update', async (storyId, releaseId, pkg) => changed(storyId, await publish.updatePackage(storyId, releaseId, pkg)))
  handle('publish:refreshChecklist', async (storyId, releaseId) => changed(storyId, await publish.refreshChecklist(storyId, releaseId)))
  handle('publish:quickThumbnail', async (storyId, releaseId, opts) => changed(storyId, await publish.quickThumbnail(storyId, releaseId, opts)))
  handle('publish:aiThumbnail', async (storyId, releaseId, conceptIndex) => {
    const rel = await repo.loadRelease(storyId, releaseId)
    const yt = rel.platform === 'youtube'
    const concepts = yt ? rel.publishing?.youtube?.thumbnailConcepts : rel.publishing?.tiktok?.coverConcepts
    const c = concepts?.[conceptIndex]
    if (!c) throw new Error('Chưa có ý tưởng thumbnail – bấm "Soạn gói xuất bản" trước')
    const story = await repo.loadStory(storyId)
    const folk = (await repo.loadLibrary()).folklore.find((f) => story.folkloreIds.includes(f.id))
    const job = await images.generateThumbnail(storyId, releaseId, c, {
      aspect: yt ? '16:9' : '9:16',
      sub: folk ? (rel.language === 'en' ? folk.nameEn : folk.nameVi) : '',
      badge: rel.partCount > 1 ? `PHẦN ${rel.partIndex}/${rel.partCount}` : ''
    })
    return { cost: job.estimatedCost }
  })
  handle('publish:cutShorts', async (storyId, releaseId) => {
    assertIdle(storyId, releaseId)
    let last = 0
    const r = await publish.cutShorts(storyId, releaseId, (p, m) => {
      if (p - last >= 0.2) {
        last = p
        logger.info(m, releaseId)
      }
    })
    return changed(storyId, r)
  })
  handle('performance:add', async (storyId, note) => changed(storyId, await publish.addPerformanceNote(storyId, note)))
  handle('performance:delete', async (storyId, noteId) => changed(storyId, await publish.deletePerformanceNote(storyId, noteId)))
  handle('costs:report', (month) => publish.costReport(month))
  handle('costs:exportCsv', async (month) => {
    const win = deps.getWindow()
    const opts = { title: 'Xuất sổ chi phí (CSV)', defaultPath: path.join(app.getPath('downloads'), `so-chi-phi_${month}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await publish.exportCostCsv(month, r.filePath)
    shell.showItemInFolder(r.filePath)
    return r.filePath
  })

  // ------------------------------------------------------------ GĐ7: rối 2D
  const notifyAllStories = async (): Promise<void> => {
    for (const s of await repo.listStories()) deps.emitDataChanged(s.id)
  }
  handle('puppet:createMock', async (characterId) => {
    const lib = await deps.puppet.createMockRig(characterId)
    await notifyAllStories()
    return lib
  })
  handle('puppet:remove', async (characterId) => {
    const lib = await deps.puppet.removeRig(characterId)
    await notifyAllStories()
    return lib
  })

  // ------------------------------------------------------------ GĐ6: giọng tự thu, xuất cho phần mềm dựng
  const { recording, exporter } = deps
  const pickDir = async (title: string, defaultPath: string): Promise<string | null> => {
    const win = deps.getWindow()
    const opts = { title, defaultPath, properties: ['openDirectory'] as 'openDirectory'[] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  }
  handle('recording:import', async (storyId, releaseId) => {
    assertIdle(storyId, releaseId)
    const win = deps.getWindow()
    const opts = {
      title: 'Chọn file giọng tự thu (đọc cả bài)',
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Âm thanh', extensions: RECORDING_EXTS }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return changed(storyId, await recording.importRecording(storyId, releaseId, r.filePaths[0]))
  })
  handle('recording:setSource', async (storyId, releaseId, source) => {
    assertIdle(storyId, releaseId)
    if (source !== 'tts' && source !== 'recorded') throw new Error('Nguồn giọng không hợp lệ')
    return changed(storyId, await recording.setSource(storyId, releaseId, source))
  })
  handle('recording:transcribe', async (storyId, releaseId, force) => {
    assertIdle(storyId, releaseId)
    const r = await recording.transcribeAndAlign(storyId, releaseId, !!force)
    changed(storyId, r.release)
    return r
  })
  handle('export:srt', (storyId, releaseId) => exporter.exportSrt(storyId, releaseId))
  handle('export:fcpxml', (storyId, releaseId) => exporter.exportFcpxml(storyId, releaseId))
  handle('export:capcut', async (storyId, releaseId) => {
    const { templateDir, draftsDir } = getCapcutDirs()
    if (!templateDir) throw new Error('Chưa chọn draft CapCut mẫu. Cách xử lý: tạo 1 draft trong CapCut có 1 ảnh + 1 file âm thanh + 1 dòng chữ, rồi bấm "Chọn draft mẫu".')
    if (!(await fs.stat(draftsDir).then((s) => s.isDirectory(), () => false))) throw new Error(`Không thấy thư mục draft của CapCut: ${draftsDir}. Cách xử lý: bấm "Chọn thư mục draft CapCut".`)
    return exporter.exportCapcut(storyId, releaseId, templateDir, draftsDir)
  })
  handle('export:chooseCapcutTemplate', async () => {
    const dir = await pickDir('Chọn THƯ MỤC draft CapCut mẫu', getCapcutDirs().draftsDir)
    if (!dir) return null
    await exporter.readCapcutTemplate(dir) // báo lỗi rõ ràng nếu không phải draft / draft bị mã hoá
    setCapcutDirs({ templateDir: dir })
    return getPublicSettings()
  })
  handle('export:chooseCapcutDrafts', async () => {
    const dir = await pickDir('Chọn thư mục chứa các draft của CapCut (com.lveditor.draft)', getCapcutDirs().draftsDir)
    if (!dir) return null
    setCapcutDirs({ draftsDir: dir })
    return getPublicSettings()
  })
  handle('export:reveal', async (absPath) => {
    // Chỉ cho mở trong thư mục dữ liệu hoặc thư mục draft CapCut
    const ok = [repo.dataRoot, getCapcutDirs().draftsDir].some((root) => path.resolve(absPath).toLowerCase().startsWith(path.resolve(root).toLowerCase()))
    if (!ok) throw new Error('Đường dẫn ngoài thư mục dữ liệu')
    shell.showItemInFolder(absPath)
  })

  handle('images:exportZip', async (storyId, maxEdge) => {
    const story = await repo.loadStory(storyId)
    const win = deps.getWindow()
    const opts = {
      title: 'Lưu tất cả ảnh (ZIP)',
      defaultPath: path.join(app.getPath('downloads'), `${story.id}_anh${maxEdge ? `_${maxEdge}px` : ''}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const res = await images.exportZip(storyId, r.filePath, maxEdge)
    shell.showItemInFolder(res.path)
    return res
  })

  handle('app:getInfo', (): AppInfo => {
    const s = getPublicSettings()
    return {
      version: app.getVersion(),
      mediaBaseUrl: deps.mediaBaseUrl,
      dataRoot: repo.dataRoot,
      storiesRoot: repo.storiesRoot,
      logFile: logger.logFile,
      mockMode: s.mockMode
    }
  })

  handle('library:get', () => repo.loadLibrary())
  handle('stories:list', () => repo.listStories())
  handle('story:get', (storyId) => repo.loadBundle(storyId))

  handle('story:resetSample', async () => {
    const list = await repo.listStories()
    for (const s of list) for (const r of s.releases) if (runner.isRunning(s.id, r.id)) throw new Error('Hãy huỷ pipeline đang chạy trước')
    await repo.ensureSampleData(true)
    await deps.puppet.ensureSampleRig()
    logger.info('Đã khôi phục dữ liệu mẫu (giữ lại media đã tạo làm cache)')
    for (const s of list) deps.emitDataChanged(s.id)
  })

  handle('release:updateScene', async (storyId, releaseId, sceneId, patch) => {
    if (runner.isRunning(storyId, releaseId)) throw new Error('Pipeline đang chạy – hãy đợi tới điểm duyệt để chỉnh')
    const release = await repo.loadRelease(storyId, releaseId)
    const scene = release.scenes.find((s) => s.id === sceneId)
    if (!scene) throw new Error(`Không tìm thấy cảnh ${sceneId}`)
    if (patch.motion) {
      if (patch.motion.level) scene.motion.level = patch.motion.level
      if (patch.motion.type) scene.motion.type = patch.motion.type
      if (patch.motion.intensity !== undefined) scene.motion.intensity = Math.min(1, Math.max(0, patch.motion.intensity))
      if (patch.motion.easing) scene.motion.easing = patch.motion.easing
    }
    if (patch.transition) {
      if (patch.transition.type) scene.transition.type = patch.transition.type
      if (patch.transition.durationSec !== undefined)
        scene.transition.durationSec = Math.min(2, Math.max(0, patch.transition.durationSec))
    }
    if (patch.isHero !== undefined) scene.isHero = patch.isHero
    await repo.saveRelease(release)
    deps.emitDataChanged(storyId)
    return release
  })

  handle('pipeline:start', async (storyId, releaseId, mode) => {
    if (!RUN_MODES.includes(mode)) throw new Error('Chế độ chạy không hợp lệ')
    await runner.start(storyId, releaseId, mode)
  })
  handle('pipeline:continue', (storyId, releaseId, decision) => runner.continue(storyId, releaseId, decision ?? 'approved'))
  handle('pipeline:cancel', (storyId, releaseId) => runner.cancel(storyId, releaseId))
  handle('pipeline:resetFrom', (storyId, releaseId, stepNo) => runner.resetFrom(storyId, releaseId, stepNo))

  handle('exports:list', async (storyId, releaseId): Promise<ExportFile[]> => {
    const dir = path.join(repo.releaseDir(storyId, releaseId), 'exports')
    await fs.mkdir(dir, { recursive: true })
    const names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.mp4'))
    const files: ExportFile[] = []
    for (const name of names) {
      const abs = path.join(dir, name)
      const st = await fs.stat(abs)
      files.push({ name, absPath: abs, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() })
    }
    return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  })

  handle('exports:openFolder', async (storyId, releaseId) => {
    const dir = path.join(repo.releaseDir(storyId, releaseId), 'exports')
    await fs.mkdir(dir, { recursive: true })
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })

  handle('exports:openFile', async (storyId, releaseId, fileName) => {
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) throw new Error('Tên file không hợp lệ')
    const err = await shell.openPath(path.join(repo.releaseDir(storyId, releaseId), 'exports', fileName))
    if (err) throw new Error(err)
  })

  handle('log:history', () => logger.history())
  handle('settings:get', () => getPublicSettings())
  handle('settings:update', (patch) => updateSettings(patch))
  handle('settings:setApiKey', (providerId, apiKey) => setApiKey(providerId, apiKey))
}
