import { appendFile, rename, stat } from 'node:fs/promises'
import { readBoundedBody } from './bridge.ts'
import { policy } from './policy.ts'

function modelRequest(address: string) {
  const url = new URL(address)
  if (url.protocol !== 'https:') return
  const studio = url.hostname === 'generativelanguage.googleapis.com'
  const vertex = /^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/.test(url.hostname)
  if (!studio && !vertex) return
  const model = /\/models\/([\w.-]+):(streamGenerateContent|generateContent|countTokens)$/.exec(url.pathname)
  if (!model && !/\/models$/.test(url.pathname)) return
  return {
    provider: studio ? 'google' : 'google-vertex', host: url.hostname,
    operation: model?.[2] ?? 'listModels', model: model?.[1], apiKey: url.searchParams.get('key'),
  }
}

async function appendError(path: string, entry: object) {
  const size = await stat(path).then(file => file.size, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return 0
    throw error
  })
  if (size >= policy.googleErrorLogBytes) await rename(path, `${path}.1`)
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function captureGoogleError(response: Response, input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : undefined
  const target = modelRequest(request?.url ?? String(input))
  if (!target || (response.url && !modelRequest(response.url))) return

  const at = new Date().toISOString()
  const { apiKey, ...route } = target
  const headers = new Headers(init?.headers ?? request?.headers)
  const secrets = [apiKey, headers.get('x-goog-api-key'), headers.get('authorization')?.replace(/^Bearer\s+/i, '')]
  const redact = (text: string) => {
    for (const secret of secrets) {
      if (secret) text = text.replaceAll(secret, '[REDACTED]')
    }
    return text.replace(/AIza[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9._-]+|Bearer\s+[^\s"'\\]+/gi, '[REDACTED]')
  }
  const header = (name: string) => redact(response.headers.get(name) ?? '') || undefined
  const body = await readBoundedBody(response.clone(), policy.googleErrorBodyBytes + 1,
    AbortSignal.timeout(policy.googleErrorReadMs)).catch(() => undefined)
  const bodyAtLimit = body !== undefined && Buffer.byteLength(body) > policy.googleErrorBodyBytes
  return {
    at, ...route, model: route.model && redact(route.model), status: response.status,
    contentType: header('content-type'), retryAfter: header('retry-after'),
    requestId: header('x-goog-request-id') ?? header('x-request-id'),
    body: body === undefined ? undefined : redact(body),
    bodyReadFailed: body === undefined || undefined, bodyAtLimit: bodyAtLimit || undefined,
  }
}

export function installGoogleErrorLog(path: string, onWriteFailure: (error: unknown) => void) {
  const previousFetch = globalThis.fetch
  const captures = new Set<Promise<void>>()
  let writes = Promise.resolve()
  let active = true
  const fetchWithGoogleErrorLog: typeof fetch = async (input, init) => {
    const response = await previousFetch(input, init)
    if (!active || response.status < 400) return response
    const job = captureGoogleError(response, input, init).then(entry => {
      if (!entry) return
      writes = writes.then(() => appendError(path, entry)).catch(onWriteFailure)
      return writes
    }, onWriteFailure).finally(() => captures.delete(job))
    captures.add(job)
    return response
  }
  globalThis.fetch = fetchWithGoogleErrorLog
  return async () => {
    active = false
    if (globalThis.fetch === fetchWithGoogleErrorLog) globalThis.fetch = previousFetch
    await Promise.all(captures)
  }
}
