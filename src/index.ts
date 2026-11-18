import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-settings'
import { LlmError, resolveImageAttachmentAccess, type AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { PoolAdapter } from './adapter.ts'
import { createBridge } from './bridge.ts'
import { Checkpoints, claimProfile } from './checkpoints.ts'
import { Config, credentialId, namespace, normalizeEndpoint, routeFor, validUpstream, validateConfig, type Channel, type PoolConfig } from './config.ts'
import { KeyDiagnostics } from './diagnostics.ts'
import { policy } from './policy.ts'
import { Scheduler } from './scheduler.ts'

export { Config }
export const name = namespace
export const inject = ['llm', 'settings', 'credentials']

type LiveConfig = { crossChannel: Volatile<boolean>; channels: Volatile<Channel[]> }
const secretSchema = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/)
const saveSchema = z.object({
  revision: z.number().int().nonnegative(),
  config: z.object({ crossChannel: z.boolean(), channels: z.array(z.unknown()).max(32) }).strict(),
  newKeys: z.array(z.object({
    channelId: z.string().max(80), keyId: z.string().max(80),
    secret: secretSchema,
  }).strict()).max(128),
}).strict()
const restoreSchema = z.object({
  channelId: z.string().max(80), keyId: z.string().max(80), modelId: z.string().max(160),
}).strict()
const diagnosticSchema = z.object({
  channelId: z.string().max(80), keyId: z.string().max(80),
  kind: z.enum(['google', 'openai']), endpoint: z.string().max(2048),
  model: z.string().min(1).max(160).optional(), secret: secretSchema.optional(),
  revision: z.number().int().positive(),
}).strict()
const json = (entry: unknown): z.core.util.JSONType => JSON.parse(JSON.stringify(entry))

class PoolService extends TypertRemoteService {
  private pendingWrite = Promise.resolve()
  private readonly diagnostics = new KeyDiagnostics()
  private readonly host: Context
  private readonly scheduler: Scheduler
  private readonly checkpoints: Checkpoints
  private readonly profileDir: string
  configIssue?: string
  cleanupIssue?: string

  constructor(ctx: Context, scheduler: Scheduler, checkpoints: Checkpoints, profileDir: string) {
    super(ctx, 'modelKeyPool')
    this.host = ctx
    this.scheduler = scheduler
    this.checkpoints = checkpoints
    this.profileDir = profileDir
  }

  private settingsRevision() {
    const descriptor = this.host.settings.describe({ redactSecrets: true }).find(entry => entry.ns === namespace)
    if (!descriptor) throw new Error('DSH 尚未载入模型密钥池的配置')
    return descriptor.revision
  }

  credential(channel: string, key: string, revision: number) {
    const id = createHash('sha256').update(`${this.profileDir}: ${credentialId(channel, key, revision)}`).digest('hex')
    return credentialKey(namespace, `k-${id}`)
  }

  @Remote
  read() {
    return json({
      revision: this.settingsRevision(), config: this.scheduler.config, policy,
      health: this.scheduler.snapshot(), checkpointBlocked: this.checkpoints.blocked,
      issue: this.configIssue ?? this.checkpoints.issue ?? this.cleanupIssue,
    })
  }

  @Remote
  save(payload: unknown) {
    const work = this.pendingWrite.then(() => this.commit(payload))
    this.pendingWrite = work.then(() => {}, () => {})
    return work
  }

  @Remote
  async diagnose(payload: unknown) {
    const parsed = diagnosticSchema.safeParse(payload)
    if (!parsed.success) throw new Error('请检查测试所用的 Key 或模型 ID')
    const { channelId, keyId, kind, revision, model } = parsed.data
    if (model && !validUpstream(kind, model)) throw new Error('上游模型 ID 无效')
    const endpoint = normalizeEndpoint(kind, parsed.data.endpoint)
    let secret = parsed.data.secret
    if (!secret) {
      const channel = this.scheduler.config.channels.find(entry => entry.id === channelId)
      const key = channel?.keys.find(entry => entry.id === keyId)
      if (!key) throw new Error('请先输入 API Key')
      if (key.revision !== revision || channel?.kind !== kind || channel.endpoint !== endpoint) {
        throw new Error('凭证版本或渠道地址已变更，请重新载入配置或输入新 Key')
      }
      const record = await this.host.credentials.readRecord(this.credential(channelId, keyId, revision))
      secret = record?.kind === 'api-key' ? record.key : undefined
      if (!secret || !secretSchema.safeParse(secret).success) throw new Error('已保存的凭证不可用，请重新输入')
    }
    return json(await this.diagnostics.run({ kind, endpoint, secret, model }))
  }

  private async commit(payload: unknown) {
    const parsed = saveSchema.safeParse(payload)
    if (!parsed.success) throw new Error('密钥池配置或凭证格式无效，请检查输入')
    const { revision, newKeys } = parsed.data
    if (this.settingsRevision() !== revision) throw new Error('配置已被其他页面修改，请重新载入后保存')
    const next = validateConfig(parsed.data.config)
    const old = this.scheduler.config
    const newSecrets = new Map(newKeys.map(entry => [credentialId(entry.channelId, entry.keyId, 0), entry.secret]))
    if (newSecrets.size !== newKeys.length) throw new Error('同一把 Key 只能提交一次')
    const staged = []
    const live = new Set<string>()
    try {
      for (const channel of next.channels) {
        const previousChannel = old.channels.find(entry => entry.id === channel.id)
        for (const key of channel.keys) {
          const previous = previousChannel?.keys.find(entry => entry.id === key.id)
          const ref = this.credential(channel.id, key.id, key.revision)
          const token = credentialId(channel.id, key.id, 0)
          const secret = newSecrets.get(token)
          newSecrets.delete(token)
          live.add(ref)
          if (!secret) {
            if (!previous || previous.revision !== key.revision || previousChannel?.endpoint !== channel.endpoint ||
                previousChannel.kind !== channel.kind || !(await this.host.credentials.describeRecord(ref)).configured) {
              throw new Error('新增 Key 或变更渠道端点时，请重新输入该渠道的凭证')
            }
            continue
          }
          if (key.revision !== (previous?.revision ?? 0) + 1) throw new Error('凭证版本已变更，请重新载入')
          let created = false
          await this.host.credentials.modifyRecord(ref, async record => {
            if (record) throw new Error('凭证版本已存在，请使用新的 Key 条目')
            created = true
            return { kind: 'api-key', key: secret }
          })
          if (created) staged.push(ref)
        }
      }
      if (newSecrets.size) throw new Error('提交的 Key 与渠道配置不一致')
      await this.host.settings.replace(namespace, next, revision)
    } catch (error) {
      for (const ref of staged) await this.removeCredential(ref)
      throw error
    }
    for (const channel of old.channels) {
      for (const key of channel.keys) {
        const ref = this.credential(channel.id, key.id, key.revision)
        if (!live.has(ref)) await this.removeCredential(ref)
      }
    }
    return this.read()
  }

  private async removeCredential(ref: ReturnType<typeof credentialKey>) {
    try { await this.host.credentials.deleteRecord(ref) }
    catch { this.cleanupIssue = '有旧凭证未能从 DSH 凭证库清除，请检查存储权限。' }
  }

  @Remote
  async restore(payload: unknown) {
    if (this.checkpoints.blocked) {
      if (payload !== null) throw new Error('请先重建健康检查点')
      await this.checkpoints.save()
      return this.read()
    }
    const parsed = restoreSchema.safeParse(payload)
    if (!parsed.success) throw new Error('请选择有效的渠道、Key 和模型')
    const { channelId, keyId, modelId } = parsed.data
    const candidate = this.scheduler.allCandidates().find(entry =>
      entry.channel.id === channelId && entry.key.id === keyId && entry.model.id === modelId)
    if (!candidate) throw new Error('该 Key 或模型已删除')
    this.scheduler.recover(candidate)
    await this.checkpoints.save()
    return this.read()
  }
}

export async function apply(ctx: Context, live: LiveConfig) {
  const lifecycle = new AbortController()
  const scheduler = new Scheduler()
  const profileDir = dirname(ctx.settings.documentPath)
  const releaseProfile = await claimProfile(join(profileDir, namespace, 'instance'))
  ctx.effect(() => releaseProfile)
  const checkpoints = new Checkpoints(join(profileDir, namespace, 'runtime-checkpoints.json'), scheduler)
  await checkpoints.load()
  const bridge = await createBridge()
  let registration: AdapterRegistrationHandle | undefined
  ctx.effect(() => async () => {
    lifecycle.abort()
    scheduler.close()
    registration?.()
    bridge.close()
    await checkpoints.close()
  })
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  scheduler.onCheckpoint = () => { if (!checkpoints.blocked) void checkpoints.save() }
  const service = new PoolService(ctx, scheduler, checkpoints, profileDir)
  const adapter = new PoolAdapter({
    bridge, scheduler, lifecycle: lifecycle.signal,
    secret: async (channel, key, revision) => {
      if (checkpoints.blocked) throw new LlmError(checkpoints.issue ?? '健康检查点不可用', 'POOL_CHECKPOINT')
      if (service.configIssue) throw new LlmError(service.configIssue, 'POOL_INVALID_CONFIG')
      const record = await ctx.credentials.readRecord(service.credential(channel, key, revision))
      return record?.kind === 'api-key' ? record.key : undefined
    },
    attachments: () => ctx.get('attachments'),
    imageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
  })
  let previous: string | undefined
  let ownedRoutes = new Set<string>()
  function reload() {
    let next: PoolConfig
    try {
      next = validateConfig({ crossChannel: live.crossChannel.get(), channels: live.channels.get() })
    } catch {
      service.configIssue = '渠道配置无效，请检查模型、Key 和端点设置。'
      return
    }
    const serialized = JSON.stringify(next)
    service.configIssue = undefined
    if (serialized === previous) return
    const enabled = next.channels.filter(channel => channel.enabled && channel.keys.some(key => key.enabled))
    const routes = enabled.map(channel => routeFor(channel.id))
    if (ctx.llm.listProviders().some(provider => routes.includes(provider.id) && !ownedRoutes.has(provider.id))) {
      service.configIssue = '渠道路由已被其他插件占用，请重新创建该渠道。'
      return
    }
    adapter.configure(enabled)
    scheduler.configure(next)
    if (registration) registration.replace(routes)
    else if (routes.length) registration = ctx.llm.registerAdapter(routes, adapter)
    ownedRoutes = new Set(routes)
    previous = serialized
  }
  ctx.on('settings/document-updated', changed => { if (changed === namespace) reload() })
  reload()
}
