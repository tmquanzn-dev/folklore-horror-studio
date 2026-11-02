import { useEffect, useState } from 'react'

const cache = new Map<string, number[]>()

/** Waveform nhỏ của một take (đỉnh biên độ tính ở main process từ file WAV) */
export function Waveform({ storyId, relPath, width = 160, height = 26 }: { storyId: string; relPath: string | null; width?: number; height?: number }): JSX.Element {
  const key = relPath ? `${storyId}/${relPath}` : ''
  const [peaks, setPeaks] = useState<number[] | null>(cache.get(key) ?? null)

  useEffect(() => {
    if (!relPath) return setPeaks(null)
    const hit = cache.get(key)
    if (hit) return setPeaks(hit)
    let alive = true
    void window.api
      .invoke('voice:peaks', storyId, relPath, 48)
      .then((p) => {
        cache.set(key, p)
        if (alive) setPeaks(p)
      })
      .catch(() => alive && setPeaks([]))
    return () => {
      alive = false
    }
  }, [key, relPath, storyId])

  if (!relPath) return <div className="rounded bg-ink-900 text-center text-[10px] leading-[26px] text-slate-600" style={{ width, height }}>chưa có take</div>
  const bars = peaks ?? []
  const bw = width / Math.max(1, bars.length)
  // Chuẩn hoá theo đỉnh của chính take ⇒ giọng nhỏ vẫn nhìn rõ hình dạng
  const peak = Math.max(0.001, ...bars)
  return (
    <svg width={width} height={height} className="rounded bg-ink-900">
      {bars.map((p, i) => {
        const hh = Math.max(1, (p / peak) * (height - 2))
        return <rect key={i} x={i * bw + 0.5} y={(height - hh) / 2} width={Math.max(1, bw - 1)} height={hh} fill="#34d399" opacity={0.85} />
      })}
    </svg>
  )
}
