/**
 * Kiểm thử giao diện tự động (chỉ khi đặt biến môi trường FHS_UI_SMOKE=<thư mục ảnh>):
 * cửa sổ ẩn, lần lượt mở từng màn hình qua store của renderer, chụp ảnh từng màn, ghi lỗi console, rồi thoát.
 * Không đụng chuột/bàn phím của người dùng. Dữ liệu dùng thư mục riêng (FHS_DATA_ROOT).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { logger } from './logger'

const SCREENS = ['home', 'story', 'folklore', 'channel', 'script', 'voice', 'film', 'storyboard', 'autoedit', 'publish', 'costs', 'settings']

export async function runUiSmoke(win: BrowserWindow, outDir: string): Promise<void> {
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message)
  })
  await fs.mkdir(outDir, { recursive: true })
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await wait(2500)
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code, true)
  const shots: string[] = []
  const storyId = process.env['FHS_UI_SMOKE_STORY']
  if (storyId) {
    await js(`window.__fhsStore.getState().selectStory(${JSON.stringify(storyId)})`)
    await wait(800)
  }
  // Tuỳ chọn: thao tác thật qua IPC (tạo ảnh nhân vật / ảnh cảnh) để kiểm tra trọn luồng hàng đợi → giao diện
  const gen = process.env['FHS_UI_SMOKE_GEN']
  if (gen) {
    const [charId, sceneId] = gen.split(',')
    await js(`(async () => {
      const st = window.__fhsStore.getState()
      const storyId = st.currentStoryId
      await window.api.invoke('images:generateCharacter', ${JSON.stringify(charId)}, 'sheet', { storyId })
      if (${JSON.stringify(sceneId ?? '')}) await window.api.invoke('images:generateScenes', storyId, [${JSON.stringify(sceneId ?? '')}], '9:16', {})
    })()`)
    await wait(6000)
  }
  // Sổ hiệu quả: thêm 1 dòng số liệu mẫu cho bản TikTok (chỉ dữ liệu kiểm thử) ⇒ chụp được banner gợi ý chuyển thể
  if (process.env['FHS_UI_SMOKE_PERF']) {
    await js(`(async () => {
      const st = window.__fhsStore.getState()
      const tt = st.bundle?.releases.find((r) => r.platform === 'tiktok')
      if (tt && !st.bundle.story.performanceNotes.length) {
        await window.api.invoke('performance:add', st.currentStoryId, { releaseId: tt.id, date: '2026-10-20', views: 25000, avgWatchPercent: 52, likes: 1800, comments: 240, shares: 310, notes: 'Bình luận hỏi phần tiếp' })
        await st.refresh()
      }
    })()`)
    await wait(800)
  }
  // Mỗi release: các màn làm việc trên release đang chọn
  const releaseIds = (await js('window.__fhsStore.getState().bundle?.releases.map(r => r.id) ?? []')) as string[]
  for (const [ri, rid] of releaseIds.slice(0, 2).entries()) {
    await js(`window.__fhsStore.getState().selectRelease(${JSON.stringify(rid)})`)
    for (const s of ri === 0 ? SCREENS : ['script', 'voice', 'autoedit', 'publish']) {
      await js(`window.__fhsStore.getState().setScreen('${s}')`)
      await wait(1200)
      const img = await win.webContents.capturePage()
      const file = path.join(outDir, `${ri}-${s}.png`)
      await fs.writeFile(file, img.toPNG())
      shots.push(file)
      if (s === 'story') {
        // Cuộn xuống cuối (Sổ hiệu quả nằm dưới cùng)
        await js(`document.querySelector('.overflow-auto')?.scrollTo(0, 1e6)`)
        await wait(500)
        const bottom = path.join(outDir, `${ri}-${s}-bottom.png`)
        await fs.writeFile(bottom, (await win.webContents.capturePage()).toPNG())
        shots.push(bottom)
      }
    }
  }
  const report = { screens: shots.length, errors }
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  logger.info(`UI smoke: ${shots.length} ảnh, ${errors.length} lỗi console`)
  app.quit()
}
