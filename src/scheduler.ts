import type { Channel, KeyConfig, ModelConfig, PoolConfig } from './config.ts'
import type { Decision, Reason, Scope } from './errors.ts'
import { policy } from './policy.ts'

export type Health = { reason: Reason; until?: number; status?: number; code?: string }
export type Candidate = { channel: Channel; model: ModelConfig; key: KeyConfig }
export type Selection = { candidate: Candidate; pool: string; epoch: number; revision: number }
export type RequestSlot = {
  channelId: string; modelId: string; images: boolean; tools: boolean; reasoning: boolean
  contextWindow?: number; maxTokens?: number
  signal: AbortSignal; queueMs: number
}
export type Lease = {
  selection: Selection; queuedMs: number
  authorize: () => void; release: () => void
}
type Pool = { identity: string; epoch: number }
type Waiting = {
  request: RequestSlot; started: number; resolve: (lease: Lease) => void; reject: (error: unknown) => void
  finish: () => void
}
type Gate = { timestamps: number[]; inFlight: number; reservedAt: number; lastSent: number }

export class PoolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const encoded = (...parts: (string | number)[]) => JSON.stringify(parts)
const identity = ({ channel, key }: Candidate) => encoded(channel.id, key.id, key.revision)
const vendor = (channel: Channel) => channel.kind === 'google' ? 'google' : new URL(channel.endpoint).origin
const group = ({ key }: Candidate) => key.group || '未确认'
function scopeKey(candidate: Candidate, scope: Scope) {
  const { channel, model } = candidate
  switch (scope) {
    case 'key': return encoded(scope, identity(candidate))
    case 'key-model': return encoded(scope, identity(candidate), model.upstream)
    case 'group': return encoded(scope, vendor(channel), group(candidate))
    case 'group-model': return encoded(scope, vendor(channel), group(candidate), model.upstream)
    case 'vendor': return encoded(scope, vendor(channel))
  }
}

const scopes = ['key', 'key-model', 'group-model', 'group', 'vendor'] as const
const closeCode = () => new PoolError('POOL_CLOSED', '模型密钥池已关闭')
const timedOut = () => new PoolError('QUEUE_TIMEOUT', '等待可用发送名额超时')

export class Scheduler {
  config: PoolConfig = { channels: [], crossChannel: false }
  revision = 0
  readonly health = new Map<string, Health>()
  readonly recent = new Map<string, Omit<Decision, 'action' | 'retry'> & { at: number }>()
  readonly verified = new Set<string>()
  readonly pools = new Map<string, Pool>()
  private readonly gates = new Map<string, Gate>()
  private readonly modelRpm = new Map<string, number>()
  private readonly waiting: Waiting[] = []
  private readonly accounted = new WeakMap<Selection, number>()
  private interval?: ReturnType<typeof setInterval>
  private closed = false
  private readonly readyAt = Date.now() + policy.startupQuietMs
  onCheckpoint?: () => void

  configure(config: PoolConfig) {
    this.config = config
    this.revision++
    const candidates = this.allCandidates()
    const livePools = new Set(candidates.map(candidate => this.poolId(candidate.channel, candidate.model.id)))
    for (const pool of this.pools.keys()) if (!livePools.has(pool)) this.pools.delete(pool)
    this.modelRpm.clear()
    const active = new Set(candidates.flatMap(candidate => scopes.map(scope => scopeKey(candidate, scope))))
    for (const candidate of candidates) {
      if (!candidate.channel.enabled || !candidate.key.enabled) continue
      const id = scopeKey(candidate, 'group-model')
      const rpm = candidate.model.rpm ?? policy.fallbackRpm
      this.modelRpm.set(id, Math.min(this.modelRpm.get(id) ?? policy.hardRpm, rpm))
    }
    this.pruneGates()
    for (const collection of [this.health, this.recent, this.verified]) {
      for (const key of collection.keys()) if (!active.has(key)) collection.delete(key)
    }
    this.pump()
  }

  allCandidates() {
    return this.config.channels.flatMap(channel => channel.models.flatMap(model => channel.keys.map(key => ({ channel, model, key }))))
  }

  status(candidate: Candidate, now = Date.now()): Health | undefined {
    const records = scopes.flatMap(scope => {
      const record = this.health.get(scopeKey(candidate, scope))
      return record && (record.until === undefined || record.until > now) ? [record] : []
    })
    return records.sort((a, b) => (b.until ?? Infinity) - (a.until ?? Infinity))[0]
  }

  report(selection: Selection, decision: Decision, success = false) {
    if (!this.accounted.has(selection)) return
    const sentAt = this.accounted.get(selection)!
    this.accounted.delete(selection)
    const candidate = selection.candidate
    const currentChannel = this.config.channels.find(channel => channel.id === candidate.channel.id)
    const currentKey = currentChannel?.keys.find(key => key.id === candidate.key.id)
    const currentModel = currentChannel?.models.find(model => model.id === candidate.model.id)
    if (currentKey?.revision !== candidate.key.revision || currentKey.group !== candidate.key.group ||
        currentModel?.upstream !== candidate.model.upstream || currentChannel?.endpoint !== candidate.channel.endpoint ||
        currentChannel.kind !== candidate.channel.kind) return
    const modelScope = scopeKey(candidate, 'key-model')
    if (success) {
      this.verified.add(modelScope)
      return
    }
    this.recent.set(modelScope, { at: Date.now(), status: decision.status, code: decision.code, description: decision.description,
      groupConflict: decision.groupConflict })
    const action = decision.action
    if (action.type === 'ignore') return
    const key = scopeKey(candidate, action.type === 'revoke' ? 'key' : action.scope)
    const record: Health = {
      reason: action.type === 'revoke' ? 'INVALID_KEY' : action.reason,
      until: action.type === 'revoke' ? undefined : action.until,
      status: decision.status, code: decision.code,
    }
    const previous = this.health.get(key)
    if (previous && (previous.until === undefined ||
        (record.until !== undefined && (previous.until >= record.until ||
         (record.reason === 'RATE_LIMIT' && previous.until > sentAt))))) return
    this.health.set(key, record)
    if (record.reason !== 'RATE_LIMIT') this.onCheckpoint?.()
    this.pump()
  }

  recover(candidate: Candidate) {
    for (const scope of scopes) {
      const key = scopeKey(candidate, scope)
      this.health.delete(key)
    }
    this.onCheckpoint?.()
    this.pump()
  }

  snapshot() {
    return this.allCandidates().map(candidate => {
      const modelScope = scopeKey(candidate, 'key-model')
      const active = this.pools.get(this.poolId(candidate.channel, candidate.model.id))
      return {
        channelId: candidate.channel.id, keyId: candidate.key.id, modelId: candidate.model.id,
        health: this.status(candidate), last: this.recent.get(modelScope),
        verified: this.verified.has(modelScope), current: active?.identity === identity(candidate) && !this.status(candidate),
        rpm: this.gateSpecs(candidate).reduce<number>((min, spec) => Math.min(min, spec.rpm), policy.hardRpm),
      }
    })
  }

  private poolId(channel: Channel, model: string) {
    return encoded(this.config.crossChannel && channel.failover ? 'shared' : channel.id, model)
  }

  private candidates(request: RequestSlot) {
    const home = this.config.channels.find(channel => channel.id === request.channelId && channel.enabled)
    if (!home) throw new PoolError('POOL_CONFIG_CHANGED', '渠道已停用或配置已更改')
    const channels = [home, ...this.config.channels.filter(channel =>
      this.config.crossChannel && home.failover && channel !== home && channel.enabled && channel.failover)]
    const candidates = channels.flatMap(channel => channel.models
      .filter(model => model.id === request.modelId && (!request.images || model.images) &&
        (!request.tools || model.tools) && (!request.reasoning || model.reasoning) &&
        (model.contextWindow ?? policy.defaultContextWindow) >= (request.contextWindow ?? 0) &&
        (model.maxTokens ?? policy.defaultMaxTokens) >= (request.maxTokens ?? 0))
      .flatMap(model => channel.keys.filter(key => key.enabled).map(key => ({ channel, model, key }))))
    return { pool: this.poolId(home, request.modelId), candidates }
  }

  private gateSpecs(candidate: Candidate) {
    const { model } = candidate
    const groupModel = scopeKey(candidate, 'group-model')
    const sharedRpm = this.modelRpm.get(groupModel) ?? model.rpm ?? policy.fallbackRpm
    return [
      { id: 'global', rpm: policy.hardRpm, max: policy.concurrency },
      { id: scopeKey(candidate, 'vendor'), rpm: policy.vendorRpm, max: policy.vendorConcurrency },
      { id: scopeKey(candidate, 'group'), rpm: policy.hardRpm, max: policy.groupConcurrency },
      { id: groupModel, rpm: sharedRpm, max: policy.groupConcurrency },
    ]
  }

  private availableGates(candidate: Candidate, now: number) {
    if (now < this.readyAt) return undefined
    const specs = this.gateSpecs(candidate)
    const gates = specs.map(({ id }) => {
      let gate = this.gates.get(id)
      if (!gate) this.gates.set(id, gate = { timestamps: [], inFlight: 0, reservedAt: 0, lastSent: 0 })
      while (gate.timestamps[0] <= now - 60_000) gate.timestamps.shift()
      return gate
    })
    return gates.every((gate, index) => gate.inFlight < specs[index].max &&
      gate.timestamps.length < specs[index].rpm && now >= Math.max(gate.reservedAt, gate.lastSent) + policy.spacingMs) ? gates : undefined
  }

  private pruneGates() {
    const threshold = Date.now() - 60_000
    for (const [id, gate] of this.gates) {
      if (!gate.inFlight && Math.max(gate.lastSent, gate.reservedAt) <= threshold) this.gates.delete(id)
    }
  }

  private take(request: RequestSlot, queuedMs: number): Lease | undefined {
    request.signal.throwIfAborted()
    const now = Date.now()
    const { pool, candidates } = this.candidates(request)
    const current = this.pools.get(pool)
    const active = candidates.find(candidate => identity(candidate) === current?.identity && !this.status(candidate, now))
    const ordered = active ? [active] : candidates.filter(candidate => !this.status(candidate, now))
    const candidate = ordered[0]
    if (!candidate) {
      const held = candidates.map(entry => this.status(entry, now))
      const deadlines = held.flatMap(record => record?.until ? [record.until] : [])
      const reason = held.find(Boolean)?.reason
      const reset = deadlines.length ? `，最早恢复 ${new Date(Math.min(...deadlines)).toISOString()}` : ''
      throw new PoolError('POOL_UNAVAILABLE', `没有可用 Key${reason ? `（${reason}）` : ''}${reset}`)
    }
    const gates = this.availableGates(candidate, now)
    if (!gates) return undefined
    const nextIdentity = identity(candidate)
    const epoch = current?.identity === nextIdentity ? current.epoch : (current?.epoch ?? 0) + 1
    this.pools.set(pool, { identity: nextIdentity, epoch })
    for (const gate of gates) {
      gate.inFlight++
      gate.reservedAt = now
    }
    const selection = { candidate, pool, epoch, revision: this.revision }
    let released = false
    return {
      selection, queuedMs,
      authorize: () => {
        request.signal.throwIfAborted()
        if (this.closed || released || this.accounted.has(selection)) throw closeCode()
        const active = this.pools.get(pool)
        if (selection.revision !== this.revision || active?.epoch !== epoch || this.status(candidate)) {
          throw new PoolError('POOL_STALE_SELECTION', '发送前模型密钥池已切换')
        }
        const sentAt = Date.now()
        const specs = this.gateSpecs(candidate)
        if (gates.some((gate, index) => sentAt < gate.lastSent + policy.spacingMs ||
          gate.timestamps.filter(time => time > sentAt - 60_000).length >= specs[index].rpm)) {
          throw new PoolError('POOL_STALE_SELECTION', '发送前限流窗口已变化')
        }
        for (const gate of gates) {
          gate.lastSent = sentAt
          gate.timestamps.push(sentAt)
        }
        this.accounted.set(selection, sentAt)
      },
      release: () => {
        if (released) return
        released = true
        for (const gate of gates) gate.inFlight--
        this.pump()
      },
    }
  }

  acquire(request: RequestSlot): Promise<Lease> {
    if (this.closed) return Promise.reject(closeCode())
    if (this.waiting.length >= policy.queueCapacity) return Promise.reject(new PoolError('QUEUE_FULL', '模型请求队列已满'))
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const index = this.waiting.indexOf(waiting)
        if (index < 0) return
        this.waiting.splice(index, 1)
        waiting.finish()
        reject(request.signal.reason)
        this.pump()
      }
      const deadline = setTimeout(() => {
        const index = this.waiting.indexOf(waiting)
        if (index < 0) return
        this.waiting.splice(index, 1)
        waiting.finish()
        reject(timedOut())
        this.pump()
      }, Math.max(0, request.queueMs))
      const waiting: Waiting = {
        request, resolve, reject, started: performance.now(),
        finish: () => {
          clearTimeout(deadline)
          request.signal.removeEventListener('abort', cancel)
        },
      }
      this.waiting.push(waiting)
      request.signal.addEventListener('abort', cancel, { once: true })
      this.pump()
    })
  }

  private pump() {
    const blocked = new Set<string>()
    for (const waiting of [...this.waiting]) {
      const { request } = waiting
      const elapsed = performance.now() - waiting.started
      try {
        request.signal.throwIfAborted()
        if (this.closed) throw closeCode()
        if (elapsed >= request.queueMs) throw timedOut()
        const home = this.config.channels.find(channel => channel.id === request.channelId)
        const pool = home && this.poolId(home, request.modelId)
        if (pool && blocked.has(pool)) continue
        const lease = this.take(request, elapsed)
        if (!lease) {
          if (pool) blocked.add(pool)
          continue
        }
        waiting.resolve(lease)
      } catch (error) {
        waiting.reject(error)
      }
      this.waiting.splice(this.waiting.indexOf(waiting), 1)
      waiting.finish()
    }
    if (this.waiting.length === 0) {
      clearInterval(this.interval)
      this.interval = undefined
    } else if (!this.interval) {
      this.interval = setInterval(() => this.pump(), policy.queuePollMs)
    }
  }

  close() {
    this.closed = true
    this.pump()
  }
}
