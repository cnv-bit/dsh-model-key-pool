import z from '@deepseek-ai/schemastery'
import { z as validate } from 'zod'
import type { Protocol } from './bridge.ts'
import { policy } from './policy.ts'

export const namespace = 'model-key-pool'
export const googleEndpoint = 'https://generativelanguage.googleapis.com/v1beta'

export type KeyConfig = { id: string; label: string; enabled: boolean; revision: number; group: string }
export type ModelConfig = {
  id: string
  upstream: string
  images: boolean
  tools: boolean
  reasoning: boolean
  rpm?: number
  contextWindow?: number
  maxTokens?: number
}
export type Channel = {
  id: string
  name: string
  kind: Protocol
  endpoint: string
  enabled: boolean
  failover: boolean
  models: ModelConfig[]
  keys: KeyConfig[]
}
export type PoolConfig = { crossChannel: boolean; channels: Channel[] }
export type KeyInput = { channelId: string; keyId: string; secret: string }

const keySchema = z.object({
  id: z.string().required(), label: z.string().required(), enabled: z.boolean().required(),
  revision: z.number().required(), group: z.string().default(''),
})
const modelSchema = z.object({
  id: z.string().required(), upstream: z.string().required(), images: z.boolean().required(),
  tools: z.boolean().required(), reasoning: z.boolean().required(), rpm: z.number(),
  contextWindow: z.number(), maxTokens: z.number(),
})
const channelsSchema = z.array(z.object({
  id: z.string().required(), name: z.string().required(),
  kind: z.union([z.const('google'), z.const('openai')]).required(),
  endpoint: z.string().default(''), enabled: z.boolean().required(), failover: z.boolean().required(),
  models: z.array(modelSchema).required(), keys: z.array(keySchema).required(),
})).default([])
export const Config = z.object({
  crossChannel: z.boolean().default(false).volatile(),
  channels: channelsSchema.volatile(),
})

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/
const modelPattern = /^[a-zA-Z0-9_.:-]{1,160}$/
const upstreamPattern = /^[a-zA-Z0-9_.:/-]{1,160}$/
const id = validate.string().regex(idPattern)
const modelId = validate.string().regex(modelPattern)
const plainConfig = validate.object({
  crossChannel: validate.boolean(),
  channels: validate.array(validate.object({
    id, name: validate.string().trim().min(1).max(100),
    kind: validate.enum(['google', 'openai']),
    endpoint: validate.string().max(2_048),
    enabled: validate.boolean(), failover: validate.boolean(),
    models: validate.array(validate.object({
      id: modelId, upstream: validate.string().regex(upstreamPattern), images: validate.boolean(), tools: validate.boolean(),
      reasoning: validate.boolean(), rpm: validate.number().int().min(1).max(1_000_000).optional(),
      contextWindow: validate.number().int().positive().max(100_000_000).optional(),
      maxTokens: validate.number().int().positive().max(100_000_000).optional(),
    }).strict()).max(64),
    keys: validate.array(validate.object({
      id, label: validate.string().trim().min(1).max(100), enabled: validate.boolean(),
      revision: validate.number().int().positive(),
      group: validate.string().trim().max(80).regex(/^[^\u0000-\u001f\u007f]*$/),
    }).strict()).max(128),
  }).strict()).max(32),
}).strict()
export const routeFor = (id: string) => `model-key-pool-${id}`
export const credentialId = (channel: string, key: string, revision: number) => `${channel}.${key}.${revision}`

function validateIds(entries: { id: string }[]) {
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('配置包含重复的 ID')
}

export function validateConfig(input: unknown): PoolConfig {
  const parsed = plainConfig.safeParse(input)
  if (!parsed.success) throw new Error('渠道配置无效，请检查名称、模型 ID、RPM 和配额组')
  const config = parsed.data
  validateIds(config.channels)
  const requestedCandidates = config.channels.reduce((count, channel) => count + channel.keys.length * channel.models.length, 0)
  if (requestedCandidates > policy.candidateCapacity) throw new Error('渠道、模型和 Key 组合超过密钥池容量')
  for (const channel of config.channels) {
    if (channel.kind === 'google') {
      channel.endpoint = googleEndpoint
      if (channel.models.some(model => !modelPattern.test(model.upstream))) {
        throw new Error('Google 上游模型填模型 ID，不含 models/ 前缀')
      }
    } else {
      let url: URL
      try { url = new URL(channel.endpoint) }
      catch { throw new Error('请填写有效的兼容渠道地址') }
      const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) {
        throw new Error('兼容渠道使用 HTTPS 或本机 HTTP 地址，请去掉登录信息、查询参数和片段')
      }
      channel.endpoint = url.href.replace(/\/+$/, '')
    }
    validateIds(channel.models)
    validateIds(channel.keys)
    if (channel.models.some(model => (model.maxTokens ?? policy.defaultMaxTokens) >
        (model.contextWindow ?? policy.defaultContextWindow))) throw new Error('模型最大输出不能超过上下文窗口')
    const upstreamCapabilities = new Map<string, string>()
    for (const model of channel.models) {
      const capabilities = JSON.stringify([model.tools, model.images, model.reasoning,
        model.contextWindow ?? policy.defaultContextWindow, model.maxTokens ?? policy.defaultMaxTokens])
      const existing = upstreamCapabilities.get(model.upstream)
      if (existing && existing !== capabilities) throw new Error('映射到同一上游模型的能力与上下文配置必须一致')
      upstreamCapabilities.set(model.upstream, capabilities)
    }
    if (channel.enabled && !channel.models.length) throw new Error('启用渠道前请添加模型')
  }
  return config
}
