import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { readBoundedBody, readFailure, type Protocol } from './bridge.ts'
import { validUpstream } from './config.ts'
import { classify } from './errors.ts'
import { policy } from './policy.ts'

export type DiagnosticResult = {
  ok: boolean; status?: number; message: string; elapsedMs: number; models?: string[]; partial?: boolean
}
type DiagnosticRequest = { kind: Protocol; endpoint: string; secret: string; model?: string }
const geminiCatalog = z.object({
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() })).default([]),
  nextPageToken: z.string().max(2048).optional(),
})
const openaiCatalog = z.object({ data: z.array(z.object({ id: z.string() })) })

export class KeyDiagnostics {
  private running = false
  private lastSent = -Infinity

  async run(request: DiagnosticRequest): Promise<DiagnosticResult> {
    if (this.running) throw new Error('已有 Key 正在测试或获取模型，请稍后重试')
    this.running = true
    const started = performance.now()
    const signal = AbortSignal.timeout(policy.diagnosticTimeoutMs)
    const { kind, endpoint, secret, model } = request
    let status: number | undefined
    const headers = new Headers(attributionHeaders())
    headers.set(kind === 'google' ? 'x-goog-api-key' : 'Authorization', kind === 'google' ? secret : `Bearer ${secret}`)
    const send = async (suffix: string, payload?: object) => {
      const remaining = this.lastSent + policy.diagnosticIntervalMs - performance.now()
      if (remaining > 0) await delay(remaining, undefined, { signal })
      this.lastSent = performance.now()
      const response = await fetch(endpoint + suffix, {
        headers, signal, redirect: 'error',
        ...(payload && { method: 'POST', body: JSON.stringify(payload) }),
      })
      status = response.status
      return response
    }
    const result = (ok: boolean, message: string, status?: number): DiagnosticResult =>
      ({ ok, message, status, elapsedMs: Math.round(performance.now() - started) })
    const failed = async (response: Response) => {
      const failure = await readFailure(response, secret)
      const { code, description } = classify(kind, failure, Date.now(), '')
      return result(false, description || code || '上游拒绝请求', response.status)
    }
    try {
      if (model) {
        headers.set('Content-Type', 'application/json')
        const limit = new URL(endpoint).hostname === 'api.openai.com' ? { max_completion_tokens: 16 } : { max_tokens: 16 }
        const response = kind === 'google'
          ? await send(`/models/${encodeURIComponent(model)}:generateContent`,
            { contents: [{ parts: [{ text: 'Reply OK.' }] }], generationConfig: { maxOutputTokens: 16 } })
          : await send('/chat/completions',
            { model, messages: [{ role: 'user', content: 'Reply OK.' }], ...limit })
        if (!response.ok) return await failed(response)
        const body = JSON.parse(await readBoundedBody(response, policy.catalogBytes))
        if (body?.error) return result(false, '上游返回了生成错误', response.status)
        const generated = kind === 'google' ? body?.candidates : body?.choices
        return Array.isArray(generated) && generated.length
          ? result(true, '连通', response.status)
          : result(false, '上游未返回生成结果', response.status)
      }
      const ids = new Set<string>()
      let token: string | undefined
      for (let page = 0; page < policy.catalogPages; page++) {
        const response = await send('/models' + (token ? `?pageToken=${encodeURIComponent(token)}` : ''))
        if (!response.ok) return await failed(response)
        const body = JSON.parse(await readBoundedBody(response, policy.catalogBytes))
        if (body?.error) return result(false, '上游返回了模型目录错误', status)
        if (kind === 'google') {
          const catalog = geminiCatalog.parse(body)
          for (const entry of catalog.models) {
            if (entry.name.startsWith('models/') && entry.supportedGenerationMethods?.includes('generateContent')) {
              ids.add(entry.name.slice('models/'.length))
            }
          }
          token = catalog.nextPageToken
        } else {
          for (const entry of openaiCatalog.parse(body).data) ids.add(entry.id)
        }
        if (!token) break
      }
      const models = [...ids].filter(id => !id.includes(secret) && validUpstream(kind, id)).sort()
      return { ...result(true, `获取到 ${models.length} 个模型`, status), models, partial: !!token }
    } catch (error) {
      if (signal.aborted) return result(false, '请求超时', status)
      if (error instanceof SyntaxError || error instanceof z.ZodError) return result(false, '上游返回的数据格式不受支持', status)
      return result(false, '无法连接上游，请检查端点或网络')
    } finally {
      this.running = false
    }
  }
}
