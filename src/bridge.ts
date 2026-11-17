import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { policy } from './policy.ts'

export type Protocol = 'google' | 'openai'
export type UpstreamFailure = { status?: number; retryAfter?: string; body?: unknown; network?: true }

type Destination = {
  kind: Protocol
  endpoint: string
  model: string
  secret: string
  signal: AbortSignal
  authorize?: () => void
}
type Ticket = { token: string; failure?: UpstreamFailure; localError?: unknown; close: () => void }

function validRequest(req: IncomingMessage, destination: Destination): boolean {
  const path = (req.url ?? '').split('?')[0]
  if (req.method !== 'POST') return false
  if (destination.kind === 'openai') return path === '/v1/chat/completions'
  return path === `/v1beta/models/${destination.model}:streamGenerateContent`
}

async function readFailure(response: Response, secret: string): Promise<UpstreamFailure> {
  const retryAfter = response.headers.get('retry-after') ?? undefined
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let bytes = 0
  try {
    while (reader) {
      const chunk = await reader.read()
      if (chunk.done) break
      body += decoder.decode(chunk.value.subarray(0, policy.errorBytes - bytes), { stream: true })
      bytes += chunk.value.length
      if (bytes >= policy.errorBytes) break
    }
    body += decoder.decode()
  } finally {
    if (reader) void reader.cancel().catch(() => {})
  }
  let canonical = body
  try { canonical = JSON.stringify(JSON.parse(body)) }
  catch { /* Non-JSON gateway errors are retained as bounded text. */ }
  const redacted = canonical.replaceAll(secret, '[REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+[^\s"']+/g, '[REDACTED]')
  try {
    return { status: response.status, retryAfter, body: JSON.parse(redacted) }
  } catch {
    return { status: response.status, retryAfter, body: redacted }
  }
}

async function forward(req: IncomingMessage, res: ServerResponse, target: Destination, ticket: Ticket) {
  const client = new AbortController()
  res.once('close', () => client.abort())
  const signal = AbortSignal.any([target.signal, client.signal])
  const suffix = target.kind === 'google'
    ? `/models/${target.model}:streamGenerateContent?alt=sse`
    : '/chat/completions'
  const headers = new Headers({ 'content-type': 'application/json', accept: 'text/event-stream' })
  for (const [name, header] of Object.entries(attributionHeaders())) headers.set(name, header)
  if (target.kind === 'google') headers.set('x-goog-api-key', target.secret)
  else headers.set('authorization', `Bearer ${target.secret}`)
  try {
    target.authorize?.()
  } catch (error) {
    ticket.localError = error
    res.writeHead(503).end()
    return
  }
  try {
    const response = await fetch(target.endpoint + suffix, {
      method: 'POST',
      headers,
      body: Readable.toWeb(req) as ReadableStream,
      signal, redirect: 'error', duplex: 'half',
    } as RequestInit)
    if (!response.ok) {
      ticket.failure = { status: response.status, retryAfter: response.headers.get('retry-after') ?? undefined }
      ticket.failure = await readFailure(response, target.secret)
      res.writeHead(response.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Upstream HTTP ${response.status}` } }))
      return
    }
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'text/event-stream' })
    if (response.body) await pipeline(response.body, res, { signal })
    else res.end()
  } catch {
    if (!signal.aborted && !ticket.failure) ticket.failure = { network: true }
    if (res.headersSent) res.destroy()
    else res.writeHead(502).end()
  }
}

// A one-use auth token binds Pi AI's local HTTP request to this exact upstream attempt.
export async function createBridge() {
  const pending = new Map<string, { target: Destination; ticket: Ticket }>()
  const server = createServer((req, res) => {
    const token = req.headers['x-goog-api-key'] ?? req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
    const entry = typeof token === 'string' ? pending.get(token) : undefined
    if (!entry || !validRequest(req, entry.target)) {
      res.writeHead(404).end()
      return
    }
    entry.ticket.close()
    void forward(req, res, entry.target, entry.ticket)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法启动模型密钥池的本地请求桥')
  return {
    url: `http://127.0.0.1:${address.port}`,
    ticket(target: Destination): Ticket {
      target.signal.throwIfAborted()
      const token = randomBytes(32).toString('hex')
      const close = () => {
        pending.delete(token)
        target.signal.removeEventListener('abort', close)
      }
      const ticket = { token, close }
      pending.set(token, { target, ticket })
      target.signal.addEventListener('abort', close, { once: true })
      return ticket
    },
    close() {
      for (const entry of pending.values()) entry.ticket.close()
      server.close()
      server.closeAllConnections()
    },
  }
}

export type Bridge = Awaited<ReturnType<typeof createBridge>>
