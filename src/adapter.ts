import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import {
  contentHasImage, LlmAdapter, LlmError, resolveRetryPolicy,
  type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type PiAiAdapterOptions, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { Api, Model, Provider, ProviderStreams } from '@earendil-works/pi-ai'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { Bridge } from './bridge.ts'
import { routeFor, type Channel } from './config.ts'
import { classify } from './errors.ts'
import { policy } from './policy.ts'
import { PoolError, type Scheduler } from './scheduler.ts'

const noHostRetry = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'model-key-pool')
const noAmbientAuth: PiAiAdapterOptions['auth'] = {
  credentials: {
    read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {},
  },
  authContext: { env: async () => undefined, fileExists: async () => false },
}

function piProfile(channel: Channel, bridge: Bridge): ResolvedPiAiProviderProfile {
  const provider = routeFor(channel.id)
  const isGoogle = channel.kind === 'google'
  const baseUrl = isGoogle ? bridge.url + '/v1beta' : channel.endpoint
  const api = isGoogle ? 'google-generative-ai' : 'openai-completions'
  const protocol = isGoogle ? googleGenerativeAIApi() : compatibleTransport(bridge)
  const models = new Map<string, Model<Api>>()
  for (const model of channel.models) {
    models.set(model.upstream, {
      id: model.upstream, provider, name: model.id, api, baseUrl, reasoning: model.reasoning,
      input: model.images ? ['text', 'image'] : ['text'],
      contextWindow: model.contextWindow ?? policy.defaultContextWindow, maxTokens: model.maxTokens ?? policy.defaultMaxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })
  }
  const piProvider: Provider = {
    id: provider, name: channel.name, baseUrl,
    auth: { apiKey: { name: channel.name, resolve: async ({ credential }) => ({
      auth: credential?.key ? { apiKey: credential.key } : {}, source: channel.name,
    }) } },
    getModels: () => [...models.values()],
    ...protocol,
  }
  return {
    provider, displayName: channel.name, retryPolicy: noHostRetry, piProvider,
    streamIdleTimeoutMs: policy.streamIdleMs, maxRequestImageBytes: policy.requestImageBytes,
    requestImagePixelBudget: policy.imagePixels, requestImageMaxBytes: policy.imageBytes,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(channel.models.flatMap(model => model.maxTokens ? [[model.upstream, model.maxTokens]] : [])),
  }
}

function compatibleTransport(bridge: Bridge): ProviderStreams {
  const protocol = openAICompletionsApi()
  const localFetch: typeof fetch = (_url, options) => fetch(bridge.url + '/v1/chat/completions', options)
  // Keep the real endpoint for Pi AI's provider compatibility rules.
  return {
    stream: (model, context, options) => protocol.stream(model, context, { ...options, fetch: localFetch }),
    streamSimple: (model, context, options) => protocol.streamSimple(model, context, { ...options, fetch: localFetch }),
  }
}

const meaningful = (chunk: StreamChunk) => {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta': return chunk.text.length > 0
    case 'tool-call-delta': return true
    case 'block-end': return chunk.block.type !== 'text' && chunk.block.type !== 'reasoning' || chunk.block.text.length > 0
    default: return false
  }
}

type AdapterOptions = {
  bridge: Bridge
  scheduler: Scheduler
  lifecycle: AbortSignal
  secret: (channelId: string, keyId: string, revision: number) => Promise<string | undefined>
  attachments?: PiAiAdapterOptions['resolveAttachments']
  imageAccess?: PiAiAdapterOptions['resolveImageAccess']
  endpoint?: (channel: Channel) => string
}

export class PoolAdapter extends LlmAdapter {
  private readonly dependencies: AdapterOptions
  private readonly tickets = new AsyncLocalStorage<string>()
  private readonly inner: PiAiAdapter
  private profiles = new Map<string, ResolvedPiAiProviderProfile>()

  constructor(dependencies: AdapterOptions) {
    super()
    this.dependencies = dependencies
    this.inner = new PiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: async () => this.tickets.getStore(),
      auth: noAmbientAuth, resolveAttachments: dependencies.attachments, resolveImageAccess: dependencies.imageAccess,
    })
  }

  configure(channels: Channel[]) {
    this.profiles = new Map(channels.map(channel => [routeFor(channel.id), piProfile(channel, this.dependencies.bridge)]))
  }

  private channelFor(provider: string) {
    const channel = this.dependencies.scheduler.config.channels.find(entry => routeFor(entry.id) === provider && entry.enabled)
    if (!channel) throw new LlmError('模型密钥池渠道已停用', 'POOL_CONFIG_CHANGED')
    return channel
  }

  providerInfo(provider: string) {
    return { id: provider, name: this.channelFor(provider).name }
  }

  providerRetryPolicy() { return noHostRetry }

  async listModels(provider: string) {
    return this.channelFor(provider).models.map(model => ({
      provider, id: model.id, name: model.id,
      inputModalities: model.images ? ['text' as const, 'image' as const] : ['text' as const],
    }))
  }

  async resolveModel(provider: string, modelId: string, signal?: AbortSignal) {
    const model = this.channelFor(provider).models.find(entry => entry.id === modelId)
    if (!model) throw new LlmError('该渠道未配置此模型', 'UNKNOWN_MODEL')
    const info = await this.inner.resolveModel(provider, model.upstream, signal)
    return { ...info, id: modelId, name: modelId }
  }

  override async prepareCall(provider: string, modelId: string, signal?: AbortSignal) {
    const revision = this.dependencies.scheduler.revision
    const model = await this.resolveModel(provider, modelId, signal)
    return {
      model,
      stream: (options: GenerateOptions) => {
        if (revision !== this.dependencies.scheduler.revision) {
          throw new LlmError('模型配置已变化，请重新发送', 'POOL_CONFIG_CHANGED')
        }
        return this.stream(options, revision)
      },
    }
  }

  override imageRequestTarget(provider: string, model: string, image: Parameters<LlmAdapter['imageRequestTarget']>[2]) {
    const mapped = this.channelFor(provider).models.find(entry => entry.id === model)
    return mapped ? this.inner.imageRequestTarget(provider, mapped.upstream, image) : super.imageRequestTarget(provider, model, image)
  }

  async *stream(options: GenerateOptions, preparedRevision = this.dependencies.scheduler.revision): AsyncIterable<StreamChunk> {
    const { bridge, scheduler, lifecycle, secret, endpoint } = this.dependencies
    const requestSignal = options.signal ? AbortSignal.any([options.signal, lifecycle]) : lifecycle
    const home = this.channelFor(options.provider)
    const homeModel = home.models.find(model => model.id === options.model)
    if (!homeModel) throw new LlmError('该渠道未配置此模型', 'UNKNOWN_MODEL')
    const request = {
      channelId: home.id, modelId: options.model, signal: requestSignal,
      images: options.messages.some(message => contentHasImage(message.content)),
      tools: !!options.tools?.length,
      reasoning: !!options.reasoningEffort && options.reasoningEffort !== 'off',
      contextWindow: homeModel.contextWindow ?? policy.defaultContextWindow,
      maxTokens: options.maxTokens ?? homeModel.maxTokens ?? policy.defaultMaxTokens,
    }
    let queueMs = policy.queueMs as number
    let lastFailure: StreamChunk | undefined
    for (let attempt = 1; attempt <= policy.attempts; attempt++) {
      if (requestSignal.aborted) throw new LlmError('请求已取消', 'ABORTED')
      if (preparedRevision !== scheduler.revision) throw new LlmError('模型配置已变化，请重新发送', 'POOL_CONFIG_CHANGED')
      let lease
      try {
        lease = await scheduler.acquire({ ...request, queueMs })
      } catch (error) {
        if (requestSignal.aborted) throw new LlmError('请求已取消', 'ABORTED')
        if (error instanceof PoolError) throw new LlmError(error.message, error.code)
        throw error
      }
      queueMs -= lease.queuedMs
      const { channel, key, model } = lease.selection.candidate
      const output: StreamChunk[] = []
      let started = false
      let retry: 'next' | 'backoff' | 'stop' = 'stop'
      let ticket: ReturnType<Bridge['ticket']> | undefined
      try {
        const apiKey = await secret(channel.id, key.id, key.revision)
        if (!apiKey) {
          lease.authorize()
          scheduler.report(lease.selection, { action: { type: 'revoke' }, retry: 'next', code: 'MISSING_CREDENTIAL' })
          retry = 'next'
          lastFailure = errorFinish('MISSING_CREDENTIAL', '密钥池未找到已保存的凭证')
        } else {
          ticket = bridge.ticket({
            kind: channel.kind, endpoint: endpoint?.(channel) ?? channel.endpoint,
            model: model.upstream, secret: apiKey, signal: requestSignal, authorize: lease.authorize,
          })
          const wire = this.inner.stream({
            ...options, provider: routeFor(channel.id), model: model.upstream, signal: requestSignal,
          })[Symbol.asyncIterator]()
          let settled = false
          try {
            while (true) {
              const next = await this.tickets.run(ticket.token, () => wire.next())
              if (next.done) break
              const chunk = next.value
              if (chunk.type === 'finish') {
                settled = true
                if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
                  if (requestSignal.aborted) throw new LlmError('请求已取消', 'ABORTED')
                  const decision = ticket.failure && classify(channel.kind, ticket.failure, Date.now(), key.group)
                  if (decision) scheduler.report(lease.selection, decision)
                  retry = ticket.localError instanceof PoolError && ticket.localError.code === 'POOL_STALE_SELECTION'
                    ? 'next' : decision?.retry ?? 'stop'
                  const code = decision?.code ?? chunk.reason.failure.code
                  const status = decision?.status
                  const detail = decision?.groupConflict ? '（上游项目与配置不一致）' : ''
                  const baseMessage = status ? `上游 HTTP ${status} · ${code}${detail}` : `模型请求失败 · ${code}`
                  lastFailure = errorFinish(code, started ? `${baseMessage}。回复中途截断，未自动换 Key 重试。` : baseMessage, status)
                  break
                }
                scheduler.report(lease.selection, { action: { type: 'ignore' }, retry: 'stop' }, true)
                for (const pending of output) yield pending
                yield chunk
                return
              }
              if (started) yield chunk
              else if (meaningful(chunk)) {
                started = true
                for (const pending of output.splice(0)) yield pending
                yield chunk
              } else if (output.length < policy.streamPreambleChunks) output.push(chunk)
              else throw new LlmError('模型返回了过多空块', 'POOL_INVALID_STREAM')
            }
            if (!settled) lastFailure = errorFinish('STREAM_CLOSED', started ? '回复中途截断，未自动换 Key 重试。' : '模型流已关闭')
          } finally {
            await wire.return?.()
          }
        }
      } catch (error) {
        if (requestSignal.aborted) throw new LlmError('请求已取消', 'ABORTED')
        if (started) {
          yield errorFinish('STREAM_CLOSED', '回复中途截断，未自动换 Key 重试。')
          return
        }
        if (error instanceof PoolError && error.code === 'POOL_STALE_SELECTION') retry = 'next'
        else if (ticket?.failure?.network) retry = 'backoff'
        else {
          const code = error instanceof LlmError || error instanceof PoolError ? error.code : 'POOL_REQUEST_FAILED'
          lastFailure = errorFinish(code ?? 'POOL_REQUEST_FAILED', '密钥池无法完成模型请求')
        }
      } finally {
        ticket?.close()
        lease.release()
      }
      if (started || retry === 'stop' || attempt >= policy.attempts) {
        yield lastFailure ?? errorFinish('POOL_REQUEST_FAILED', '密钥池无法完成模型请求')
        return
      }
      if (retry === 'backoff') {
        const jitter = 1 + (Math.random() * 2 - 1) * policy.backoffJitter
        const backoff = policy.backoffMs * 2 ** (attempt - 1) * jitter
        try { await delay(backoff, undefined, { signal: requestSignal }) }
        catch { throw new LlmError('请求已取消', 'ABORTED') }
      }
    }
  }
}

function errorFinish(code: string, message: string, status?: number): StreamChunk {
  return { type: 'finish', reason: { kind: 'error', failure: { code, message, status } } }
}
