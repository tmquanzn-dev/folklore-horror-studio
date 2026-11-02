/**
 * Sổ hiệu quả & sổ chi phí (hàm thuần).
 */
import type { CostEntry, PerformanceNote, Platform } from '../types'

export interface PerformanceThresholds {
  minViews: number
  minAvgWatchPercent: number
}

/** Ghi chú tốt nhất của một Release (lượt xem cao nhất) */
export function bestNote(notes: PerformanceNote[]): PerformanceNote | null {
  return notes.reduce<PerformanceNote | null>((b, n) => (!b || n.views > b.views ? n : b), null)
}

export interface AdaptSuggestion {
  qualifies: boolean
  reason: string
  best: PerformanceNote | null
}

/**
 * Story có bản TikTok đạt ngưỡng (lượt xem + % xem trung bình) và CHƯA có bản YouTube tiếng Anh
 * ⇒ gợi ý "Chuyển thể sang YouTube tiếng Anh".
 */
export function adaptSuggestion(
  notes: PerformanceNote[],
  releases: { id: string; platform: Platform; language: string }[],
  t: PerformanceThresholds
): AdaptSuggestion {
  const tiktokIds = new Set(releases.filter((r) => r.platform === 'tiktok').map((r) => r.id))
  const hasYtEn = releases.some((r) => r.platform === 'youtube' && r.language === 'en')
  const best = bestNote(notes.filter((n) => tiktokIds.has(n.releaseId)))
  if (!best) return { qualifies: false, reason: 'Chưa có số liệu bản TikTok', best: null }
  const ok = best.views >= t.minViews && best.avgWatchPercent >= t.minAvgWatchPercent
  if (!ok) {
    return { qualifies: false, reason: `Chưa đạt ngưỡng (${best.views.toLocaleString('vi-VN')} lượt xem, ${best.avgWatchPercent}% xem trung bình / cần ${t.minViews.toLocaleString('vi-VN')} và ${t.minAvgWatchPercent}%)`, best }
  }
  if (hasYtEn) return { qualifies: false, reason: 'Đã có bản YouTube tiếng Anh', best }
  return { qualifies: true, reason: `Bản TikTok đạt ${best.views.toLocaleString('vi-VN')} lượt xem, ${best.avgWatchPercent}% xem trung bình`, best }
}

/** Tỷ lệ tương tác (like + bình luận + chia sẻ) / lượt xem, % */
export function engagementRate(n: PerformanceNote): number {
  return n.views > 0 ? Math.round(((n.likes + n.comments + n.shares) / n.views) * 10000) / 100 : 0
}

export interface CostRow extends CostEntry {
  storyId: string
  storyName: string
  releaseId: string | null
  releaseTitle: string | null
}

export interface CostReport {
  month: string
  total: number
  byStory: { storyId: string; storyName: string; total: number; budget: number }[]
  byProvider: { provider: string; total: number }[]
  byKind: { kind: CostEntry['kind']; total: number }[]
  rows: CostRow[]
}

const round = (n: number): number => Math.round(n * 10000) / 10000

/** Tổng hợp chi phí theo tháng ("YYYY-MM") hoặc "all" */
export function buildCostReport(rows: CostRow[], month: string, budgets: Record<string, number>): CostReport {
  const sel = month === 'all' ? rows : rows.filter((r) => r.timestamp.startsWith(month))
  const sum = <K extends string>(key: (r: CostRow) => K): Map<K, number> => {
    const m = new Map<K, number>()
    for (const r of sel) m.set(key(r), (m.get(key(r)) ?? 0) + r.cost)
    return m
  }
  const names = new Map(rows.map((r) => [r.storyId, r.storyName]))
  return {
    month,
    total: round(sel.reduce((s, r) => s + r.cost, 0)),
    byStory: [...sum((r) => r.storyId)].map(([storyId, total]) => ({ storyId, storyName: names.get(storyId) ?? storyId, total: round(total), budget: budgets[storyId] ?? 0 })).sort((a, b) => b.total - a.total),
    byProvider: [...sum((r) => r.provider)].map(([provider, total]) => ({ provider, total: round(total) })).sort((a, b) => b.total - a.total),
    byKind: [...sum((r) => r.kind)].map(([kind, total]) => ({ kind, total: round(total) })).sort((a, b) => b.total - a.total),
    rows: [...sel].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }
}

/** CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt) */
export function costCsv(rows: CostRow[]): string {
  const esc = (v: string | number | null): string => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Thời điểm', 'Story', 'Bản phát hành', 'Provider', 'Loại', 'Số lượng', 'Chi phí (USD)']
  const lines = rows.map((r) => [r.timestamp, r.storyName, r.releaseTitle, r.provider, r.kind, r.units, r.cost.toFixed(4)].map(esc).join(','))
  return '﻿' + [head.join(','), ...lines].join('\r\n')
}
