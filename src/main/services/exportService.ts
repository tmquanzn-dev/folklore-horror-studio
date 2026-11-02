/**
 * Xuất cho phần mềm dựng (GĐ6): SRT, FCPXML (Final Cut / DaVinci Resolve), CapCut theo draft mẫu.
 * Timeline lấy từ CÙNG buildCompositionProps với lúc render ⇒ cảnh/thời lượng khớp video MP4.
 * File ghi vào releases/<id>/exports/edit/ (CapCut ghi thẳng vào thư mục draft của CapCut).
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildCompositionProps } from '../../shared/composition'
import { platformsConfig } from '../../shared/config'
import { CapcutTemplateError, fillCapcutTemplate, parseCapcutDraft, updateCapcutMeta, type CapcutTimeline } from '../../shared/logic/capcut'
import { buildFcpxml, buildSrt, captionCues, translationCues, type FcpClip } from '../../shared/logic/exportFormats'
import type { Library, Release, Story } from '../../shared/types'
import { logger } from '../logger'
import { probeDuration } from '../media/ffmpeg'
import type { ExportResult } from '../providers/interfaces'
import type { StoryRepository } from '../storage/storyRepo'

/** Tên file/thư mục an toàn trên Windows (giữ dấu tiếng Việt) */
export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'draft'
}

export const CAPCUT_CONTENT_FILES = ['draft_content.json', 'draft_info.json']

interface Visual {
  path: string
  kind: 'image' | 'video'
  start: number
  end: number
  name: string
}

export class ExportService {
  constructor(private readonly repo: StoryRepository) {}

  private async ctx(storyId: string, releaseId: string): Promise<{ story: Story; release: Release; lib: Library }> {
    const [story, release, lib] = await Promise.all([this.repo.loadStory(storyId), this.repo.loadRelease(storyId, releaseId), this.repo.loadLibrary()])
    if (!release.voiceTrack?.mixedPath || release.scenes.length === 0) throw new Error('Bản phát hành chưa có giọng/cảnh – chạy AutoEdit tới bước 19 trước khi xuất')
    return { story, release, lib }
  }

  private outDir(storyId: string, releaseId: string): string {
    return path.join(this.repo.releaseDir(storyId, releaseId), 'exports', 'edit')
  }

  private baseName(story: Story, release: Release): string {
    return safeName(`${story.name}_${release.platform}_${release.language}${release.partCount > 1 ? `_p${release.partIndex}` : ''}`)
  }

  /** Cảnh → ảnh/clip tuyệt đối, cùng thời lượng như video render */
  timeline(story: Story, release: Release, lib: Library): { visuals: Visual[]; width: number; height: number; fps: number; total: number } {
    const props = buildCompositionProps({
      story,
      release,
      glossary: lib.pronunciations.filter((p) => p.language === release.language),
      subtitleStyle: null,
      mediaUrl: (rel) => rel,
      fps: platformsConfig.fps,
      sizes: platformsConfig.aspectSizes,
      parallaxFactors: platformsConfig.parallax.layerFactors
    })
    const visuals: Visual[] = []
    for (const s of props.scenes) {
      const still = s.src ?? s.layers?.[0] ?? null
      const name = `Cảnh ${s.index + 1}${s.label ? ` – ${s.label}` : ''}`
      let t = s.startSec
      if (s.clip) {
        const end = Math.min(s.endSec, s.startSec + s.clip.durationSec)
        visuals.push({ path: this.repo.resolveInStory(story.id, s.clip.src), kind: 'video', start: t, end, name: `${name} (video AI)` })
        t = end
      }
      if (still && s.endSec - t > 0.04) visuals.push({ path: this.repo.resolveInStory(story.id, still), kind: 'image', start: t, end: s.endSec, name })
    }
    return { visuals, width: props.width, height: props.height, fps: props.fps, total: props.durationSec }
  }

  private captions(release: Release): { main: ReturnType<typeof captionCues>; vi: ReturnType<typeof captionCues> } {
    const lines = release.script.lines.filter((l) => l.start != null && l.end != null)
    const main = captionCues(lines.map((l) => ({ text: l.text, start: l.start as number, end: l.end as number, words: l.wordTimings ?? null })))
    const vi =
      release.language !== 'vi'
        ? translationCues(lines.filter((l) => l.translationVi?.trim()).map((l) => ({ translation: l.translationVi as string, start: l.start as number, end: l.end as number })))
        : []
    return { main, vi }
  }

  // ---------------------------------------------------------------- SRT

  async exportSrt(storyId: string, releaseId: string): Promise<ExportResult> {
    const { story, release } = await this.ctx(storyId, releaseId)
    const dir = this.outDir(storyId, releaseId)
    await fs.mkdir(dir, { recursive: true })
    const base = this.baseName(story, release)
    const { main, vi } = this.captions(release)
    const files: string[] = []
    const f1 = path.join(dir, `${base}.${release.language}.srt`)
    await fs.writeFile(f1, '﻿' + buildSrt(main), 'utf8')
    files.push(f1)
    if (vi.length) {
      const f2 = path.join(dir, `${base}.vi.srt`)
      await fs.writeFile(f2, '﻿' + buildSrt(vi), 'utf8')
      files.push(f2)
    }
    logger.info(`Xuất SRT: ${files.map((f) => path.basename(f)).join(', ')}`, releaseId)
    return { files, warnings: release.voiceSource === 'recorded' ? [] : ['Mốc từng từ là ước lượng (giọng TTS) – mốc câu chính xác'] }
  }

  // ---------------------------------------------------------------- FCPXML

  async exportFcpxml(storyId: string, releaseId: string): Promise<ExportResult> {
    const { story, release, lib } = await this.ctx(storyId, releaseId)
    const tl = this.timeline(story, release, lib)
    const vt = release.voiceTrack!
    const mixAbs = this.repo.resolveInStory(storyId, vt.mixedPath!)
    const audio = [{ name: 'Mix (giọng + âm thanh)', src: pathToFileURL(mixAbs).href, durationSec: await probeDuration(mixAbs), enabled: true }]
    if (vt.processedPath && vt.processedPath !== vt.mixedPath) {
      const v = this.repo.resolveInStory(storyId, vt.processedPath)
      audio.push({ name: 'Giọng riêng (tắt sẵn)', src: pathToFileURL(v).href, durationSec: await probeDuration(v), enabled: false })
    }
    const clips: FcpClip[] = tl.visuals.map((v) => ({ name: v.name, src: pathToFileURL(v.path).href, kind: v.kind, start: v.start, end: v.end }))
    const xmlText = buildFcpxml({
      name: `${story.name} – ${release.title}`,
      fps: tl.fps,
      width: tl.width,
      height: tl.height,
      totalSec: tl.total,
      clips,
      audio,
      markers: release.chapters.map((c) => ({ time: c.start, name: c.title }))
    })
    const dir = this.outDir(storyId, releaseId)
    await fs.mkdir(dir, { recursive: true })
    const base = this.baseName(story, release)
    const file = path.join(dir, `${base}.fcpxml`)
    await fs.writeFile(file, xmlText, 'utf8')
    const srt = await this.exportSrt(storyId, releaseId)
    logger.info(`Xuất FCPXML: ${path.basename(file)} (${clips.length} clip)`, releaseId)
    return {
      files: [file, ...srt.files],
      warnings: [
        'Chuyển động Ken Burns / parallax và phụ đề cháy chữ không xuất sang FCPXML – timeline dùng ảnh tĩnh đúng thời lượng; nhập file .srt làm track phụ đề',
        'DaVinci Resolve: File → Import → Timeline… chọn file .fcpxml. Premiere Pro không đọc FCPXML gốc.'
      ]
    }
  }

  // ---------------------------------------------------------------- CapCut

  /** Đọc + kiểm tra draft mẫu (dùng khi người dùng chọn thư mục mẫu) */
  async readCapcutTemplate(templateDir: string): Promise<{ file: string; json: Record<string, unknown> }> {
    for (const name of CAPCUT_CONTENT_FILES) {
      const f = path.join(templateDir, name)
      const text = await fs.readFile(f, 'utf8').catch(() => null)
      if (text === null) continue
      return { file: name, json: parseCapcutDraft(text, name) }
    }
    throw new CapcutTemplateError(`Thư mục "${path.basename(templateDir)}" không phải draft CapCut (không có ${CAPCUT_CONTENT_FILES.join(' / ')})`)
  }

  async exportCapcut(storyId: string, releaseId: string, templateDir: string, draftsRoot: string): Promise<ExportResult> {
    const { story, release, lib } = await this.ctx(storyId, releaseId)
    const tpl = await this.readCapcutTemplate(templateDir)
    const tl = this.timeline(story, release, lib)
    const mixAbs = this.repo.resolveInStory(storyId, release.voiceTrack!.mixedPath!)
    const timeline: CapcutTimeline = {
      width: tl.width,
      height: tl.height,
      fps: tl.fps,
      totalSec: tl.total,
      visuals: tl.visuals,
      audio: { path: mixAbs, durationSec: await probeDuration(mixAbs), name: 'mix.wav' },
      captions: this.captions(release).main
    }
    const { draft, warnings } = fillCapcutTemplate(tpl.json, timeline, () => randomUUID().toUpperCase())

    // Thư mục draft mới (không ghi đè draft có sẵn)
    let name = safeName(`${story.name} – ${release.platform === 'tiktok' ? 'TikTok' : 'YouTube'} ${release.language.toUpperCase()}${release.partCount > 1 ? ` P${release.partIndex}` : ''}`)
    let dest = path.join(draftsRoot, name)
    for (let k = 2; await fs.stat(dest).then(() => true, () => false); k++) {
      dest = path.join(draftsRoot, `${name} (${k})`)
      if (k > 99) throw new Error('Quá nhiều draft trùng tên')
    }
    name = path.basename(dest)
    await fs.cp(templateDir, dest, { recursive: true })
    await fs.writeFile(path.join(dest, tpl.file), JSON.stringify(draft), 'utf8')
    // Bản sao nội dung còn lại (một số bản CapCut giữ cả 2 file) ⇒ ghi cùng nội dung
    for (const other of CAPCUT_CONTENT_FILES.filter((f) => f !== tpl.file)) {
      if (await fs.stat(path.join(dest, other)).then(() => true, () => false)) await fs.writeFile(path.join(dest, other), JSON.stringify(draft), 'utf8')
    }
    const metaFile = path.join(dest, 'draft_meta_info.json')
    const metaText = await fs.readFile(metaFile, 'utf8').catch(() => null)
    if (metaText) {
      try {
        const meta = JSON.parse(metaText.replace(/^﻿/, '')) as Record<string, unknown>
        const updated = updateCapcutMeta(meta, { id: draft['id'] as string, name, folder: dest, root: draftsRoot, durationSec: tl.total, nowUs: Date.now() * 1000 })
        await fs.writeFile(metaFile, JSON.stringify(updated), 'utf8')
      } catch {
        warnings.push('draft_meta_info.json của mẫu không đọc được – CapCut có thể hiện tên draft của mẫu')
      }
    } else warnings.push('Mẫu không có draft_meta_info.json – nếu CapCut không thấy draft, mở thư mục draft bằng tay')
    warnings.push('Định dạng draft CapCut không được công bố – nếu CapCut báo lỗi khi mở, dùng FCPXML + SRT thay thế')
    logger.info(`Xuất draft CapCut "${name}" (${tl.visuals.length} cảnh, ${timeline.captions.length} phụ đề)`, releaseId)
    return { files: [dest], warnings }
  }
}
