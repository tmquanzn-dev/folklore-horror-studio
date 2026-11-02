/**
 * Ước tính chi phí trước khi gọi API (nguyên tắc 9: báo giá trước, chặn khi vượt ngân sách).
 */
import type { CostLedger } from '../types'

/** ~4 ký tự / token cho tiếng Anh; tiếng Việt có dấu tốn hơn ⇒ dùng 3 cho an toàn */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

export function estimateLlmCost(
  inputChars: number,
  expectedOutputChars: number,
  price: { pricePer1kInputTokens: number; pricePer1kOutputTokens: number }
): number {
  const inTok = Math.ceil(inputChars / 3)
  const outTok = Math.ceil(expectedOutputChars / 3)
  return (inTok / 1000) * price.pricePer1kInputTokens + (outTok / 1000) * price.pricePer1kOutputTokens
}

export function estimateTtsCost(characters: number, pricePer1kChars: number): number {
  return (characters / 1000) * pricePer1kChars
}

/** Tổng đã chi của Story = chi cấp Story + chi của mọi Release */
export function storySpent(storyCosts: CostLedger | undefined, releaseCosts: CostLedger[]): number {
  return (storyCosts?.actual ?? 0) + releaseCosts.reduce((s, c) => s + c.actual, 0)
}

export interface BudgetCheck {
  ok: boolean
  spent: number
  estimate: number
  limit: number
}

export function checkBudget(spent: number, estimate: number, limit: number): BudgetCheck {
  return { ok: limit <= 0 || spent + estimate <= limit + 1e-9, spent, estimate, limit }
}

export function formatUsdShort(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}
