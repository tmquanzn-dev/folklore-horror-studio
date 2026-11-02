/**
 * CHUYỂN THỂ KỊCH BẢN (bước 8) – mỗi Release được LLM viết lại từ dàn ý chung theo ngôn ngữ, nền tảng, độ dài.
 * - YouTube: một lượt LLM theo cấu trúc cold open → context → story → folkloreExplainer → outro.
 * - TikTok/Shorts (series): LLM viết toàn bộ phần thân → chia phần theo thời lượng (hàm thuần splitIntoParts)
 *   → LLM viết móc mở đầu + câu treo cho từng phần → Phần 1 = Release hiện tại, Phần 2..N = Release mới cùng seriesGroupId.
 */
import { platformsConfig, providersConfig } from '../../shared/config'
import { estimateLlmCost } from '../../shared/logic/costEstimate'
import { estimateSpeechSeconds } from '../../shared/logic/speech'
import { splitIntoParts } from '../../shared/logic/tiktokParts'
import { charactersForStory } from '../../shared/logic/voices'
import type {
  ChannelPreset,
  Character,
  Library,
  PlatformDefaults,
  Release,
  Script,
  ScriptLine,
  ScriptSection,
  ScriptSectionKind,
  Story
} from '../../shared/types'
import { emptyLedger } from '../../shared/sampleData'
import {
  adaptScriptTask,
  rewriteLineTask,
  seriesHooksTask,
  type RawScriptLine,
  type ScriptOut
} from '../llm/tasks'
import { logger } from '../logger'
import type { LlmJsonRequest, LlmProvider } from '../providers/interfaces'
import type { StoryRepository } from '../storage/storyRepo'

const pad = (n: number): string => String(n).padStart(2, '0')

const SECTION_TITLES: Record<ScriptSectionKind, [string, string]> = {
  hook: ['Hook', 'Móc mở đầu'],
  coldOpen: ['Cold open', 'Mở đầu lạnh'],
  context: ['Background', 'Bối cảnh'],
  story: ['The story', 'Câu chuyện'],
  folkloreExplainer: ['About the legend', 'Về truyền thuyết'],
  cliffhanger: ['Cliffhanger', 'Câu treo'],
  outro: ['Outro', 'Kết']
}

export function channelOf(library: Library, story: Story): ChannelPreset {
  const ch = library.channelPresets.find((c) => c.id === story.channelPresetId)
  if (!ch) throw new Error(`Không tìm thấy kênh "${story.channelPresetId}"`)
  return ch
}

export function platformDefaultsOf(channel: ChannelPreset, release: Pick<Release, 'platform'>): PlatformDefaults {
  return channel.platformDefaults[release.platform] ?? platformsConfig.platforms[release.platform]
}

export function narratorOf(library: Library): Character {
  const n =
    library.characters.find((c) => c.scope === 'channel' && c.role === 'narrator') ??
    library.characters.find((c) => c.scope === 'channel')
  if (!n) throw new Error('Kênh chưa có nhân vật người kể (scope "channel"). Cách xử lý: thêm ở màn Kênh & Nhân vật.')
  return n
}

/** Chạy một tác vụ LLM, ghi chi phí vào sổ của Release */
export async function runLlm<T>(llm: LlmProvider, req: LlmJsonRequest<T>, ledger: Release['costs']): Promise<T> {
  const res = await llm.generateJson(req)
  if (res.cost > 0) {
    ledger.entries.push({ provider: llm.id, kind: 'llm', units: res.inputTokens + res.outputTokens, cost: res.cost, timestamp: new Date().toISOString() })
    ledger.actual += res.cost
  }
  return res.data
}

export function estimateTaskCost(llmId: string, req: LlmJsonRequest<unknown>, expectedOutputChars: number): number {
  const price = llmId === 'mock' ? providersConfig.llm.mock : providersConfig.llm.openai
  return estimateLlmCost(req.system.length + req.user.length, expectedOutputChars, price)
}

function rawToLine(releaseId: string, n: number, sectionId: string, r: RawScriptLine, language: Release['language']): ScriptLine {
  const line: ScriptLine = {
    id: `${releaseId}-l${pad(n)}`,
    sectionId,
    beatId: r.beatId,
    speakerId: r.speakerId,
    text: r.text.trim(),
    delivery: {
      tags: r.tags,
      instructions: r.instructions,
      pace: Math.round(r.pace * 100) / 100,
      pauseBeforeMs: r.pauseBeforeMs,
      pauseAfterMs: r.pauseAfterMs
    },
    takes: [],
    selectedTakeId: null,
    start: null,
    end: null,
    glossaryTermIds: [],
    approval: { status: 'pending' }
  }
  if (language !== 'vi' && r.translationVi) line.translationVi = r.translationVi.trim()
  return line
}

export function toScript(releaseId: string, out: ScriptOut, language: Release['language']): Script {
  const sections: ScriptSection[] = out.sections.map((s) => ({
    id: `${releaseId}-sec-${s.kind}`,
    kind: s.kind,
    title: s.title,
    titleVi: s.titleVi ?? SECTION_TITLES[s.kind][1]
  }))
  const lines = out.lines.map((l, i) => rawToLine(releaseId, i + 1, `${releaseId}-sec-${l.sectionKind}`, l, language))
  // Sắp lại theo thứ tự section (LLM đôi khi trả lẫn lộn)
  const order = new Map(sections.map((s, i) => [s.id, i]))
  lines.sort((a, b) => (order.get(a.sectionId) ?? 0) - (order.get(b.sectionId) ?? 0))
  lines.forEach((l, i) => (l.id = `${releaseId}-l${pad(i + 1)}`))
  return { sections, lines }
}

function section(releaseId: string, kind: ScriptSectionKind, language: Release['language']): ScriptSection {
  const [en, vi] = SECTION_TITLES[kind]
  return { id: `${releaseId}-sec-${kind}`, kind, title: language === 'vi' ? vi : en, titleVi: vi }
}

export interface AdaptContext {
  repo: StoryRepository
  llm: LlmProvider
  story: Story
  release: Release
  library: Library
  signal?: AbortSignal
  log: (m: string, level?: 'info' | 'warn' | 'error') => void
}

export interface AdaptResult {
  script: Script
  /** Release Phần 2..N (chỉ series) */
  siblings: Release[]
  /** Id Release phần cũ không còn dùng (đã gỡ khỏi Story) */
  removedIds: string[]
  partCount: number
}

export async function adaptRelease(c: AdaptContext): Promise<AdaptResult> {
  const { story, release, library } = c
  if (story.outline.beats.length === 0) throw new Error('Story chưa có dàn ý – hãy tạo và duyệt dàn ý ở màn Story')
  if (story.outline.approval.status !== 'approved') throw new Error('Dàn ý chưa được duyệt – hãy duyệt ở màn Story trước khi chuyển thể')
  const channel = channelOf(library, story)
  const pd = platformDefaultsOf(channel, release)
  const narrator = narratorOf(library)
  const characters = charactersForStory(story.id, library.characters)
  const folklore = library.folklore.filter((f) => story.folkloreIds.includes(f.id))
  const glossary = library.pronunciations.filter((p) => p.language === release.language)
  const isSeries = pd.partDurationSec != null
  const base = { story, folklore, characters, narratorId: narrator.id, platform: release.platform, language: release.language, glossary }

  if (!isSeries) {
    const req = adaptScriptTask({ ...base, structure: pd.structure, targetSec: release.targetDuration })
    req.signal = c.signal
    const out = await runLlm(c.llm, req, release.costs)
    return { script: toScript(release.id, out, release.language), siblings: [], removedIds: [], partCount: 1 }
  }

  // ---------------- Series (TikTok / Shorts)
  if (release.partIndex > 1) throw new Error('Đây là Phần ' + release.partIndex + ' – hãy chuyển thể lại từ Phần 1 của series')
  const { hookSec, cliffhangerSec, toleranceRatio, minLastPartRatio } = platformsConfig.series
  const bodySec = Math.max(20, (pd.partDurationSec ?? 90) - hookSec - cliffhangerSec)
  const planned = Math.max(1, release.partCount)
  const req = adaptScriptTask({ ...base, structure: ['story'], targetSec: bodySec * planned })
  req.signal = c.signal
  const out = await runLlm(c.llm, req, release.costs)
  const rawLines = out.lines

  const est = (r: RawScriptLine): number =>
    estimateSpeechSeconds(r.text, release.language, r.pace, providersConfig.tts.mock) + (r.pauseBeforeMs + r.pauseAfterMs) / 1000
  const partIds = splitIntoParts(
    rawLines.map((r, i) => ({ id: String(i), beatId: r.beatId, estSec: est(r) })),
    { targetSec: bodySec, toleranceRatio, minLastPartRatio }
  )
  const parts = partIds.map((ids) => ids.map((i) => rawLines[Number(i)]))
  const n = parts.length
  c.log(`Chia series thành ${n} phần (~${Math.round(bodySec + hookSec + cliffhangerSec)}s/phần)`)

  const beatText = new Map(story.outline.beats.map((b) => [b.id, release.language === 'vi' ? b.summaryVi : b.summaryEn]))
  const hooksReq = seriesHooksTask(
    release.language,
    parts.map((p, i) => ({
      index: i + 1,
      summary: [...new Set(p.map((l) => beatText.get(l.beatId) ?? ''))].join(' / '),
      firstLine: p[0].text,
      lastLine: p[p.length - 1].text
    }))
  )
  hooksReq.signal = c.signal
  const hooks = await runLlm(c.llm, hooksReq, release.costs)

  const seriesGroupId = release.seriesGroupId ?? `series-${release.id}`
  const baseTitle = release.title.replace(/\s*–\s*Phần\s*\d+(\/\d+)?\s*$/, '')
  const scripts: Script[] = parts.map((p, i) => {
    const rid = i === 0 ? release.id : `${release.id}-p${i + 1}`
    const endKind: ScriptSectionKind = i === n - 1 ? 'outro' : 'cliffhanger'
    const h = hooks.parts[i]
    const first = p[0]
    const last = p[p.length - 1]
    const mk = (kind: ScriptSectionKind, beatId: string, t: { text: string; tags: string[]; instructions: string }): RawScriptLine => ({
      sectionKind: kind,
      beatId,
      speakerId: narrator.id,
      text: t.text,
      tags: t.tags,
      instructions: t.instructions,
      pace: kind === 'hook' ? 1 : 0.9,
      pauseBeforeMs: kind === 'hook' ? 100 : 400,
      pauseAfterMs: kind === 'hook' ? 600 : 500
    })
    const all = [mk('hook', first.beatId, h.hook), ...p, mk(endKind, last.beatId, h.ending)]
    return toScript(rid, { sections: [{ kind: 'hook', title: 'Hook' }, { kind: 'story', title: 'Story' }, { kind: endKind, title: endKind }], lines: all }, release.language)
  })
  // Tiêu đề section theo ngôn ngữ
  for (const s of scripts) s.sections = s.sections.map((sec) => ({ ...section(sec.id.replace(/-sec-.*/, ''), sec.kind, release.language) }))

  const siblings: Release[] = []
  for (let i = 1; i < n; i++) {
    const id = `${release.id}-p${i + 1}`
    let sib: Release
    try {
      sib = await c.repo.loadRelease(story.id, id)
    } catch {
      sib = { ...structuredClone(release), id, createdAt: new Date().toISOString(), costs: emptyLedger(release.costs.budgetLimit) }
    }
    Object.assign(sib, {
      title: `${baseTitle} – Phần ${i + 1}`,
      seriesGroupId,
      partIndex: i + 1,
      partCount: n,
      script: scripts[i],
      voiceTrack: null,
      scenes: [],
      chapters: [],
      subtitles: [],
      soundCues: [],
      publishing: null,
      pipelineState: null
    })
    siblings.push(sib)
  }
  // Phần thừa từ lần chuyển thể trước (số phần giảm) ⇒ gỡ khỏi Story
  const removedIds = story.releaseIds.filter((id) => {
    const m = new RegExp(`^${release.id}-p(\\d+)$`).exec(id)
    return m ? Number(m[1]) > n : false
  })
  release.title = `${baseTitle} – Phần 1`
  release.seriesGroupId = seriesGroupId
  release.partCount = n
  return { script: scripts[0], siblings, removedIds, partCount: n }
}

/** LLM viết lại một câu theo chỉ dẫn – trả về Release đã cập nhật (chưa lưu) */
export async function rewriteLine(c: {
  llm: LlmProvider
  release: Release
  library: Library
  lineId: string
  instruction: string
}): Promise<Release> {
  const lines = c.release.script.lines
  const idx = lines.findIndex((l) => l.id === c.lineId)
  if (idx < 0) throw new Error(`Không tìm thấy câu ${c.lineId}`)
  const name = (id: string): string => c.library.characters.find((x) => x.id === id)?.name ?? id
  const fmt = (l: ScriptLine): string => `${name(l.speakerId)}: ${l.text}`
  const line = lines[idx]
  const out = await runLlm(
    c.llm,
    rewriteLineTask({
      language: c.release.language,
      platform: c.release.platform,
      before: lines.slice(Math.max(0, idx - 3), idx).map(fmt),
      line: { text: line.text, speakerName: name(line.speakerId), tags: line.delivery.tags },
      after: lines.slice(idx + 1, idx + 3).map(fmt),
      instruction: c.instruction
    }),
    c.release.costs
  )
  line.text = out.text
  if (c.release.language !== 'vi') line.translationVi = out.translationVi ?? line.translationVi
  line.delivery = { ...line.delivery, tags: out.tags, instructions: out.instructions }
  line.approval = { status: 'pending' }
  logger.info(`Đã viết lại câu ${line.id}`, c.release.id)
  return c.release
}
