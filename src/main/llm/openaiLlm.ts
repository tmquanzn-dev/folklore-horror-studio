/**
 * LlmProvider cho OpenAI Chat Completions – output luôn là JSON (response_format json_object),
 * validate bằng hàm parse (zod). Sai schema ⇒ gửi thông báo lỗi lại cho model và thử lại.
 */
import { providersConfig, type LlmConfig } from '../../shared/config'
import { logger } from '../logger'
import { fetchWithRetry } from '../providers/http'
import type { LlmJsonRequest, LlmJsonResult, LlmProvider } from '../providers/interfaces'

interface ChatResponse {
  choices: { message: { content: string | null } }[]
  usage?: { prompt_tokens: number; completion_tokens: number }
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }
type Msg = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }

export function describeZodLikeError(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    return (err as { issues: { path: (string | number)[]; message: string }[] }).issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`)
      .join('; ')
  }
  return err instanceof Error ? err.message : String(err)
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly id = 'openai'
  readonly model: string
  private readonly cfg: LlmConfig & { endpoint: string }

  constructor(
    private readonly getKey: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch,
    cfg = providersConfig.llm.openai
  ) {
    this.cfg = cfg
    this.model = cfg.model
  }

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const key = this.getKey()
    if (!key) throw new Error('Chưa có API key OpenAI. Cách xử lý: nhập key ở màn Cài đặt hoặc bật lại Chế độ Mock.')
    const messages: Msg[] = [
      { role: 'system', content: `${req.system}\n\nReturn ONLY one valid JSON object. No markdown, no commentary.` },
      {
        role: 'user',
        content: req.images?.length
          ? [
              { type: 'text', text: req.user },
              // Mỗi ảnh có nhãn đứng trước để model biết ảnh nào là gì
              ...req.images.flatMap((im): ContentPart[] => [
                { type: 'text', text: `Image: ${im.label}` },
                { type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.base64}`, detail: 'low' } }
              ])
            ]
          : req.user
      }
    ]
    const maxRetries = req.maxRetries ?? this.cfg.maxRetriesOnSchemaError
    let inTok = 0
    let outTok = 0
    let lastErr = ''

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetchWithRetry(
        this.cfg.endpoint,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: req.temperature ?? this.cfg.temperature ?? 0.8,
            response_format: { type: 'json_object' }
          })
        },
        {
          maxAttempts: providersConfig.queue.maxAttempts,
          baseMs: providersConfig.queue.backoffBaseMs,
          maxMs: providersConfig.queue.backoffMaxMs,
          timeoutMs: this.cfg.timeoutMs ?? 180000,
          signal: req.signal,
          fetchImpl: this.fetchImpl,
          onRetry: (a, d, r) => logger.warn(`LLM ${req.task}: thử lại lần ${a} sau ${d}ms (${r})`, 'llm')
        }
      )
      const json = (await res.json()) as ChatResponse
      inTok += json.usage?.prompt_tokens ?? 0
      outTok += json.usage?.completion_tokens ?? 0
      const content = json.choices?.[0]?.message?.content ?? ''
      try {
        const data = req.parse(JSON.parse(content))
        const cost = (inTok / 1000) * this.cfg.pricePer1kInputTokens + (outTok / 1000) * this.cfg.pricePer1kOutputTokens
        logger.info(`LLM ${req.task}: ${inTok}+${outTok} token, ~$${cost.toFixed(4)}`, 'llm')
        return { data, inputTokens: inTok, outputTokens: outTok, cost }
      } catch (err) {
        lastErr = describeZodLikeError(err)
        logger.warn(`LLM ${req.task}: JSON sai schema (lần ${attempt + 1}): ${lastErr}`, 'llm')
        messages.push({ role: 'assistant', content })
        messages.push({
          role: 'user',
          content: `Your JSON did not match the required schema: ${lastErr}. Return the FULL corrected JSON object only.`
        })
      }
    }
    throw new Error(`LLM trả về JSON sai cấu trúc sau ${maxRetries + 1} lần thử (${req.task}): ${lastErr}`)
  }
}
