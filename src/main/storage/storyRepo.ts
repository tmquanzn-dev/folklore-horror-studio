/**
 * Lưu trữ dạng thư mục – mỗi Story là một thư mục:
 *   <dataRoot>/library.json                       – kênh, truyền thuyết, nhân vật, giọng, từ điển
 *   <dataRoot>/Truyện ma/<storyId>/story.json
 *                               /bank/            – ảnh ngân hàng cảnh
 *                               /cache/
 *                               /releases/<releaseId>/release.json
 *                                                    /voice /sfx /exports
 * Ghi file nguyên tử (ghi .tmp rồi rename) + khoá tuần tự theo file để không hỏng JSON.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ReleaseSummary, StoryBundle, StorySummary } from '../../shared/ipc'
import { getStepDef, pipelineProgress } from '../../shared/pipeline'
import {
  createSampleLibrary,
  createSampleReleases,
  createSampleStory,
  SAMPLE_STORY_ID
} from '../../shared/sampleData'
import type { Library, Release, Story } from '../../shared/types'
import { isLegacyLibrary, migrateLibrary, migrateRelease, migrateStory } from '../../shared/migrate'

const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** Tên thư mục chứa Story – cố ý có dấu + khoảng trắng để luôn kiểm thử đường dẫn tiếng Việt */
export const STORIES_FOLDER_NAME = 'Truyện ma'
/** Thư mục ảnh nhân vật (character sheet, biểu cảm, trạng thái) – nằm trong storiesRoot để media server phục vụ được */
export const CHARACTERS_FOLDER = '_characters'

export class StoryRepository {
  private locks = new Map<string, Promise<void>>()

  constructor(readonly dataRoot: string) {}

  get storiesRoot(): string {
    return path.join(this.dataRoot, STORIES_FOLDER_NAME)
  }

  private assertId(id: string, what: string): void {
    if (!SAFE_ID.test(id)) throw new Error(`${what} không hợp lệ: "${id}"`)
  }

  storyDir(storyId: string): string {
    this.assertId(storyId, 'Mã Story')
    return path.join(this.storiesRoot, storyId)
  }

  releaseDir(storyId: string, releaseId: string): string {
    this.assertId(releaseId, 'Mã Release')
    return path.join(this.storyDir(storyId), 'releases', releaseId)
  }

  /** Đổi đường dẫn tương đối (a/b/c) trong Story thành đường dẫn tuyệt đối; chặn thoát ra ngoài thư mục */
  resolveInStory(storyId: string, relPath: string): string {
    const base = this.storyDir(storyId)
    const abs = path.resolve(base, ...relPath.split('/'))
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`Đường dẫn ngoài thư mục Story: ${relPath}`)
    return abs
  }

  private async withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(file) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((r) => (release = r))
    this.locks.set(file, prev.then(() => next))
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(file) === next) this.locks.delete(file)
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await this.withLock(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
      // Windows đôi khi khoá file tạm thời (antivirus/indexer) ⇒ thử lại vài lần
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(tmp, file)
          return
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
          await new Promise((r) => setTimeout(r, 60 * (attempt + 1)))
        }
      }
    })
  }

  private async readJson<T>(file: string): Promise<T> {
    return this.withLock(file, async () => JSON.parse(await fs.readFile(file, 'utf8')) as T)
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------------ Library

  private get libraryFile(): string {
    return path.join(this.dataRoot, 'library.json')
  }

  async loadLibrary(): Promise<Library> {
    return migrateLibrary(await this.readJson<Library>(this.libraryFile))
  }

  async saveLibrary(lib: Library): Promise<void> {
    await this.writeJson(this.libraryFile, lib)
  }

  // ------------------------------------------------------------------ Story

  async loadStory(storyId: string): Promise<Story> {
    return migrateStory(await this.readJson<Story>(path.join(this.storyDir(storyId), 'story.json')))
  }

  async saveStory(story: Story): Promise<void> {
    story.updatedAt = new Date().toISOString()
    await this.writeJson(path.join(this.storyDir(story.id), 'story.json'), story)
  }

  async loadRelease(storyId: string, releaseId: string): Promise<Release> {
    return migrateRelease(await this.readJson<Release>(path.join(this.releaseDir(storyId, releaseId), 'release.json')))
  }

  async saveRelease(release: Release): Promise<void> {
    release.updatedAt = new Date().toISOString()
    await this.writeJson(path.join(this.releaseDir(release.storyId, release.id), 'release.json'), release)
  }

  // ------------------------------------------------------------------ Đọc–sửa–ghi nguyên tử
  // Nhiều job ảnh chạy song song cùng sửa story.json / library.json ⇒ phải tuần tự hoá cả chu trình đọc-sửa-ghi.

  private mutexes = new Map<string, Promise<void>>()

  private async mutate<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutexes.get(key) ?? Promise.resolve()
    let done!: () => void
    const next = new Promise<void>((r) => (done = r))
    const chained = prev.then(() => next)
    this.mutexes.set(key, chained)
    await prev
    try {
      return await fn()
    } finally {
      done()
      if (this.mutexes.get(key) === chained) this.mutexes.delete(key)
    }
  }

  updateStory(storyId: string, fn: (s: Story) => void | Promise<void>): Promise<Story> {
    return this.mutate(`story:${storyId}`, async () => {
      const s = await this.loadStory(storyId)
      await fn(s)
      await this.saveStory(s)
      return s
    })
  }

  updateLibrary(fn: (l: Library) => void | Promise<void>): Promise<Library> {
    return this.mutate('library', async () => {
      const l = await this.loadLibrary()
      await fn(l)
      await this.saveLibrary(l)
      return l
    })
  }

  updateRelease(storyId: string, releaseId: string, fn: (r: Release) => void | Promise<void>): Promise<Release> {
    return this.mutate(`release:${storyId}/${releaseId}`, async () => {
      const r = await this.loadRelease(storyId, releaseId)
      await fn(r)
      await this.saveRelease(r)
      return r
    })
  }

  // ------------------------------------------------------------------ Ảnh nhân vật (dùng chung mọi Story)

  /** <storiesRoot>/_characters – phục vụ qua media server với "storyId" = "_characters" */
  get charactersRoot(): string {
    return path.join(this.storiesRoot, CHARACTERS_FOLDER)
  }

  resolveCharacterPath(relPath: string): string {
    const base = this.charactersRoot
    const abs = path.resolve(base, ...relPath.split('/'))
    if (!abs.startsWith(base + path.sep)) throw new Error(`Đường dẫn ngoài thư mục nhân vật: ${relPath}`)
    return abs
  }

  async loadBundle(storyId: string): Promise<StoryBundle> {
    const story = await this.loadStory(storyId)
    const releases: Release[] = []
    for (const id of story.releaseIds) {
      try {
        releases.push(await this.loadRelease(storyId, id))
      } catch {
        // Release bị xoá/hỏng – bỏ qua để Story vẫn mở được
      }
    }
    return { story, releases }
  }

  async listStories(): Promise<StorySummary[]> {
    await fs.mkdir(this.storiesRoot, { recursive: true })
    const entries = await fs.readdir(this.storiesRoot, { withFileTypes: true })
    const out: StorySummary[] = []
    for (const e of entries) {
      if (!e.isDirectory() || !SAFE_ID.test(e.name)) continue
      if (!(await this.exists(path.join(this.storiesRoot, e.name, 'story.json')))) continue
      try {
        const { story, releases } = await this.loadBundle(e.name)
        out.push({
          id: story.id,
          name: story.name,
          status: story.status,
          updatedAt: story.updatedAt,
          costActual: (story.costs?.actual ?? 0) + releases.reduce((s, r) => s + r.costs.actual, 0),
          budgetLimit: story.budget.limitUsd,
          releases: releases.map(summarizeRelease)
        })
      } catch {
        // story.json hỏng – bỏ qua
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return out
  }

  /** Tạo cấu trúc thư mục cho Story + các Release */
  async ensureStoryFolders(story: Story): Promise<void> {
    const dir = this.storyDir(story.id)
    await fs.mkdir(path.join(dir, 'bank'), { recursive: true })
    await fs.mkdir(path.join(dir, 'cache'), { recursive: true })
    for (const rid of story.releaseIds) {
      const rdir = this.releaseDir(story.id, rid)
      for (const sub of ['voice', 'sfx', 'exports']) await fs.mkdir(path.join(rdir, sub), { recursive: true })
    }
  }

  /**
   * Lần đầu mở app: ghi library.json + Story mẫu. force = khôi phục dữ liệu mẫu
   * (ghi đè JSON, giữ lại file media đã tạo – cache sẽ dùng lại).
   */
  async ensureSampleData(force = false): Promise<void> {
    await fs.mkdir(this.storiesRoot, { recursive: true })
    // Dữ liệu mẫu từ GĐ1 (nhân vật chưa có scope/cast) ⇒ nâng cấp bằng cách ghi lại dữ liệu mẫu mới, giữ media làm cache
    if (!force && (await this.exists(this.libraryFile))) {
      const raw = await this.readJson<Library>(this.libraryFile)
      if (isLegacyLibrary(raw)) force = true
    }
    if (force || !(await this.exists(this.libraryFile))) await this.saveLibrary(createSampleLibrary())
    const storyFile = path.join(this.storyDir(SAMPLE_STORY_ID), 'story.json')
    if (!force && (await this.exists(storyFile))) return
    const story = createSampleStory()
    await this.ensureStoryFolders(story)
    await this.saveStory(story)
    for (const r of createSampleReleases()) await this.saveRelease(r)
  }
}

export function summarizeRelease(r: Release): ReleaseSummary {
  const st = r.pipelineState
  const current = st?.currentStep != null ? getStepDef(st.currentStep) : undefined
  const waiting = !!st && Object.values(st.steps).some((s) => s.status === 'waitingApproval')
  return {
    id: r.id,
    title: r.title,
    platform: r.platform,
    language: r.language,
    aspectRatio: r.aspectRatio,
    progress: pipelineProgress(st),
    running: !!st?.running,
    waitingApproval: waiting,
    currentStepLabel: current ? `Bước ${current.no}: ${current.title}` : st ? 'Đã dừng' : 'Chưa chạy'
  }
}
