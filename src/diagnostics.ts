import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { readBoundedBody, readFailure, type Protocol, type UpstreamFailure } from './bridge.ts'
import { validUpstream } from './config.ts'
import { classify } from './errors.ts'
import { policy } from './policy.ts'

export type DiagnosticResult = {
  ok: boolean; status?: number; message: string; elapsedMs: number; models?: string[]; partial?: boolean
}
export type ModelCheck = Pick<DiagnosticResult, 'ok' | 'status' | 'message' | 'elapsedMs'> & { at: number }
type DiagnosticRequest = { kind: Protocol; endpoint: string; secret: string; model?: string }
const geminiCatalog = z.object({
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() })).default([]),
  nextPageToken: z.string().max(2048).optional(),
})
const openaiCatalog = z.object({ data: z.array(z.object({ id: z.string() })) })

type GeminiProbeEvent = {
  error?: unknown
  promptFeedback?: { blockReason?: string }
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]
}

async function readGeminiProbe(response: Response, secret: string) {
  const reader = response.body?.getReader()
  if (!reader) return { ok: false, message: '上游返回了空响应' }
  const decoder = new TextDecoder()
  let buffer = ''
  let size = 0
  let finishReason: string | undefined
  const inspect = async (event: string) => {
    const data = event.split(/\r?\n/)
      .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    const body: GeminiProbeEvent = JSON.parse(data)
    if (body?.error) {
      const failure = await readFailure(Response.json(body, { status: response.status }), secret)
      const { code, description } = classify('google', failure, Date.now(), '')
      return { ok: false, message: description || code || '上游在响应流中返回了错误' }
    }
    if (body?.promptFeedback?.blockReason) finishReason = body.promptFeedback.blockReason
    for (const candidate of body?.candidates ?? []) {
      if (candidate.finishReason) finishReason = candidate.finishReason
      if (candidate.content?.parts?.some(part => !part.thought && typeof part.text === 'string' && part.text.trim())) {
        return { ok: true, message: '已收到模型正文' }
      }
    }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        const final = await inspect(buffer + decoder.decode())
        if (final) return final
        break
      }
      size += chunk.value.byteLength
      if (size > policy.catalogBytes) return { ok: false, message: '模型测试响应超过大小限制' }
      buffer += decoder.decode(chunk.value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        const result = await inspect(event)
        if (result) return result
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  if (finishReason === 'MAX_TOKENS') return { ok: false, message: '模型已响应，但用完测试输出预算，未返回正文（MAX_TOKENS）' }
  const reason = finishReason && /^[A-Z_]{1,48}$/.test(finishReason) && !finishReason.includes(secret)
    ? `（${finishReason}）` : ''
  return { ok: false, message: `响应已结束，未收到模型正文${reason}` }
}

function networkMessage(error: unknown) {
  const cause = (error as { cause?: { code?: string } } | null)?.cause?.code
  switch (cause) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return `无法解析上游域名（${cause}）`
    case 'ECONNREFUSED': return '上游拒绝建立连接（ECONNREFUSED）'
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET': return `网络连接中断（${cause}）`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT': return `建立连接超时（${cause}）`
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN': return `上游 TLS 证书验证失败（${cause}）`
    default: return '未能完成上游请求，请检查端点和网络'
  }
}

export class KeyDiagnostics {
  private running = false
  private lastSent = -Infinity

  async run(request: DiagnosticRequest, onFailure?: (failure: UpstreamFailure) => void): Promise<DiagnosticResult> {
    if (this.running) throw new Error('已有 Key 正在测试或获取模型，请稍后重试')
    this.running = true
    const started = performance.now()
    const { kind, endpoint, secret, model } = request
    const timeout = model ? policy.generationTestTimeoutMs : policy.diagnosticTimeoutMs
    const signal = AbortSignal.timeout(timeout)
    let status: number | undefined
    let sent = false
    const headers = new Headers(attributionHeaders())
    headers.set(kind === 'google' ? 'x-goog-api-key' : 'Authorization', kind === 'google' ? secret : `Bearer ${secret}`)
    const send = async (suffix: string, payload?: object) => {
      status = undefined
      sent = false
      const remaining = this.lastSent + policy.diagnosticIntervalMs - performance.now()
      if (remaining > 0) await delay(remaining, undefined, { signal })
      this.lastSent = performance.now()
      sent = true
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
      onFailure?.(failure)
      const { code, description } = classify(kind, failure, Date.now(), '')
      return result(false, [code, description].filter(Boolean).join(' · ') || '上游拒绝请求', response.status)
    }
    try {
      if (model) {
        headers.set('Content-Type', 'application/json')
        const limit = new URL(endpoint).hostname === 'api.openai.com' ? { max_completion_tokens: 16 } : { max_tokens: 16 }
        const response = kind === 'google'
          ? await send(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
            contents: [{ role: 'user', parts: [{ text: 'Reply only with OK.' }] }],
            generationConfig: {
              maxOutputTokens: policy.geminiTestMaxTokens,
              ...(/^gemini-4-(?:hydrogen|argon|carbon)(?:-|$)/.test(model) && { thinkingConfig: { thinkingLevel: 'LOW' } }),
            },
          })
          : await send('/chat/completions',
            { model, messages: [{ role: 'user', content: 'Reply OK.' }], ...limit })
        if (!response.ok) return await failed(response)
        if (kind === 'google') {
          const probe = await readGeminiProbe(response, secret)
          return result(probe.ok, probe.message, response.status)
        }
        const body = JSON.parse(await readBoundedBody(response, policy.catalogBytes))
        if (body?.error) return result(false, '上游返回了生成错误', response.status)
        const generated = body?.choices
        return Array.isArray(generated) && generated.length
          ? result(true, '已收到模型回复', response.status)
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
      if (signal.aborted) {
        const description = !sent ? '等待发送超时' : status === undefined
          ? '等待上游响应头超时，未收到 HTTP 状态码'
          : model && status === 200 ? '上游已响应，等待模型输出超时' : '读取上游响应内容超时'
        return result(false, `${description}（${timeout / 1000} 秒）`, status)
      }
      if (error instanceof SyntaxError || error instanceof z.ZodError) return result(false, '上游返回的数据格式不受支持', status)
      return result(false, networkMessage(error), status)
    } finally {
      this.running = false
    }
  }
}
