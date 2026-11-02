/**
 * Chọn cảnh hero (Mức 3 – video AI) theo heroRatio của Release.
 * Ưu tiên: cảnh mở đầu (hook) và cảnh thuộc beat có cường độ cảm xúc cao nhất (cao trào).
 */
export interface HeroCandidate {
  id: string
  beatId: string
}

export function heroCount(sceneCount: number, heroRatio: number): number {
  if (sceneCount <= 0 || heroRatio <= 0) return 0
  return Math.min(sceneCount, Math.max(1, Math.round(sceneCount * heroRatio)))
}

export function selectHeroScenes(
  scenes: HeroCandidate[],
  beatIntensity: (beatId: string) => number,
  heroRatio: number
): string[] {
  const count = heroCount(scenes.length, heroRatio)
  if (count === 0) return []
  const scored = scenes.map((s, index) => ({
    id: s.id,
    index,
    score: beatIntensity(s.beatId) + (index === 0 ? 0.6 : 0)
  }))
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
  const chosen = new Set(scored.slice(0, count).map((s) => s.id))
  // Trả về theo thứ tự trên timeline
  return scenes.filter((s) => chosen.has(s.id)).map((s) => s.id)
}
