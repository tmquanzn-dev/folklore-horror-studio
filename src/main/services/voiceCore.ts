/**
 * Lõi giọng đọc dùng chung cho pipeline (bước 11–12) và Voice Studio:
 * - synthesizeLine: áp từ điển phát âm → chọn giọng theo người nói → gọi TTS → lưu take (cache theo hash)
 * - processTake: xử lý giọng theo postProcessChain của giọng đó (cache theo hash take + chuỗi xử lý)
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { applyPronunciation } from '../../shared/logic/pronunciation'
import { resolveVoice } from '../../shared/logic/voices'
import { toRelPath } from '../../shared/media'
import type { Library, Release, ScriptLine, Story, Take, VoiceProcessChain, VoiceProfile } from '../../shared/types'
import { buildVoiceFilter, runFfmpeg } from '../media/ffmpeg'
import type { ProviderRegistry } from '../providers/registry'
import type { StoryRepository } from '../storage/storyRepo'

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function voiceForLine(story: Story, release: Release, line: ScriptLine, library: Library): VoiceProfile {
  const v = resolveVoice(line.speakerId, release.language, library, story.channelPresetId)
  if (!v) {
    const who = library.characters.find((c) => c.id === line.speakerId)?.name ?? line.speakerId
    throw new Error(`Chưa có giọng ${release.language.toUpperCase()} cho "${who}". Cách xử lý: gán giọng ở màn Kênh & Nhân vật hoặc Voice Studio.`)
  }
  return v
}

export function takeHash(text: string, voice: VoiceProfile, line: ScriptLine, providerId: string, model: string, nonce = ''): string {
  const payload = JSON.stringify({
    text,
    providerId,
    model,
    voice: voice.providerVoiceId,
    speed: voice.speed,
    instructions: voice.baseInstructions,
    settings: voice.providerSettings,
    delivery: { tags: line.delivery.tags, instructions: line.delivery.instructions, pace: line.delivery.pace },
    nonce
  })
  return createHash('sha1').update(payload).digest('hex').slice(0, 12)
}

export interface SynthArgs {
  repo: StoryRepository
  providers: ProviderRegistry
  story: Story
  release: Release
  line: ScriptLine
  library: Library
  signal?: AbortSignal
  /** Khác rỗng ⇒ ép tạo take mới (nút "Tạo lại") */
  nonce?: string
}

export interface SynthResult {
  take: Take
  generated: boolean
  characters: number
  cost: number
  provider: string
}

/** Văn bản thực sự gửi TTS (đã áp từ điển phát âm) + giọng + provider – dùng cho ước tính chi phí */
export function plannedTts(story: Story, release: Release, line: ScriptLine, library: Library, providers: ProviderRegistry) {
  const voice = voiceForLine(story, release, line, library)
  const provider = providers.tts(voice.providerId)
  const { text } = applyPronunciation(line.text, library.pronunciations, release.language)
  const hash = takeHash(text, voice, line, provider.id, provider.model)
  return { voice, provider, text, hash }
}

export async function synthesizeLine(a: SynthArgs): Promise<SynthResult> {
  const { voice, provider, text } = plannedTts(a.story, a.release, a.line, a.library, a.providers)
  const hash = takeHash(text, voice, a.line, provider.id, provider.model, a.nonce ?? '')
  const takesDir = path.join(a.repo.releaseDir(a.story.id, a.release.id), 'voice', 'takes')
  await fs.mkdir(takesDir, { recursive: true })
  const fileName = `${a.line.id}_${hash}.wav`
  const abs = path.join(takesDir, fileName)
  const existing = a.line.takes.find((t) => t.hash === hash)
  if (existing && (await fileExists(abs))) {
    return { take: existing, generated: false, characters: 0, cost: 0, provider: provider.id }
  }
  const res = await provider.synthesize({ text, language: a.release.language, voice, delivery: a.line.delivery, outputPath: abs, signal: a.signal })
  const take: Take = {
    id: randomUUID(),
    path: toRelPath('releases', a.release.id, 'voice', 'takes', fileName),
    provider: res.provider,
    model: res.model,
    hash,
    duration: res.duration,
    createdAt: new Date().toISOString()
  }
  a.line.takes = [...a.line.takes.filter((t) => t.hash !== hash), take]
  return { take, generated: true, characters: res.characters, cost: res.cost, provider: res.provider }
}

export function chainHash(chain: VoiceProcessChain): string {
  return createHash('sha1').update(JSON.stringify(chain)).digest('hex').slice(0, 8)
}

/** Take đã xử lý giọng (lọc, nén, EQ, reverb) theo chuỗi của giọng – nằm trong cache/ của Story */
export async function processTake(
  repo: StoryRepository,
  storyId: string,
  take: Take,
  chain: VoiceProcessChain,
  signal?: AbortSignal
): Promise<{ abs: string; rel: string }> {
  const name = `proc_${take.hash}_${chainHash(chain)}.wav`
  const rel = toRelPath('cache', name)
  const abs = repo.resolveInStory(storyId, rel)
  if (!(await fileExists(abs))) {
    await fs.mkdir(path.dirname(abs), { recursive: true })
    const src = repo.resolveInStory(storyId, take.path)
    const tmp = `${abs}.tmp.wav`
    await runFfmpeg(['-i', src, '-af', buildVoiceFilter(chain), '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', tmp], signal)
    await fs.rename(tmp, abs)
  }
  return { abs, rel }
}
