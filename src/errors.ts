import type { Protocol, UpstreamFailure } from './bridge.ts'
import { policy } from './policy.ts'

export type Scope = 'key' | 'key-model' | 'group' | 'group-model' | 'vendor'
export type Reason = 'RATE_LIMIT' | 'DAILY_QUOTA' | 'BALANCE' | 'INVALID_KEY' | 'PERMISSION'
export type HealthAction =
  | { type: 'cooldown'; scope: Scope; reason: 'RATE_LIMIT'; until: number }
  | { type: 'block'; scope: Scope; reason: Reason; until?: number }
  | { type: 'revoke' }
  | { type: 'ignore' }
export type Decision = {
  action: HealthAction
  retry: 'next' | 'backoff' | 'stop'
  status?: number
  code?: string
  description?: string
  groupConflict?: boolean
}

const object = (entry: unknown): Record<string, unknown> =>
  entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
const word = (entry: unknown) =>
  typeof entry === 'string' && /^[a-z0-9_:-]{1,100}$/i.test(entry) ? entry : undefined
const text = (entry: unknown) => typeof entry === 'string' ? entry : ''

const pacificDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
})
export function nextPacificMidnight(now: number) {
  const day = pacificDay.format(now)
  let low = Math.floor(now / 1000)
  let high = low + 26 * 3600
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2)
    if (pacificDay.format(middle * 1000) === day) low = middle
    else high = middle
  }
  return high * 1000
}

function retryTime(header: string | undefined, details: Record<string, unknown>[], now: number) {
  const seconds = Number(header)
  const headerTime = header && Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(header ?? '')
  const delays = details.flatMap(detail => {
    const duration = /^(\d+(?:\.\d+)?)s$/.exec(text(detail.retryDelay))
    return duration ? [now + Number(duration[1]) * 1000] : []
  })
  const candidates = [headerTime, ...delays].filter(until => Number.isFinite(until) && until >= now && until <= 8.64e15)
  return Math.ceil(Math.max(now, ...candidates))
}

function googleDecision(failure: UpstreamFailure, now: number, group: string): Decision {
  const err = object(object(failure.body).error)
  const details = Array.isArray(err.details) ? err.details.map(object) : []
  const reasons = details.map(detail => word(detail.reason))
  const code = reasons.find(Boolean) ?? word(err.status)
  const consumer = details.map(detail => text(object(detail.metadata).consumer)).find(id => id.startsWith('projects/'))
  const groupConflict = !!(consumer && /^\d+$/.test(group) && consumer !== `projects/${group}`)
  const evidence = { status: failure.status, code, ...(groupConflict && { groupConflict }) }
  const stop: Decision = { ...evidence, action: { type: 'ignore' }, retry: 'stop' }
  if (groupConflict) return stop
  if (reasons.some(reason => reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED')) {
    return { ...evidence, action: { type: 'revoke' }, retry: 'next' }
  }
  if (failure.status === 403) {
    return { ...evidence, action: { type: 'block', scope: 'key-model', reason: 'PERMISSION' }, retry: 'next' }
  }
  if (failure.status !== 429) return stop
  const violations = details.flatMap(detail => Array.isArray(detail.violations) ? detail.violations.map(object) : [])
  const daily = violations.some(entry => /per.?day|daily|\brpd\b/i.test(text(entry.quotaId) + ' ' + text(entry.quotaMetric))) ||
    /quota exceeded for the day/i.test(text(err.message))
  const scope = violations.some(entry => {
    const dims = object(entry.quotaDimensions)
    return !!(dims.model || dims.model_id) || /per.?model|_model\b/i.test(text(entry.quotaId) + ' ' + text(entry.quotaMetric))
  }) || violations.length === 0 ? 'group-model' : 'group'
  const hintedUntil = retryTime(failure.retryAfter, details, now)
  if (daily) {
    return { ...evidence, action: { type: 'block', scope, reason: 'DAILY_QUOTA',
      until: Math.max(hintedUntil, nextPacificMidnight(now)) }, retry: 'next' }
  }
  const rateScope = failure.retryAfter && !violations.length ? 'vendor' : scope
  return { ...evidence, action: { type: 'cooldown', scope: rateScope, reason: 'RATE_LIMIT',
    until: hintedUntil > now ? hintedUntil : now + policy.cooldownMs }, retry: 'next' }
}

function translate(kind: Protocol, failure: UpstreamFailure, now: number, group: string): Decision {
  if (failure.network) return { action: { type: 'ignore' }, retry: 'backoff' }
  if (kind === 'google') {
    const decision = googleDecision(failure, now, group)
    if (decision.retry === 'stop' && (failure.status ?? 0) >= 500) return { ...decision, retry: 'backoff' }
    return decision
  }
  const err = object(object(failure.body).error)
  const code = word(err.code) ?? word(err.type)
  const evidence = { status: failure.status, code }
  if (failure.status === 401 && code === 'invalid_api_key') {
    return { ...evidence, action: { type: 'revoke' }, retry: 'next' }
  }
  if (failure.status === 429 && code === 'insufficient_quota') {
    return { ...evidence, action: { type: 'block', scope: 'group', reason: 'BALANCE' }, retry: 'next' }
  }
  if (failure.status === 429 && (code === 'rate_limit_exceeded' || failure.retryAfter)) {
    const hintedUntil = retryTime(failure.retryAfter, [], now)
    return { ...evidence, action: { type: 'cooldown', scope: failure.retryAfter ? 'vendor' : 'group-model',
      reason: 'RATE_LIMIT', until: hintedUntil > now ? hintedUntil : now + policy.cooldownMs }, retry: 'next' }
  }
  return { ...evidence, action: { type: 'ignore' }, retry: (failure.status ?? 0) >= 500 ? 'backoff' : 'stop' }
}

export function classify(kind: Protocol, failure: UpstreamFailure, now: number, group: string): Decision {
  const decision = translate(kind, failure, now, group)
  const body = failure.body
  const err = object(object(body).error)
  const message = text(err.message) || text(object(body).message) || text(body)
  const description = message
    .replace(/https?:\/\/[^\s"'<>]+/g, '[URL]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, policy.errorSummaryChars)
  return { ...decision, ...(description && { description }) }
}
