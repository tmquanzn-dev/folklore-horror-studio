/**
 * Cài đặt từng bước pipeline của Release. Mỗi hàm nhận StepContext, sửa ctx.release / ctx.story,
 * runner lưu release sau mỗi bước. Mọi media ghi vào đúng thư mục Story/Release.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import PQueue from 'p-queue'
import { buildCompositionProps } from '../../shared/composition'
import { platformsConfig, providersConfig } from '../../shared/config'
import { checkBudget, formatUsdShort, storySpent } from '../../shared/logic/costEstimate'
import { selectHeroScenes } from '../../shared/logic/hero'
import { assignMotions, assignTransitions, chooseParallaxScenes } from '../../shared/logic/motion'
import { findTermIds } from '../../shared/logic/pronunciation'
import { findDiversityViolations, matchScenes } from '../../shared/logic/sceneMatching'
import { buildSubtitles } from '../../shared/logic/subtitles'
import { computeLineTimings } from '../../shared/logic/timeline'
import { charactersForStory, isChannelCharacter } from '../../shared/logic/voices'
import { buildMediaUrl, toRelPath } from '../../shared/media'
import type { StepKey } from '../../shared/pipeline'
import type { ChannelPreset, MediaRef } from '../../shared/types'
import { buildVerticalFrame } from '../media/verticalFrame'
import { placeClips, readWav, sameFormat, wavDuration, writeWav, type WavData } from '../media/wav'
import { toWav44kMono } from '../media/ffmpeg'
import { adaptRelease, platformDefaultsOf } from '../services/scriptService'
import { fileExists, plannedTts, processTake, synthesizeLine, voiceForLine } from '../services/voiceCore'
import { type StepContext, type StepHandler, type StepResult, throwIfAborted } from './context'

const TARGET_WAV = { sampleRate: 44100, channels: 1, bitsPerSample: 16 }

function channelOf(ctx: StepContext): ChannelPreset {
  const ch = ctx.library.channelPresets.find((c) => c.id === ctx.story.channelPresetId)
  if (!ch) throw new Error(`Không tìm thấy ChannelPreset "${ctx.story.channelPresetId}"`)
  return ch
}

function beatIntensityFn(ctx: StepContext): (beatId: string) => number {
  const map = new Map(ctx.story.outline.beats.map((b) => [b.id, b.emotionalIntensity]))
  return (id) => map.get(id) ?? 0.5
}

// ---------------------------------------------------------------- Bước 6

const bankImages: StepHandler = async (ctx) => {
  // Ảnh tạo qua hàng đợi job (song song, retry, cache, ngân sách) – xem Film Studio → Hàng chờ
  const res = await ctx.deps.images.ensureSceneImages(ctx.story.id, ctx.signal, (p, msg) => ctx.progress(p, msg))
  // Đọc lại story (job ảnh đã cập nhật story.json)
  Object.assign(ctx.story, await ctx.deps.repo.loadStory(ctx.story.id))
  return {
    status: 'done',
    message: res.created > 0 ? `Đã tạo ${res.created} ảnh cảnh (${ctx.deps.providers.defaultImageProvider()})` : 'Dùng lại ảnh có sẵn'
  }
}

// ---------------------------------------------------------------- Bước 8

const adaptScript: StepHandler = async (ctx) => {
  const n = ctx.release.script.lines.length
  if (n > 0) return { status: 'done', message: `Giữ kịch bản hiện có (${n} câu). Muốn viết lại: Script Editor → "Chuyển thể lại".` }
  ctx.progress(0.1, `Đang chuyển thể bằng ${ctx.deps.providers.llm().id === 'mock' ? 'Mock LLM' : 'LLM'}…`)
  const res = await adaptRelease({
    repo: ctx.deps.repo,
    llm: ctx.deps.providers.llm(),
    story: ctx.story,
    release: ctx.release,
    library: ctx.library,
    signal: ctx.signal,
    log: ctx.log
  })
  ctx.release.script = res.script
  // Series: lưu các phần 2..N, cập nhật danh sách Release của Story
  if (res.siblings.length > 0 || res.removedIds.length > 0) {
    for (const s of res.siblings) await ctx.deps.repo.saveRelease(s)
    const updated = await ctx.deps.repo.updateStory(ctx.story.id, (st) => {
      const ids = st.releaseIds.filter((id) => !res.removedIds.includes(id))
      for (const s of res.siblings) if (!ids.includes(s.id)) ids.splice(ids.indexOf(ctx.release.id) + s.partIndex - 1, 0, s.id)
      st.releaseIds = ids
    })
    ctx.story.releaseIds = updated.releaseIds
    await ctx.deps.repo.ensureStoryFolders(updated)
    ctx.deps.emitDataChanged(ctx.story.id)
  }
  const dialog = res.script.lines.filter((l) => !isChannelCharacter(l.speakerId, ctx.library.characters)).length
  return {
    status: 'done',
    message: `${res.script.lines.length} câu (${dialog} câu thoại nhân vật)${res.partCount > 1 ? `, chia ${res.partCount} phần` : ''}`
  }
}

// ---------------------------------------------------------------- Bước 10

const pronunciation: StepHandler = async (ctx) => {
  const lang = ctx.release.language
  let applied = 0
  for (const line of ctx.release.script.lines) {
    line.glossaryTermIds = findTermIds(line.text, ctx.library.pronunciations, lang)
    applied += line.glossaryTermIds.length
  }
  return { status: 'done', message: `Gắn ${applied} thuật ngữ / từ điển phát âm (${lang})` }
}

// ---------------------------------------------------------------- Bước 11

const tts: StepHandler = async (ctx) => {
  const { story, release, library } = ctx
  const lines = release.script.lines
  if (lines.length === 0) throw new Error('Kịch bản trống – chạy lại bước 8')
  const providers = ctx.deps.providers

  // Ước tính chi phí các câu CHƯA có take (cache) ⇒ chặn nếu vượt ngân sách Story
  let estimate = 0
  const voices = new Map<string, { name: string; licensed: boolean; known: boolean }>()
  for (const line of lines) {
    const plan = plannedTts(story, release, line, library, providers)
    voices.set(plan.voice.id, { name: plan.voice.name, licensed: plan.voice.commercialLicenseConfirmed, known: plan.provider.commercialLicenseKnown })
    const cached = line.takes.find((t) => t.hash === plan.hash)
    if (!cached || !(await fileExists(ctx.deps.repo.resolveInStory(story.id, cached.path)))) {
      estimate += plan.provider.estimateCost(plan.text.length)
    }
  }
  const bundle = await ctx.deps.repo.loadBundle(story.id)
  const others = bundle.releases.filter((r) => r.id !== release.id).map((r) => r.costs)
  const budget = checkBudget(storySpent(story.costs, [...others, release.costs]), estimate, story.budget.limitUsd)
  if (!budget.ok) {
    throw new Error(
      `Vượt ngân sách Story: đã chi ${formatUsdShort(budget.spent)} + ước tính giọng ${formatUsdShort(estimate)} > ${formatUsdShort(budget.limit)}. Cách xử lý: tăng ngân sách ở màn Story, rút gọn kịch bản, hoặc bật Chế độ Mock.`
    )
  }
  release.costs.estimated += estimate
  if (estimate > 0) ctx.log(`Ước tính chi phí giọng: ${formatUsdShort(estimate)}`)
  // Cảnh báo giấy phép thương mại (nguyên tắc 8)
  for (const v of voices.values()) {
    if (!v.licensed && !v.known) ctx.log(`⚠ Giọng "${v.name}" chưa được đánh dấu "Đã xác nhận giấy phép thương mại"`, 'warn')
  }

  const queue = new PQueue({ concurrency: providersConfig.queue.defaultConcurrency })
  let done = 0
  let generated = 0
  let chars = 0
  await Promise.all(
    lines.map((line) =>
      queue.add(async () => {
        throwIfAborted(ctx.signal)
        const res = await synthesizeLine({ repo: ctx.deps.repo, providers, story, release, line, library, signal: ctx.signal })
        if (res.generated) {
          generated++
          chars += res.characters
          if (res.cost > 0) {
            release.costs.entries.push({ provider: res.provider, kind: 'tts', units: res.characters, cost: res.cost, timestamp: new Date().toISOString() })
            release.costs.actual += res.cost
          }
        }
        // Giữ take người dùng đã chọn nếu nó vẫn còn; nếu không chọn take vừa tạo/khớp cache
        if (!line.takes.some((t) => t.id === line.selectedTakeId) || res.generated) line.selectedTakeId = res.take.id
        done++
        ctx.progress(done / lines.length, `Câu ${done}/${lines.length}`)
      })
    )
  )
  return {
    status: 'done',
    message: generated > 0 ? `Tạo ${generated} take (${chars} ký tự, ${voices.size} giọng)` : 'Dùng lại toàn bộ take (cache)'
  }
}

// ---------------------------------------------------------------- Bước 12

async function readTargetWav(ctx: StepContext, abs: string, cacheName: string): Promise<WavData> {
  let wav = readWav(await fs.readFile(abs))
  if (!sameFormat(wav, TARGET_WAV)) {
    const norm = path.join(ctx.storyDir, 'cache', cacheName)
    if (!(await fileExists(norm))) await toWav44kMono(abs, norm, ctx.signal)
    wav = readWav(await fs.readFile(norm))
  }
  return wav
}

const assembleVoice: StepHandler = async (ctx) => {
  const { story, release, library } = ctx
  const lines = release.script.lines
  const wavs: WavData[] = []
  for (let i = 0; i < lines.length; i++) {
    throwIfAborted(ctx.signal)
    const line = lines[i]
    const take = line.takes.find((t) => t.id === line.selectedTakeId)
    if (!take) throw new Error(`Câu ${line.id} chưa có take được chọn – chạy lại bước 11`)
    // Xử lý giọng theo chuỗi của GIỌNG NÓI câu đó (người kể / nhân vật / ma có chuỗi khác nhau)
    const voice = voiceForLine(story, release, line, library)
    const processed = await processTake(ctx.deps.repo, story.id, take, voice.postProcessChain, ctx.signal)
    wavs.push(await readTargetWav(ctx, processed.abs, `norm_${path.basename(processed.abs)}`))
    ctx.progress(((i + 1) / lines.length) * 0.8, `Xử lý giọng ${i + 1}/${lines.length}`)
  }

  const { leadInSec, tailSec } = platformsConfig.voiceAssembly
  const timing = computeLineTimings(
    lines.map((l, i) => ({
      id: l.id,
      duration: wavDuration(wavs[i]),
      pauseBeforeMs: l.delivery.pauseBeforeMs,
      pauseAfterMs: l.delivery.pauseAfterMs
    })),
    { leadInSec, tailSec }
  )
  timing.items.forEach((t, i) => {
    lines[i].start = t.start
    lines[i].end = t.end
  })
  const pcm = placeClips(
    TARGET_WAV,
    timing.totalDuration,
    timing.items.map((t, i) => ({ start: t.start, wav: wavs[i] }))
  )
  const outAbs = path.join(ctx.releaseDir, 'voice', 'voice_processed.wav')
  await fs.mkdir(path.dirname(outAbs), { recursive: true })
  await fs.writeFile(outAbs, writeWav(TARGET_WAV, pcm))
  const rel = toRelPath('releases', release.id, 'voice', 'voice_processed.wav')
  // GĐ4: mix ambience/SFX/nhạc + ducking + loudness; hiện dùng thẳng giọng đã xử lý
  release.voiceTrack = { mode: 'tts', processedPath: rel, mixedPath: rel, duration: timing.totalDuration }

  if (release.platform === 'youtube') {
    release.chapters = release.script.sections
      .map((sec) => {
        const first = lines.find((l) => l.sectionId === sec.id)
        return first ? { id: `ch-${sec.id}`, title: sec.title, titleVi: sec.titleVi, start: first.start ?? 0 } : null
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c, i) => (i === 0 ? { ...c, start: 0 } : c))
  }
  const m = Math.floor(timing.totalDuration / 60)
  const s = Math.round(timing.totalDuration % 60)
  return { status: 'done', message: `Voice track ${m}:${String(s).padStart(2, '0')} (${lines.length} câu)` }
}

// ---------------------------------------------------------------- Bước 14

const matchScenesStep: StepHandler = async (ctx) => {
  const { story, release, library } = ctx
  const lines = release.script.lines
  if (!release.voiceTrack || lines.some((l) => l.start == null || l.end == null)) {
    throw new Error('Chưa có mốc thời gian câu – chạy lại bước 12')
  }
  // Câu đầu của mỗi đoạn "người kể xuất hiện" (bối cảnh, giải thích, kết…) ⇒ dùng cảnh có nhân vật kênh
  const pd = platformDefaultsOf(channelOf(ctx), release)
  const narratorSectionIds = new Set(release.script.sections.filter((s) => pd.narratorSections.includes(s.kind)).map((s) => s.id))
  const firstLineOfSection = new Set<string>()
  for (const sid of narratorSectionIds) {
    const first = lines.find((l) => l.sectionId === sid)
    if (first) firstLineOfSection.add(first.id)
  }
  const storyChars = charactersForStory(story.id, library.characters)
  const { scenes, missing } = matchScenes(
    lines.map((l) => ({ id: l.id, beatId: l.beatId, start: l.start ?? 0, end: l.end ?? 0, narrator: firstLineOfSection.has(l.id) })),
    story.sceneBank,
    story.outline.beats,
    release.voiceTrack.duration,
    platformsConfig.sceneTiming,
    { isNarratorScene: (s) => s.cast.some((m) => isChannelCharacter(m.characterId, storyChars)) }
  )
  const bankById = new Map(story.sceneBank.map((b) => [b.id, b]))
  release.scenes = scenes.map((s) => ({
    id: s.id,
    sceneBankId: s.sceneBankId,
    start: s.start,
    end: s.end,
    lineIds: s.lineIds,
    mediaOverride: null,
    motion: {
      level: 'kenBurns',
      type: 'zoomIn',
      intensity: 0.4,
      easing: 'easeInOut',
      focusPoint: { ...(bankById.get(s.sceneBankId)?.focusPoint ?? { x: 0.5, y: 0.5 }) }
    },
    transition: { type: 'cut', durationSec: 0 },
    isHero: false
  }))
  for (const m of missing) {
    const beat = story.outline.beats.find((b) => b.id === m.beatId)
    ctx.log(
      m.reason === 'noScenes'
        ? `Beat ${beat?.order ?? m.beatId} chưa có cảnh – đang mượn cảnh beat gần nhất. Gợi ý: tạo thêm ${m.needed} cảnh (Film Studio – GĐ3)`
        : `Beat ${beat?.order ?? m.beatId} cần ${m.needed} cảnh nhưng chỉ có ${m.available} – một số cảnh được dùng lại. Gợi ý tạo thêm (GĐ3)`,
      'warn'
    )
  }
  const narratorScenes = release.scenes.filter((s) => bankById.get(s.sceneBankId)?.cast.some((m) => isChannelCharacter(m.characterId, storyChars))).length
  return { status: 'done', message: `${scenes.length} cảnh (${narratorScenes} cảnh người kể), ${missing.length} gợi ý thiếu cảnh` }
}

// ---------------------------------------------------------------- Bước 15

const framing: StepHandler = async (ctx) => {
  if (ctx.release.aspectRatio !== '9:16') return { status: 'skipped', message: 'Release 16:9 – không cần cắt dọc' }
  const used = [...new Set(ctx.release.scenes.map((s) => s.sceneBankId))]
  const { verticalFraming, aspectSizes } = platformsConfig
  let built = 0
  for (let i = 0; i < used.length; i++) {
    throwIfAborted(ctx.signal)
    const item = ctx.story.sceneBank.find((b) => b.id === used[i])
    if (!item?.media['16:9']) continue
    const existing = item.media['9:16']
    const fileOk = existing ? await fileExists(ctx.deps.repo.resolveInStory(ctx.story.id, existing.path)) : false
    if (!existing || !fileOk) {
      const src = ctx.deps.repo.resolveInStory(ctx.story.id, item.media['16:9'].path)
      const fileName = `${item.id}_9x16_crop.png`
      await buildVerticalFrame(src, path.join(ctx.storyDir, 'bank', fileName), item.focusPoint, {
        outW: aspectSizes['9:16'].width,
        outH: aspectSizes['9:16'].height,
        cropAspect: verticalFraming.cropAspect,
        blur: verticalFraming.backgroundBlur,
        brightness: verticalFraming.backgroundBrightness
      })
      const ref: MediaRef = {
        path: toRelPath('bank', fileName),
        mediaType: 'image',
        source: 'own',
        provider: 'focus-crop',
        model: `crop-${verticalFraming.cropAspect}+blur`,
        cost: 0,
        createdAt: new Date().toISOString(),
        width: aspectSizes['9:16'].width,
        height: aspectSizes['9:16'].height
      }
      item.media['9:16'] = ref
      // Ghi nguyên tử: chỉ đặt bản cắt nếu trong lúc đó chưa có ảnh 9:16 vẽ riêng
      await ctx.deps.repo.updateStory(ctx.story.id, (st) => {
        const it = st.sceneBank.find((b) => b.id === item.id)
        if (it && !it.media['9:16']) it.media['9:16'] = ref
      })
      built++
    }
    ctx.progress((i + 1) / used.length, `Khung dọc ${i + 1}/${used.length}`)
  }
  if (built > 0) ctx.deps.emitDataChanged(ctx.story.id)
  const pending = ctx.story.sceneBank.filter((b) => b.needsVerticalVersion && used.includes(b.id)).length
  if (pending > 0) ctx.log(`${pending} cảnh cần bản 9:16 vẽ riêng – đang dùng bản cắt. Tạo bản dọc riêng ở Storyboard (phím V) hoặc Film Studio.`, 'info')
  return { status: 'done', message: built > 0 ? `Dựng ${built} ảnh dọc theo focusPoint` : 'Dùng lại ảnh dọc có sẵn' }
}

// ---------------------------------------------------------------- Bước 16

const heroScenes: StepHandler = async (ctx) => {
  const { story, release } = ctx
  const intensity = beatIntensityFn(ctx)
  const beatOf = (sceneBankId: string): string => story.sceneBank.find((b) => b.id === sceneBankId)?.beatId ?? ''
  const ids = new Set(selectHeroScenes(release.scenes.map((s) => ({ id: s.id, beatId: beatOf(s.sceneBankId) })), intensity, release.heroRatio))
  for (const s of release.scenes) s.isHero = ids.has(s.id)
  const heroBank = [...new Set(release.scenes.filter((s) => s.isHero).map((s) => s.sceneBankId))]
  if (heroBank.length === 0) return { status: 'done', message: `Không có cảnh hero (heroRatio ${Math.round(release.heroRatio * 100)}%)` }

  const aspect = release.aspectRatio
  const q = await ctx.deps.motion.quote(story, heroBank, aspect)
  if (q.needed.length === 0) return { status: 'done', message: `${heroBank.length} cảnh hero dùng lại clip video AI đã có` }
  if (q.cost > 0) {
    if (ctx.approval === 'declined') return { status: 'done', message: 'Đã bỏ qua video AI – cảnh hero dùng Ken Burns / parallax' }
    if (ctx.approval !== 'approved') {
      if (ctx.mode === 'fullAuto') {
        return { status: 'done', message: 'Full Auto không tự chi tiền cho video AI – cảnh hero dùng Mức 1/2 (chạy "Duyệt từng bước" để tạo)' }
      }
      return {
        status: 'waitingApproval',
        message: `Báo giá video AI: ${q.needed.length} cảnh × ${q.seconds}s ≈ ${formatUsdShort(q.cost)} (${q.providerId})${q.reused.length ? `, dùng lại ${q.reused.length} clip có sẵn` : ''}. Đồng ý để tạo, hoặc Bỏ qua để dùng Ken Burns/parallax.`
      }
    }
    const bundle = await ctx.deps.repo.loadBundle(story.id)
    const b = checkBudget(storySpent(bundle.story.costs, bundle.releases.map((r) => r.costs)), q.cost, story.budget.limitUsd)
    if (!b.ok) {
      ctx.log(`Video AI vượt ngân sách Story (ước tính ${formatUsdShort(q.cost)}) – quay về Mức 1/2`, 'warn')
      return { status: 'done', message: 'Vượt ngân sách – cảnh hero dùng Ken Burns/parallax' }
    }
  }
  ctx.log(`Tạo ${q.needed.length} clip video AI (${q.providerId}, ${q.seconds}s/clip)`)
  const r = await ctx.deps.motion.generateClips(story.id, q.needed, aspect, q.providerId, ctx.signal, (p) => ctx.progress(p, `Video AI ${Math.round(p * q.needed.length)}/${q.needed.length}`))
  for (const f of r.failed) ctx.log(`Video AI cảnh ${f.id} lỗi (${f.error}) – quay về Ken Burns/parallax`, 'warn')
  return {
    status: 'done',
    message: `${r.ok.length + q.reused.length}/${heroBank.length} cảnh hero có video AI${r.failed.length ? `, ${r.failed.length} lỗi → Mức 1/2` : ''}`
  }
}

// ---------------------------------------------------------------- Bước 17

const motion: StepHandler = async (ctx) => {
  const channel = channelOf(ctx)
  const intensity = beatIntensityFn(ctx)
  const aspect = ctx.release.aspectRatio
  const story = await ctx.deps.repo.loadStory(ctx.story.id)
  const bankById = new Map(story.sceneBank.map((b) => [b.id, b]))
  const scenes = ctx.release.scenes
  const inputs = scenes.map((s) => {
    const b = bankById.get(s.sceneBankId)
    return { beatId: b?.beatId ?? '', focusPoint: b?.focusPoint ?? { x: 0.5, y: 0.5 }, shotType: b?.shotType ?? 'wide' }
  })
  // Mức 3: cảnh hero đã có clip đúng khung
  const ai = new Set(scenes.map((s, i) => (s.isHero && bankById.get(s.sceneBankId)?.heroClip[aspect] ? i : -1)).filter((i) => i >= 0))
  // Mức 2: chọn theo parallaxRatio, rồi tính lớp (cảnh lỗi ⇒ Ken Burns)
  let parallax = chooseParallaxScenes(inputs, intensity, channel.motionProfile.parallaxRatio, ai)
  let heuristic = 0
  if (parallax.size > 0) {
    ctx.progress(0.05, `Tách lớp parallax ${parallax.size} cảnh…`)
    const ids = [...parallax].map((i) => scenes[i].sceneBankId)
    const r = await ctx.deps.motion.ensureParallax(story.id, ids, aspect, ctx.signal, (p) => ctx.progress(0.05 + 0.9 * p, 'Depth map & tách lớp'))
    heuristic = r.heuristic
    if (r.failed.length) parallax = new Set([...parallax].filter((i) => !r.failed.includes(scenes[i].sceneBankId)))
  }
  const motions = assignMotions(inputs, intensity, channel.motionProfile, { parallax, aiVideo: ai })
  const transitions = assignTransitions(inputs, intensity, channel.motionProfile)
  scenes.forEach((s, i) => {
    s.motion = motions[i]
    s.transition = transitions[i]
  })
  const violations = findDiversityViolations(scenes.map((s) => ({ shotType: bankById.get(s.sceneBankId)?.shotType ?? 'wide', motionType: s.motion.type })))
  const shotV = violations.filter((v) => v.kind === 'shotType').length
  if (shotV > 0) ctx.log(`${shotV} cặp cảnh liền nhau trùng shotType (ngân hàng cảnh thiếu lựa chọn) – nên tạo thêm cảnh`, 'warn')
  if (heuristic > 0) ctx.log(`${heuristic} cảnh parallax dùng depth ƯỚC LƯỢNG (chưa có model) – tải model depth ở Cài đặt để tách lớp chính xác`, 'warn')
  const n1 = motions.filter((m) => m.level === 'kenBurns').length
  return {
    status: 'done',
    message: `Mức 1 Ken Burns: ${n1} · Mức 2 parallax: ${parallax.size}${heuristic ? ' (depth ước lượng)' : ''} · Mức 3 video AI: ${ai.size} · ${violations.length} vi phạm đa dạng`
  }
}

// ---------------------------------------------------------------- Bước 18

const soundDesign: StepHandler = async (ctx) => {
  const { story, release } = ctx
  let note = ''
  if (release.soundCues.length === 0) {
    ctx.progress(0.1, 'Thiết kế âm thanh…')
    const d = await ctx.deps.sound.design(story.id, release.id, ctx.signal)
    release.soundCues = d.cues
    if (d.cost > 0) {
      release.costs.actual += d.cost
      release.costs.entries.push({ provider: ctx.deps.providers.llm().id, kind: 'llm', units: 1, cost: d.cost, timestamp: new Date().toISOString() })
    }
    note = d.note
  } else {
    note = `giữ ${release.soundCues.length} cue đã chỉnh`
  }
  // Ghi cue xuống đĩa trước khi mix (mix đọc release từ đĩa)
  await ctx.deps.repo.updateRelease(story.id, release.id, (r) => {
    r.soundCues = release.soundCues
  })
  ctx.progress(0.4, 'Mix: ducking + chuẩn loudness (2 lượt)…')
  const mixed = await ctx.deps.sound.mix(story.id, release.id, ctx.signal)
  release.voiceTrack = mixed.voiceTrack
  return { status: 'done', message: `${note} · mix ${mixed.voiceTrack?.mixLufs ?? '?'} LUFS` }
}

// ---------------------------------------------------------------- Bước 19

const subtitles: StepHandler = async (ctx) => {
  const channel = channelOf(ctx)
  const style = channel.subtitleStyleByPlatform[ctx.release.platform]
  const glossary = ctx.library.pronunciations.filter((p) => p.language === ctx.release.language)
  ctx.release.subtitles = buildSubtitles(
    ctx.release.script.lines.map((l) => ({ id: l.id, text: l.text, start: l.start ?? 0, end: l.end ?? 0 })),
    glossary,
    style
  )
  return { status: 'done', message: `${ctx.release.subtitles.length} cue phụ đề (preset ${style.id})` }
}

// ---------------------------------------------------------------- Bước 21

const render: StepHandler = async (ctx) => {
  const channel = channelOf(ctx)
  const scale = ctx.deps.getRenderScale()
  const props = buildCompositionProps({
    story: ctx.story,
    release: ctx.release,
    glossary: ctx.library.pronunciations.filter((p) => p.language === ctx.release.language),
    subtitleStyle: channel.subtitleStyleByPlatform[ctx.release.platform],
    mediaUrl: (rel, v) => buildMediaUrl(ctx.deps.mediaBaseUrl, ctx.story.id, rel, v),
    fps: platformsConfig.fps,
    sizes: platformsConfig.aspectSizes,
    scale,
    parallaxFactors: platformsConfig.parallax.layerFactors
  })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
  const fileName = `${ctx.story.id}_${ctx.release.id}_${ctx.release.aspectRatio.replace(':', 'x')}_${stamp}.mp4`
  const outAbs = path.join(ctx.releaseDir, 'exports', fileName)
  await fs.mkdir(path.dirname(outAbs), { recursive: true })

  ctx.log(`Bắt đầu render ${props.width}×${props.height}, ${props.durationSec.toFixed(1)}s → ${fileName}`)
  const weights = { bundle: [0, 0.12], browser: [0.12, 0.18], render: [0.18, 1] } as const
  const labels = { bundle: 'Đóng gói composition', browser: 'Chuẩn bị Chrome Headless', render: 'Render khung hình' }
  await ctx.deps.renderer.render(
    { entryPoint: ctx.deps.remotionEntry, inputProps: props, outputPath: outAbs },
    (p) => {
      const [a, b] = weights[p.stage]
      ctx.progress(a + (b - a) * p.progress, `${labels[p.stage]} ${Math.round(p.progress * 100)}%`)
    },
    ctx.signal
  )

  // sources.json – minh bạch nguồn gốc media, giọng, giấy phép, nhãn AI
  const usedBank = new Set(ctx.release.scenes.map((s) => s.sceneBankId))
  const voiceMap = new Map(ctx.release.script.lines.map((l) => {
    const v = voiceForLine(ctx.story, ctx.release, l, ctx.library)
    return [v.id, v] as const
  }))
  const sources = {
    generatedAt: new Date().toISOString(),
    release: { id: ctx.release.id, platform: ctx.release.platform, language: ctx.release.language, part: `${ctx.release.partIndex}/${ctx.release.partCount}` },
    output: toRelPath('exports', fileName),
    aiGenerated: { images: true, voice: true, video: ctx.release.scenes.some((s) => s.motion.level === 'aiVideo'), script: ctx.deps.providers.llm().id !== 'mock' },
    note: 'Ảnh placeholder (GĐ1–2) – thay bằng ảnh thật ở GĐ3 trước khi đăng.',
    media: ctx.story.sceneBank
      .filter((b) => usedBank.has(b.id))
      .flatMap((b) => (['16:9', '9:16'] as const).map((a) => ({ sceneId: b.id, aspect: a, ref: b.media[a] })))
      .filter((m) => m.ref !== null),
    voices: [...voiceMap.values()].map((v) => ({
      id: v.id,
      name: v.name,
      provider: v.providerId,
      providerVoiceId: v.providerVoiceId,
      commercialLicenseConfirmed: v.commercialLicenseConfirmed
    })),
    sound: ctx.release.soundCues.map((c) => {
      const a = ctx.library.soundAssets.find((x) => x.id === c.assetId)
      return { id: c.id, kind: c.kind, start: c.start, end: c.end, asset: a ? { name: a.name, license: a.license, licenseConfirmed: a.licenseConfirmed, source: a.source } : null }
    }),
    motionLevels: ctx.release.scenes.map((s) => ({ scene: s.sceneBankId, level: s.motion.level, hero: s.isHero })),
    loudnessLufs: ctx.release.voiceTrack?.mixLufs ?? null,
    folklore: ctx.story.folkloreIds,
    fictionNote: ctx.story.fictionNoteVi
  }
  await fs.writeFile(path.join(ctx.releaseDir, 'sources.json'), JSON.stringify(sources, null, 2), 'utf8')
  return { status: 'done', message: `Đã xuất ${fileName}` }
}

// ---------------------------------------------------------------- Bước 22

const publishPackage: StepHandler = async (ctx) => {
  const { story, release } = ctx
  const pub = ctx.deps.publish
  ctx.progress(0.1, 'Soạn tiêu đề, mô tả, hashtag…')
  const { release: withPkg } = await pub.generatePackage(story.id, release.id, ctx.signal)
  if (!withPkg.publishing?.thumbnails.length) {
    ctx.progress(0.7, 'Thumbnail nhanh từ ảnh cảnh')
    await pub.quickThumbnail(story.id, release.id)
  }
  const final = await pub.refreshChecklist(story.id, release.id)
  // Đồng bộ vào bản trong bộ nhớ (runner sẽ ghi lại release sau bước này)
  ctx.release.publishing = final.publishing
  ctx.release.costs = final.costs
  const items = final.publishing?.checklist ?? []
  const todo = items.filter((i) => !i.done)
  if (todo.length) ctx.log(`Checklist còn ${todo.length} mục: ${todo.map((i) => i.labelVi).join(' · ')}`, 'warn')
  return { status: 'done', message: `Gói xuất bản ${release.platform} · ${final.publishing?.thumbnails.length ?? 0} thumbnail · checklist ${items.length - todo.length}/${items.length}` }
}

// ---------------------------------------------------------------- Bước 23

const shorts: StepHandler = async (ctx) => {
  if (ctx.release.platform !== 'youtube') return { status: 'skipped', message: 'Chỉ cắt Shorts teaser từ bản YouTube dài' }
  const r = await ctx.deps.publish.cutShorts(ctx.story.id, ctx.release.id, (p, m) => ctx.progress(p, m), ctx.signal)
  ctx.release.publishing = r.publishing
  const sh = r.publishing?.shorts
  return { status: 'done', message: sh ? `Shorts teaser ${(sh.end - sh.start).toFixed(0)}s (${sh.start.toFixed(0)}–${sh.end.toFixed(0)}s) + thẻ kết` : 'Đã cắt Shorts' }
}

/** Bước duyệt không có handler: runner xử lý (dừng chờ người dùng) */
export const STEP_HANDLERS: Partial<Record<StepKey, StepHandler>> = {
  bankImages,
  adaptScript,
  pronunciation,
  tts,
  assembleVoice,
  matchScenes: matchScenesStep,
  framing,
  heroScenes,
  motion,
  soundDesign,
  subtitles,
  render,
  publishPackage,
  shorts
}
