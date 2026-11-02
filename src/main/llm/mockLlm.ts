/**
 * MockLlm: không gọi mạng; lấy output từ req.mockResponse() rồi vẫn validate bằng req.parse
 * ⇒ chạy được toàn bộ luồng LLM khi chưa có API key, và bắt lỗi schema ngay trong chế độ Mock.
 */
import { providersConfig } from '../../shared/config'
import type { LlmJsonRequest, LlmJsonResult, LlmProvider } from '../providers/interfaces'

export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock'
  readonly model = providersConfig.llm.mock.model

  async generateJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    if (req.signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError')
    if (!req.mockResponse) throw new Error(`Mock LLM chưa có dữ liệu mẫu cho tác vụ "${req.task}"`)
    const data = req.parse(req.mockResponse())
    return { data, inputTokens: 0, outputTokens: 0, cost: 0 }
  }
}
