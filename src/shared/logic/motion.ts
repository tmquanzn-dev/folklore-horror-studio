/**
 * Gán chuyển động Mức 1 (Ken Burns) + chuyển cảnh theo cường độ cảm xúc của beat.
 * - Beat căng thẳng → ưu tiên zoomIn chậm (áp sát), easing easeIn.
 * - Không 2 cảnh liền nhau cùng kiểu chuyển động.
 * - Chuyển cảnh: trong beat dùng fade, giữa beat dùng dip-to-black, cao trào có flash ngắn.
 */
import type { FocusPoint, KenBurnsType, Motion, MotionProfile, ParallaxType, ShotType, Transition } from '../types'

export interface MotionSceneInput {
  beatId: string
  focusPoint: FocusPoint
}

const TENSE: KenBurnsType[] = ['zoomIn', 'panUp', 'panLeft', 'zoomOut']
const MEDIUM: KenBurnsType[] = ['panRight', 'zoomIn', 'panLeft', 'zoomOut', 'panDown']
const CALM: KenBurnsType[] = ['zoomOut', 'panLeft', 'panRight', 'panDown', 'zoomIn']

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const r2 = (n: number): number => Math.round(n * 100) / 100

/** Cỡ cảnh có chiều sâu rõ ⇒ parallax đẹp; cảnh chi tiết / nhìn từ trên xuống thì phẳng, không hợp */
const PARALLAX_SHOTS: ShotType[] = ['wide', 'medium', 'overShoulder', 'closeUp']

/**
 * Chọn cảnh dùng parallax 2.5D theo parallaxRatio: ưu tiên cảnh có chiều sâu và cảm xúc vừa–cao,
 * rải đều (tránh 2 cảnh parallax liền nhau nếu còn lựa chọn). excluded = cảnh đã dùng video AI.
 */
export function chooseParallaxScenes(
  scenes: { beatId: string; shotType: ShotType }[],
  beatIntensity: (beatId: string) => number,
  ratio: number,
  excluded: Set<number> = new Set()
): Set<number> {
  const count = Math.round(scenes.length * Math.max(0, Math.min(1, ratio)))
  const eligible = scenes
    .map((s, i) => ({ i, ok: PARALLAX_SHOTS.includes(s.shotType) && !excluded.has(i), score: 1 - Math.abs(beatIntensity(s.beatId) - 0.7) }))
    .filter((x) => x.ok)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i))
  const picked = new Set<number>()
  // Lượt 1: không chọn cảnh kề cảnh đã chọn; lượt 2: lấp cho đủ số lượng
  for (const pass of [0, 1]) {
    for (const x of eligible) {
      if (picked.size >= count) break
      if (picked.has(x.i)) continue
      if (pass === 0 && (picked.has(x.i - 1) || picked.has(x.i + 1))) continue
      picked.add(x.i)
    }
  }
  return picked
}

const PARALLAX_TENSE: ParallaxType[] = ['dollyIn', 'truckLeft', 'truckRight']
const PARALLAX_CALM: ParallaxType[] = ['dollyOut', 'truckRight', 'truckLeft']

export function assignMotions(
  scenes: MotionSceneInput[],
  beatIntensity: (beatId: string) => number,
  profile: MotionProfile,
  levels: { parallax?: Set<number>; aiVideo?: Set<number> } = {}
): Motion[] {
  const result: Motion[] = []
  let prevType: string | null = null
  scenes.forEach((scene, i) => {
    const e = clamp(beatIntensity(scene.beatId), 0, 1)
    const intensity = r2(clamp(profile.baseIntensity + e * profile.intensityGain, 0.1, 1))
    if (levels.aiVideo?.has(i)) {
      prevType = 'aiClip'
      result.push({ level: 'aiVideo', type: 'aiClip', intensity, easing: 'linear', focusPoint: { ...scene.focusPoint } })
      return
    }
    if (levels.parallax?.has(i)) {
      // Cảnh căng thẳng ưu tiên dolly vào (áp sát); cảnh khác xoay vòng; không trùng kiểu cảnh liền trước
      const list = e >= profile.tenseThreshold ? PARALLAX_TENSE : PARALLAX_CALM
      const offset = e >= profile.tenseThreshold ? 0 : i % list.length
      let chosen: ParallaxType = list[offset]
      for (let k = 0; k < list.length; k++) {
        const c = list[(offset + k) % list.length]
        if (c !== prevType) {
          chosen = c
          break
        }
      }
      prevType = chosen
      result.push({ level: 'parallax', type: chosen, intensity, easing: e >= profile.tenseThreshold ? 'easeIn' : 'easeInOut', focusPoint: { ...scene.focusPoint } })
      return
    }
    const list = e >= profile.tenseThreshold ? TENSE : e >= 0.4 ? MEDIUM : CALM
    // Cảnh căng thẳng luôn thử zoomIn trước; cảnh khác xoay vòng theo vị trí để đa dạng
    const offset = e >= profile.tenseThreshold ? 0 : i % list.length
    let type: KenBurnsType = list[offset]
    for (let k = 0; k < list.length; k++) {
      const candidate = list[(offset + k) % list.length]
      if (candidate !== prevType) {
        type = candidate
        break
      }
    }
    prevType = type
    result.push({
      level: 'kenBurns',
      type,
      intensity,
      easing: e >= profile.tenseThreshold ? 'easeIn' : 'easeInOut',
      focusPoint: { ...scene.focusPoint }
    })
  })
  return result
}

export function assignTransitions(
  scenes: { beatId: string }[],
  beatIntensity: (beatId: string) => number,
  profile: MotionProfile
): Transition[] {
  return scenes.map((scene, i) => {
    const d = profile.transitionDurationSec
    if (i === 0) return { type: 'dipToBlack', durationSec: d * 1.5 }
    const prev = scenes[i - 1]
    const e = beatIntensity(scene.beatId)
    if (prev.beatId !== scene.beatId) {
      if (profile.flashAtClimax && e >= profile.climaxThreshold) return { type: 'flash', durationSec: 0.18 }
      return { type: profile.transitionBetweenBeats, durationSec: d }
    }
    return { type: profile.transitionWithinBeat, durationSec: d }
  })
}
