var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name2, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name: name2, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name2, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name2]() {
    return __privateGet(this, extra);
  }, set [name2](x) {
    return __privateSet(this, extra, x);
  } }, name2));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name2) : __name(target, name2);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name2, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name2 in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name2];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name2] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name2, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/index.ts
import { createHash } from "node:crypto";
import { dirname as dirname2, join } from "node:path";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { LlmError as LlmError2, resolveImageAttachmentAccess } from "@deepseek-ai/dsh-llm";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z as z4 } from "zod";

// src/adapter.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  contentHasImage,
  LlmAdapter,
  LlmError,
  resolveRetryPolicy
} from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

// src/config.ts
import z from "@deepseek-ai/schemastery";
import { z as validate } from "zod";

// src/policy.ts
var policy = Object.freeze({
  queueMs: 15e3,
  queueCapacity: 32,
  candidateCapacity: 4096,
  attempts: 3,
  fallbackRpm: 12,
  hardRpm: 60,
  vendorRpm: 60,
  concurrency: 4,
  vendorConcurrency: 3,
  groupConcurrency: 2,
  spacingMs: 100,
  startupQuietMs: 1e3,
  queuePollMs: 25,
  instanceLockWaitMs: 100,
  defaultContextWindow: 262144,
  defaultMaxTokens: 32768,
  streamIdleMs: 3e5,
  streamPreambleChunks: 64,
  requestImageBytes: 20 * 1024 * 1024,
  imagePixels: 2e6,
  imageBytes: 2e6,
  cooldownMs: 6e4,
  backoffMs: 500,
  backoffJitter: 0.1,
  errorBytes: 16384,
  errorSummaryChars: 800,
  diagnosticTimeoutMs: 15e3,
  diagnosticIntervalMs: 500,
  catalogBytes: 1e6,
  catalogPages: 5,
  checkpointBytes: 1e6
});

// src/config.ts
var namespace = "model-key-pool";
var googleEndpoint = "https://generativelanguage.googleapis.com/v1beta";
var keySchema = z.object({
  id: z.string().required(),
  label: z.string().required(),
  enabled: z.boolean().required(),
  revision: z.number().required(),
  group: z.string().default("")
});
var modelSchema = z.object({
  id: z.string().required(),
  upstream: z.string().required(),
  images: z.boolean().required(),
  tools: z.boolean().required(),
  reasoning: z.boolean().required(),
  rpm: z.number(),
  contextWindow: z.number(),
  maxTokens: z.number()
});
var channelsSchema = z.array(z.object({
  id: z.string().required(),
  name: z.string().required(),
  kind: z.union([z.const("google"), z.const("openai")]).required(),
  endpoint: z.string().default(""),
  enabled: z.boolean().required(),
  failover: z.boolean().required(),
  models: z.array(modelSchema).required(),
  keys: z.array(keySchema).required()
})).default([]);
var Config = z.object({
  crossChannel: z.boolean().default(false).volatile(),
  channels: channelsSchema.volatile()
});
var idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
var modelPattern = /^[a-zA-Z0-9_.:-]{1,160}$/;
var upstreamPattern = /^[a-zA-Z0-9_.:/-]{1,160}$/;
var id = validate.string().regex(idPattern);
var modelId = validate.string().regex(modelPattern);
var plainConfig = validate.object({
  crossChannel: validate.boolean(),
  channels: validate.array(validate.object({
    id,
    name: validate.string().trim().min(1).max(100),
    kind: validate.enum(["google", "openai"]),
    endpoint: validate.string().max(2048),
    enabled: validate.boolean(),
    failover: validate.boolean(),
    models: validate.array(validate.object({
      id: modelId,
      upstream: validate.string().regex(upstreamPattern),
      images: validate.boolean(),
      tools: validate.boolean(),
      reasoning: validate.boolean(),
      rpm: validate.number().int().min(1).max(1e6).optional(),
      contextWindow: validate.number().int().positive().max(1e8).optional(),
      maxTokens: validate.number().int().positive().max(1e8).optional()
    }).strict()).max(64),
    keys: validate.array(validate.object({
      id,
      label: validate.string().trim().min(1).max(100),
      enabled: validate.boolean(),
      revision: validate.number().int().positive(),
      group: validate.string().trim().max(80).regex(/^[^\u0000-\u001f\u007f]*$/)
    }).strict()).max(128)
  }).strict()).max(32)
}).strict();
var routeFor = (id2) => `model-key-pool-${id2}`;
var credentialId = (channel, key, revision) => `${channel}.${key}.${revision}`;
function normalizeEndpoint(kind, endpoint) {
  if (kind === "google") return googleEndpoint;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("\u8BF7\u586B\u5199\u6709\u6548\u7684\u517C\u5BB9\u6E20\u9053\u5730\u5740");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp || url.username || url.password || url.search || url.hash) {
    throw new Error("\u517C\u5BB9\u6E20\u9053\u4F7F\u7528 HTTPS \u6216\u672C\u673A HTTP \u5730\u5740\uFF0C\u8BF7\u53BB\u6389\u767B\u5F55\u4FE1\u606F\u3001\u67E5\u8BE2\u53C2\u6570\u548C\u7247\u6BB5");
  }
  return url.href.replace(/\/+$/, "");
}
function validUpstream(kind, model) {
  return (kind === "google" ? modelPattern : upstreamPattern).test(model);
}
function validateIds(entries) {
  if (new Set(entries.map((entry2) => entry2.id)).size !== entries.length) throw new Error("\u914D\u7F6E\u5305\u542B\u91CD\u590D\u7684 ID");
}
function validateConfig(input) {
  const parsed = plainConfig.safeParse(input);
  if (!parsed.success) throw new Error("\u6E20\u9053\u914D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u540D\u79F0\u3001\u6A21\u578B ID\u3001RPM \u548C\u914D\u989D\u7EC4");
  const config = parsed.data;
  validateIds(config.channels);
  const requestedCandidates = config.channels.reduce((count, channel) => count + channel.keys.length * channel.models.length, 0);
  if (requestedCandidates > policy.candidateCapacity) throw new Error("\u6E20\u9053\u3001\u6A21\u578B\u548C Key \u7EC4\u5408\u8D85\u8FC7\u5BC6\u94A5\u6C60\u5BB9\u91CF");
  for (const channel of config.channels) {
    channel.endpoint = normalizeEndpoint(channel.kind, channel.endpoint);
    if (channel.models.some((model) => !validUpstream(channel.kind, model.upstream))) {
      throw new Error("Google \u4E0A\u6E38\u6A21\u578B\u586B\u6A21\u578B ID\uFF0C\u4E0D\u542B models/ \u524D\u7F00");
    }
    validateIds(channel.models);
    validateIds(channel.keys);
    if (channel.models.some((model) => (model.maxTokens ?? policy.defaultMaxTokens) > (model.contextWindow ?? policy.defaultContextWindow))) throw new Error("\u6A21\u578B\u6700\u5927\u8F93\u51FA\u4E0D\u80FD\u8D85\u8FC7\u4E0A\u4E0B\u6587\u7A97\u53E3");
    const upstreamCapabilities = /* @__PURE__ */ new Map();
    for (const model of channel.models) {
      const capabilities = JSON.stringify([
        model.tools,
        model.images,
        model.reasoning,
        model.contextWindow ?? policy.defaultContextWindow,
        model.maxTokens ?? policy.defaultMaxTokens
      ]);
      const existing = upstreamCapabilities.get(model.upstream);
      if (existing && existing !== capabilities) throw new Error("\u6620\u5C04\u5230\u540C\u4E00\u4E0A\u6E38\u6A21\u578B\u7684\u80FD\u529B\u4E0E\u4E0A\u4E0B\u6587\u914D\u7F6E\u5FC5\u987B\u4E00\u81F4");
      upstreamCapabilities.set(model.upstream, capabilities);
    }
    if (channel.enabled && !channel.models.length) throw new Error("\u542F\u7528\u6E20\u9053\u524D\u8BF7\u6DFB\u52A0\u6A21\u578B");
  }
  return config;
}

// src/errors.ts
var object = (entry2) => entry2 && typeof entry2 === "object" ? entry2 : {};
var word = (entry2) => typeof entry2 === "string" && /^[a-z0-9_:-]{1,100}$/i.test(entry2) ? entry2 : void 0;
var text = (entry2) => typeof entry2 === "string" ? entry2 : "";
var pacificDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
function nextPacificMidnight(now) {
  const day = pacificDay.format(now);
  let low = Math.floor(now / 1e3);
  let high = low + 26 * 3600;
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2);
    if (pacificDay.format(middle * 1e3) === day) low = middle;
    else high = middle;
  }
  return high * 1e3;
}
function retryTime(header, details, now) {
  const seconds = Number(header);
  const headerTime = header && Number.isFinite(seconds) ? now + seconds * 1e3 : Date.parse(header ?? "");
  const delays = details.flatMap((detail) => {
    const duration = /^(\d+(?:\.\d+)?)s$/.exec(text(detail.retryDelay));
    return duration ? [now + Number(duration[1]) * 1e3] : [];
  });
  const candidates = [headerTime, ...delays].filter((until) => Number.isFinite(until) && until >= now && until <= 864e13);
  return Math.ceil(Math.max(now, ...candidates));
}
function googleDecision(failure, now, group2) {
  const err = object(object(failure.body).error);
  const details = Array.isArray(err.details) ? err.details.map(object) : [];
  const reasons = details.map((detail) => word(detail.reason));
  const code = reasons.find(Boolean) ?? word(err.status);
  const consumer = details.map((detail) => text(object(detail.metadata).consumer)).find((id2) => id2.startsWith("projects/"));
  const groupConflict = !!(consumer && /^\d+$/.test(group2) && consumer !== `projects/${group2}`);
  const evidence = { status: failure.status, code, ...groupConflict && { groupConflict } };
  const stop = { ...evidence, action: { type: "ignore" }, retry: "stop" };
  if (groupConflict) return stop;
  if (reasons.some((reason) => reason === "API_KEY_INVALID" || reason === "API_KEY_EXPIRED")) {
    return { ...evidence, action: { type: "revoke" }, retry: "next" };
  }
  if (failure.status === 403) {
    return { ...evidence, action: { type: "block", scope: "key-model", reason: "PERMISSION" }, retry: "next" };
  }
  if (failure.status !== 429) return stop;
  const violations = details.flatMap((detail) => Array.isArray(detail.violations) ? detail.violations.map(object) : []);
  const daily = violations.some((entry2) => /per.?day|daily|\brpd\b/i.test(text(entry2.quotaId) + " " + text(entry2.quotaMetric))) || /quota exceeded for the day/i.test(text(err.message));
  const scope = violations.some((entry2) => {
    const dims = object(entry2.quotaDimensions);
    return !!(dims.model || dims.model_id) || /per.?model|_model\b/i.test(text(entry2.quotaId) + " " + text(entry2.quotaMetric));
  }) || violations.length === 0 ? "group-model" : "group";
  const hintedUntil = retryTime(failure.retryAfter, details, now);
  if (daily) {
    return { ...evidence, action: {
      type: "block",
      scope,
      reason: "DAILY_QUOTA",
      until: Math.max(hintedUntil, nextPacificMidnight(now))
    }, retry: "next" };
  }
  const rateScope = failure.retryAfter && !violations.length ? "vendor" : scope;
  return { ...evidence, action: {
    type: "cooldown",
    scope: rateScope,
    reason: "RATE_LIMIT",
    until: hintedUntil > now ? hintedUntil : now + policy.cooldownMs
  }, retry: "next" };
}
function translate(kind, failure, now, group2) {
  if (failure.network) return { action: { type: "ignore" }, retry: "backoff" };
  if (kind === "google") {
    const decision = googleDecision(failure, now, group2);
    if (decision.retry === "stop" && (failure.status ?? 0) >= 500) return { ...decision, retry: "backoff" };
    return decision;
  }
  const err = object(object(failure.body).error);
  const code = word(err.code) ?? word(err.type);
  const evidence = { status: failure.status, code };
  if (failure.status === 401 && code === "invalid_api_key") {
    return { ...evidence, action: { type: "revoke" }, retry: "next" };
  }
  if (failure.status === 429 && code === "insufficient_quota") {
    return { ...evidence, action: { type: "block", scope: "group", reason: "BALANCE" }, retry: "next" };
  }
  if (failure.status === 429 && (code === "rate_limit_exceeded" || failure.retryAfter)) {
    const hintedUntil = retryTime(failure.retryAfter, [], now);
    return { ...evidence, action: {
      type: "cooldown",
      scope: failure.retryAfter ? "vendor" : "group-model",
      reason: "RATE_LIMIT",
      until: hintedUntil > now ? hintedUntil : now + policy.cooldownMs
    }, retry: "next" };
  }
  return { ...evidence, action: { type: "ignore" }, retry: (failure.status ?? 0) >= 500 ? "backoff" : "stop" };
}
function classify(kind, failure, now, group2) {
  const decision = translate(kind, failure, now, group2);
  const body = failure.body;
  const err = object(object(body).error);
  const message = text(err.message) || text(object(body).message) || text(body);
  const description = message.replace(/https?:\/\/[^\s"'<>]+/g, "[URL]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, policy.errorSummaryChars);
  return { ...decision, ...description && { description } };
}

// src/scheduler.ts
var PoolError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var encoded = (...parts) => JSON.stringify(parts);
var identity = ({ channel, key }) => encoded(channel.id, key.id, key.revision);
var vendor = (channel) => channel.kind === "google" ? "google" : new URL(channel.endpoint).origin;
var group = ({ key }) => key.group || "\u672A\u786E\u8BA4";
function scopeKey(candidate, scope) {
  const { channel, model } = candidate;
  switch (scope) {
    case "key":
      return encoded(scope, identity(candidate));
    case "key-model":
      return encoded(scope, identity(candidate), model.upstream);
    case "group":
      return encoded(scope, vendor(channel), group(candidate));
    case "group-model":
      return encoded(scope, vendor(channel), group(candidate), model.upstream);
    case "vendor":
      return encoded(scope, vendor(channel));
  }
}
var scopes = ["key", "key-model", "group-model", "group", "vendor"];
var closeCode = () => new PoolError("POOL_CLOSED", "\u6A21\u578B\u5BC6\u94A5\u6C60\u5DF2\u5173\u95ED");
var timedOut = () => new PoolError("QUEUE_TIMEOUT", "\u7B49\u5F85\u53EF\u7528\u53D1\u9001\u540D\u989D\u8D85\u65F6");
var Scheduler = class {
  config = { channels: [], crossChannel: false };
  revision = 0;
  health = /* @__PURE__ */ new Map();
  recent = /* @__PURE__ */ new Map();
  verified = /* @__PURE__ */ new Set();
  pools = /* @__PURE__ */ new Map();
  gates = /* @__PURE__ */ new Map();
  modelRpm = /* @__PURE__ */ new Map();
  waiting = [];
  accounted = /* @__PURE__ */ new WeakMap();
  interval;
  closed = false;
  readyAt = Date.now() + policy.startupQuietMs;
  onCheckpoint;
  configure(config) {
    this.config = config;
    this.revision++;
    const candidates = this.allCandidates();
    const livePools = new Set(candidates.map((candidate) => this.poolId(candidate.channel, candidate.model.id)));
    for (const pool of this.pools.keys()) if (!livePools.has(pool)) this.pools.delete(pool);
    this.modelRpm.clear();
    const active = new Set(candidates.flatMap((candidate) => scopes.map((scope) => scopeKey(candidate, scope))));
    for (const candidate of candidates) {
      if (!candidate.channel.enabled || !candidate.key.enabled) continue;
      const id2 = scopeKey(candidate, "group-model");
      const rpm = candidate.model.rpm ?? policy.fallbackRpm;
      this.modelRpm.set(id2, Math.min(this.modelRpm.get(id2) ?? policy.hardRpm, rpm));
    }
    this.pruneGates();
    for (const collection of [this.health, this.recent, this.verified]) {
      for (const key of collection.keys()) if (!active.has(key)) collection.delete(key);
    }
    this.pump();
  }
  allCandidates() {
    return this.config.channels.flatMap((channel) => channel.models.flatMap((model) => channel.keys.map((key) => ({ channel, model, key }))));
  }
  status(candidate, now = Date.now()) {
    const records = scopes.flatMap((scope) => {
      const record = this.health.get(scopeKey(candidate, scope));
      return record && (record.until === void 0 || record.until > now) ? [record] : [];
    });
    return records.sort((a, b) => (b.until ?? Infinity) - (a.until ?? Infinity))[0];
  }
  report(selection, decision, success = false) {
    if (!this.accounted.has(selection)) return;
    const sentAt = this.accounted.get(selection);
    this.accounted.delete(selection);
    const candidate = selection.candidate;
    const currentChannel = this.config.channels.find((channel) => channel.id === candidate.channel.id);
    const currentKey = currentChannel?.keys.find((key2) => key2.id === candidate.key.id);
    const currentModel = currentChannel?.models.find((model) => model.id === candidate.model.id);
    if (currentKey?.revision !== candidate.key.revision || currentKey.group !== candidate.key.group || currentModel?.upstream !== candidate.model.upstream || currentChannel?.endpoint !== candidate.channel.endpoint || currentChannel.kind !== candidate.channel.kind) return;
    const modelScope = scopeKey(candidate, "key-model");
    if (success) {
      this.verified.add(modelScope);
      return;
    }
    this.recent.set(modelScope, {
      at: Date.now(),
      status: decision.status,
      code: decision.code,
      description: decision.description,
      groupConflict: decision.groupConflict
    });
    const action = decision.action;
    if (action.type === "ignore") return;
    const key = scopeKey(candidate, action.type === "revoke" ? "key" : action.scope);
    const record = {
      reason: action.type === "revoke" ? "INVALID_KEY" : action.reason,
      until: action.type === "revoke" ? void 0 : action.until,
      status: decision.status,
      code: decision.code
    };
    const previous = this.health.get(key);
    if (previous && (previous.until === void 0 || record.until !== void 0 && (previous.until >= record.until || record.reason === "RATE_LIMIT" && previous.until > sentAt))) return;
    this.health.set(key, record);
    if (record.reason !== "RATE_LIMIT") this.onCheckpoint?.();
    this.pump();
  }
  recover(candidate) {
    for (const scope of scopes) {
      const key = scopeKey(candidate, scope);
      this.health.delete(key);
    }
    this.onCheckpoint?.();
    this.pump();
  }
  snapshot() {
    return this.allCandidates().map((candidate) => {
      const modelScope = scopeKey(candidate, "key-model");
      const active = this.pools.get(this.poolId(candidate.channel, candidate.model.id));
      return {
        channelId: candidate.channel.id,
        keyId: candidate.key.id,
        modelId: candidate.model.id,
        health: this.status(candidate),
        last: this.recent.get(modelScope),
        verified: this.verified.has(modelScope),
        current: active?.identity === identity(candidate) && !this.status(candidate),
        rpm: this.gateSpecs(candidate).reduce((min, spec) => Math.min(min, spec.rpm), policy.hardRpm)
      };
    });
  }
  poolId(channel, model) {
    return encoded(this.config.crossChannel && channel.failover ? "shared" : channel.id, model);
  }
  candidates(request) {
    const home = this.config.channels.find((channel) => channel.id === request.channelId && channel.enabled);
    if (!home) throw new PoolError("POOL_CONFIG_CHANGED", "\u6E20\u9053\u5DF2\u505C\u7528\u6216\u914D\u7F6E\u5DF2\u66F4\u6539");
    const channels = [home, ...this.config.channels.filter((channel) => this.config.crossChannel && home.failover && channel !== home && channel.enabled && channel.failover)];
    const candidates = channels.flatMap((channel) => channel.models.filter((model) => model.id === request.modelId && (!request.images || model.images) && (!request.tools || model.tools) && (!request.reasoning || model.reasoning) && (model.contextWindow ?? policy.defaultContextWindow) >= (request.contextWindow ?? 0) && (model.maxTokens ?? policy.defaultMaxTokens) >= (request.maxTokens ?? 0)).flatMap((model) => channel.keys.filter((key) => key.enabled).map((key) => ({ channel, model, key }))));
    return { pool: this.poolId(home, request.modelId), candidates };
  }
  gateSpecs(candidate) {
    const { model } = candidate;
    const groupModel = scopeKey(candidate, "group-model");
    const sharedRpm = this.modelRpm.get(groupModel) ?? model.rpm ?? policy.fallbackRpm;
    return [
      { id: "global", rpm: policy.hardRpm, max: policy.concurrency },
      { id: scopeKey(candidate, "vendor"), rpm: policy.vendorRpm, max: policy.vendorConcurrency },
      { id: scopeKey(candidate, "group"), rpm: policy.hardRpm, max: policy.groupConcurrency },
      { id: groupModel, rpm: sharedRpm, max: policy.groupConcurrency }
    ];
  }
  availableGates(candidate, now) {
    if (now < this.readyAt) return void 0;
    const specs = this.gateSpecs(candidate);
    const gates = specs.map(({ id: id2 }) => {
      let gate = this.gates.get(id2);
      if (!gate) this.gates.set(id2, gate = { timestamps: [], inFlight: 0, reservedAt: 0, lastSent: 0 });
      while (gate.timestamps[0] <= now - 6e4) gate.timestamps.shift();
      return gate;
    });
    return gates.every((gate, index) => gate.inFlight < specs[index].max && gate.timestamps.length < specs[index].rpm && now >= Math.max(gate.reservedAt, gate.lastSent) + policy.spacingMs) ? gates : void 0;
  }
  pruneGates() {
    const threshold = Date.now() - 6e4;
    for (const [id2, gate] of this.gates) {
      if (!gate.inFlight && Math.max(gate.lastSent, gate.reservedAt) <= threshold) this.gates.delete(id2);
    }
  }
  take(request, queuedMs) {
    request.signal.throwIfAborted();
    const now = Date.now();
    const { pool, candidates } = this.candidates(request);
    const current = this.pools.get(pool);
    const active = candidates.find((candidate2) => identity(candidate2) === current?.identity && !this.status(candidate2, now));
    const ordered = active ? [active] : candidates.filter((candidate2) => !this.status(candidate2, now));
    const candidate = ordered[0];
    if (!candidate) {
      const held = candidates.map((entry2) => this.status(entry2, now));
      const deadlines = held.flatMap((record) => record?.until ? [record.until] : []);
      const reason = held.find(Boolean)?.reason;
      const reset = deadlines.length ? `\uFF0C\u6700\u65E9\u6062\u590D ${new Date(Math.min(...deadlines)).toISOString()}` : "";
      throw new PoolError("POOL_UNAVAILABLE", `\u6CA1\u6709\u53EF\u7528 Key${reason ? `\uFF08${reason}\uFF09` : ""}${reset}`);
    }
    const gates = this.availableGates(candidate, now);
    if (!gates) return void 0;
    const nextIdentity = identity(candidate);
    const epoch = current?.identity === nextIdentity ? current.epoch : (current?.epoch ?? 0) + 1;
    this.pools.set(pool, { identity: nextIdentity, epoch });
    for (const gate of gates) {
      gate.inFlight++;
      gate.reservedAt = now;
    }
    const selection = { candidate, pool, epoch, revision: this.revision };
    let released = false;
    return {
      selection,
      queuedMs,
      authorize: () => {
        request.signal.throwIfAborted();
        if (this.closed || released || this.accounted.has(selection)) throw closeCode();
        const active2 = this.pools.get(pool);
        if (selection.revision !== this.revision || active2?.epoch !== epoch || this.status(candidate)) {
          throw new PoolError("POOL_STALE_SELECTION", "\u53D1\u9001\u524D\u6A21\u578B\u5BC6\u94A5\u6C60\u5DF2\u5207\u6362");
        }
        const sentAt = Date.now();
        const specs = this.gateSpecs(candidate);
        if (gates.some((gate, index) => sentAt < gate.lastSent + policy.spacingMs || gate.timestamps.filter((time) => time > sentAt - 6e4).length >= specs[index].rpm)) {
          throw new PoolError("POOL_STALE_SELECTION", "\u53D1\u9001\u524D\u9650\u6D41\u7A97\u53E3\u5DF2\u53D8\u5316");
        }
        for (const gate of gates) {
          gate.lastSent = sentAt;
          gate.timestamps.push(sentAt);
        }
        this.accounted.set(selection, sentAt);
      },
      release: () => {
        if (released) return;
        released = true;
        for (const gate of gates) gate.inFlight--;
        this.pump();
      }
    };
  }
  acquire(request) {
    if (this.closed) return Promise.reject(closeCode());
    if (this.waiting.length >= policy.queueCapacity) return Promise.reject(new PoolError("QUEUE_FULL", "\u6A21\u578B\u8BF7\u6C42\u961F\u5217\u5DF2\u6EE1"));
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const index = this.waiting.indexOf(waiting);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        waiting.finish();
        reject(request.signal.reason);
        this.pump();
      };
      const deadline = setTimeout(() => {
        const index = this.waiting.indexOf(waiting);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        waiting.finish();
        reject(timedOut());
        this.pump();
      }, Math.max(0, request.queueMs));
      const waiting = {
        request,
        resolve,
        reject,
        started: performance.now(),
        finish: () => {
          clearTimeout(deadline);
          request.signal.removeEventListener("abort", cancel);
        }
      };
      this.waiting.push(waiting);
      request.signal.addEventListener("abort", cancel, { once: true });
      this.pump();
    });
  }
  pump() {
    const blocked = /* @__PURE__ */ new Set();
    for (const waiting of [...this.waiting]) {
      const { request } = waiting;
      const elapsed = performance.now() - waiting.started;
      try {
        request.signal.throwIfAborted();
        if (this.closed) throw closeCode();
        if (elapsed >= request.queueMs) throw timedOut();
        const home = this.config.channels.find((channel) => channel.id === request.channelId);
        const pool = home && this.poolId(home, request.modelId);
        if (pool && blocked.has(pool)) continue;
        const lease = this.take(request, elapsed);
        if (!lease) {
          if (pool) blocked.add(pool);
          continue;
        }
        waiting.resolve(lease);
      } catch (error) {
        waiting.reject(error);
      }
      this.waiting.splice(this.waiting.indexOf(waiting), 1);
      waiting.finish();
    }
    if (this.waiting.length === 0) {
      clearInterval(this.interval);
      this.interval = void 0;
    } else if (!this.interval) {
      this.interval = setInterval(() => this.pump(), policy.queuePollMs);
    }
  }
  close() {
    this.closed = true;
    this.pump();
  }
};

// src/adapter.ts
var noHostRetry = resolveRetryPolicy({ mode: "normal", maxRetries: 0 }, "model-key-pool");
var noAmbientAuth = {
  credentials: {
    read: async () => void 0,
    list: async () => [],
    modify: async () => void 0,
    delete: async () => {
    }
  },
  authContext: { env: async () => void 0, fileExists: async () => false }
};
function piProfile(channel, bridge) {
  const provider = routeFor(channel.id);
  const isGoogle = channel.kind === "google";
  const baseUrl = isGoogle ? bridge.url + "/v1beta" : channel.endpoint;
  const api = isGoogle ? "google-generative-ai" : "openai-completions";
  const protocol = isGoogle ? googleGenerativeAIApi() : compatibleTransport(bridge);
  const models = /* @__PURE__ */ new Map();
  for (const model of channel.models) {
    models.set(model.upstream, {
      id: model.upstream,
      provider,
      name: model.id,
      api,
      baseUrl,
      reasoning: model.reasoning,
      input: model.images ? ["text", "image"] : ["text"],
      contextWindow: model.contextWindow ?? policy.defaultContextWindow,
      maxTokens: model.maxTokens ?? policy.defaultMaxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    });
  }
  const piProvider = {
    id: provider,
    name: channel.name,
    baseUrl,
    auth: { apiKey: { name: channel.name, resolve: async ({ credential }) => ({
      auth: credential?.key ? { apiKey: credential.key } : {},
      source: channel.name
    }) } },
    getModels: () => [...models.values()],
    ...protocol
  };
  return {
    provider,
    displayName: channel.name,
    retryPolicy: noHostRetry,
    piProvider,
    streamIdleTimeoutMs: policy.streamIdleMs,
    maxRequestImageBytes: policy.requestImageBytes,
    requestImagePixelBudget: policy.imagePixels,
    requestImageMaxBytes: policy.imageBytes,
    modelErrors: /* @__PURE__ */ new Map(),
    configuredMaxTokens: new Map(channel.models.flatMap((model) => model.maxTokens ? [[model.upstream, model.maxTokens]] : []))
  };
}
function compatibleTransport(bridge) {
  const protocol = openAICompletionsApi();
  const localFetch = (_url, options) => fetch(bridge.url + "/v1/chat/completions", options);
  return {
    stream: (model, context, options) => protocol.stream(model, context, { ...options, fetch: localFetch }),
    streamSimple: (model, context, options) => protocol.streamSimple(model, context, { ...options, fetch: localFetch })
  };
}
var meaningful = (chunk) => {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text.length > 0;
    case "tool-call-delta":
      return true;
    case "block-end":
      return chunk.block.type !== "text" && chunk.block.type !== "reasoning" || chunk.block.text.length > 0;
    default:
      return false;
  }
};
var PoolAdapter = class extends LlmAdapter {
  dependencies;
  tickets = new AsyncLocalStorage();
  inner;
  profiles = /* @__PURE__ */ new Map();
  constructor(dependencies) {
    super();
    this.dependencies = dependencies;
    this.inner = new PiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: async () => this.tickets.getStore(),
      auth: noAmbientAuth,
      resolveAttachments: dependencies.attachments,
      resolveImageAccess: dependencies.imageAccess
    });
  }
  configure(channels) {
    this.profiles = new Map(channels.map((channel) => [routeFor(channel.id), piProfile(channel, this.dependencies.bridge)]));
  }
  channelFor(provider) {
    const channel = this.dependencies.scheduler.config.channels.find((entry2) => routeFor(entry2.id) === provider && entry2.enabled);
    if (!channel) throw new LlmError("\u6A21\u578B\u5BC6\u94A5\u6C60\u6E20\u9053\u5DF2\u505C\u7528", "POOL_CONFIG_CHANGED");
    return channel;
  }
  providerInfo(provider) {
    return { id: provider, name: this.channelFor(provider).name };
  }
  providerRetryPolicy() {
    return noHostRetry;
  }
  async listModels(provider) {
    return this.channelFor(provider).models.map((model) => ({
      provider,
      id: model.id,
      name: model.id,
      inputModalities: model.images ? ["text", "image"] : ["text"]
    }));
  }
  async resolveModel(provider, modelId2, signal) {
    const model = this.channelFor(provider).models.find((entry2) => entry2.id === modelId2);
    if (!model) throw new LlmError("\u8BE5\u6E20\u9053\u672A\u914D\u7F6E\u6B64\u6A21\u578B", "UNKNOWN_MODEL");
    const info = await this.inner.resolveModel(provider, model.upstream, signal);
    return { ...info, id: modelId2, name: modelId2 };
  }
  async prepareCall(provider, modelId2, signal) {
    const revision = this.dependencies.scheduler.revision;
    const model = await this.resolveModel(provider, modelId2, signal);
    return {
      model,
      stream: (options) => {
        if (revision !== this.dependencies.scheduler.revision) {
          throw new LlmError("\u6A21\u578B\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001", "POOL_CONFIG_CHANGED");
        }
        return this.stream(options, revision);
      }
    };
  }
  imageRequestTarget(provider, model, image) {
    const mapped = this.channelFor(provider).models.find((entry2) => entry2.id === model);
    return mapped ? this.inner.imageRequestTarget(provider, mapped.upstream, image) : super.imageRequestTarget(provider, model, image);
  }
  async *stream(options, preparedRevision = this.dependencies.scheduler.revision) {
    const { bridge, scheduler, lifecycle, secret, endpoint } = this.dependencies;
    const requestSignal = options.signal ? AbortSignal.any([options.signal, lifecycle]) : lifecycle;
    const home = this.channelFor(options.provider);
    const homeModel = home.models.find((model) => model.id === options.model);
    if (!homeModel) throw new LlmError("\u8BE5\u6E20\u9053\u672A\u914D\u7F6E\u6B64\u6A21\u578B", "UNKNOWN_MODEL");
    const request = {
      channelId: home.id,
      modelId: options.model,
      signal: requestSignal,
      images: options.messages.some((message) => contentHasImage(message.content)),
      tools: !!options.tools?.length,
      reasoning: !!options.reasoningEffort && options.reasoningEffort !== "off",
      contextWindow: homeModel.contextWindow ?? policy.defaultContextWindow,
      maxTokens: options.maxTokens ?? homeModel.maxTokens ?? policy.defaultMaxTokens
    };
    let queueMs = policy.queueMs;
    let lastFailure;
    for (let attempt = 1; attempt <= policy.attempts; attempt++) {
      if (requestSignal.aborted) throw new LlmError("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "ABORTED");
      if (preparedRevision !== scheduler.revision) throw new LlmError("\u6A21\u578B\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001", "POOL_CONFIG_CHANGED");
      let lease;
      try {
        lease = await scheduler.acquire({ ...request, queueMs });
      } catch (error) {
        if (requestSignal.aborted) throw new LlmError("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "ABORTED");
        if (error instanceof PoolError) throw new LlmError(error.message, error.code);
        throw error;
      }
      queueMs -= lease.queuedMs;
      const { channel, key, model } = lease.selection.candidate;
      const output = [];
      let started = false;
      let retry = "stop";
      let ticket;
      try {
        const apiKey = await secret(channel.id, key.id, key.revision);
        if (!apiKey) {
          lease.authorize();
          scheduler.report(lease.selection, { action: { type: "revoke" }, retry: "next", code: "MISSING_CREDENTIAL" });
          retry = "next";
          lastFailure = errorFinish("MISSING_CREDENTIAL", "\u5BC6\u94A5\u6C60\u672A\u627E\u5230\u5DF2\u4FDD\u5B58\u7684\u51ED\u8BC1");
        } else {
          ticket = bridge.ticket({
            kind: channel.kind,
            endpoint: endpoint?.(channel) ?? channel.endpoint,
            model: model.upstream,
            secret: apiKey,
            signal: requestSignal,
            authorize: lease.authorize
          });
          const wire = this.inner.stream({
            ...options,
            provider: routeFor(channel.id),
            model: model.upstream,
            signal: requestSignal
          })[Symbol.asyncIterator]();
          let settled = false;
          try {
            while (true) {
              const next = await this.tickets.run(ticket.token, () => wire.next());
              if (next.done) break;
              const chunk = next.value;
              if (chunk.type === "finish") {
                settled = true;
                if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") {
                  if (requestSignal.aborted) throw new LlmError("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "ABORTED");
                  const decision = ticket.failure && classify(channel.kind, ticket.failure, Date.now(), key.group);
                  if (decision) scheduler.report(lease.selection, decision);
                  retry = ticket.localError instanceof PoolError && ticket.localError.code === "POOL_STALE_SELECTION" ? "next" : decision?.retry ?? "stop";
                  const code = decision?.code ?? chunk.reason.failure.code;
                  const status = decision?.status;
                  const detail = decision?.groupConflict ? "\uFF08\u4E0A\u6E38\u9879\u76EE\u4E0E\u914D\u7F6E\u4E0D\u4E00\u81F4\uFF09" : "";
                  const baseMessage = status ? `\u4E0A\u6E38 HTTP ${status} \xB7 ${code}${detail}` : `\u6A21\u578B\u8BF7\u6C42\u5931\u8D25 \xB7 ${code}`;
                  lastFailure = errorFinish(code, started ? `${baseMessage}\u3002\u56DE\u590D\u4E2D\u9014\u622A\u65AD\uFF0C\u672A\u81EA\u52A8\u6362 Key \u91CD\u8BD5\u3002` : baseMessage, status);
                  break;
                }
                scheduler.report(lease.selection, { action: { type: "ignore" }, retry: "stop" }, true);
                for (const pending of output) yield pending;
                yield chunk;
                return;
              }
              if (started) yield chunk;
              else if (meaningful(chunk)) {
                started = true;
                for (const pending of output.splice(0)) yield pending;
                yield chunk;
              } else if (output.length < policy.streamPreambleChunks) output.push(chunk);
              else throw new LlmError("\u6A21\u578B\u8FD4\u56DE\u4E86\u8FC7\u591A\u7A7A\u5757", "POOL_INVALID_STREAM");
            }
            if (!settled) lastFailure = errorFinish("STREAM_CLOSED", started ? "\u56DE\u590D\u4E2D\u9014\u622A\u65AD\uFF0C\u672A\u81EA\u52A8\u6362 Key \u91CD\u8BD5\u3002" : "\u6A21\u578B\u6D41\u5DF2\u5173\u95ED");
          } finally {
            await wire.return?.();
          }
        }
      } catch (error) {
        if (requestSignal.aborted) throw new LlmError("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "ABORTED");
        if (started) {
          yield errorFinish("STREAM_CLOSED", "\u56DE\u590D\u4E2D\u9014\u622A\u65AD\uFF0C\u672A\u81EA\u52A8\u6362 Key \u91CD\u8BD5\u3002");
          return;
        }
        if (error instanceof PoolError && error.code === "POOL_STALE_SELECTION") retry = "next";
        else if (ticket?.failure?.network) retry = "backoff";
        else {
          const code = error instanceof LlmError || error instanceof PoolError ? error.code : "POOL_REQUEST_FAILED";
          lastFailure = errorFinish(code ?? "POOL_REQUEST_FAILED", "\u5BC6\u94A5\u6C60\u65E0\u6CD5\u5B8C\u6210\u6A21\u578B\u8BF7\u6C42");
        }
      } finally {
        ticket?.close();
        lease.release();
      }
      if (started || retry === "stop" || attempt >= policy.attempts) {
        yield lastFailure ?? errorFinish("POOL_REQUEST_FAILED", "\u5BC6\u94A5\u6C60\u65E0\u6CD5\u5B8C\u6210\u6A21\u578B\u8BF7\u6C42");
        return;
      }
      if (retry === "backoff") {
        const jitter = 1 + (Math.random() * 2 - 1) * policy.backoffJitter;
        const backoff = policy.backoffMs * 2 ** (attempt - 1) * jitter;
        try {
          await delay(backoff, void 0, { signal: requestSignal });
        } catch {
          throw new LlmError("\u8BF7\u6C42\u5DF2\u53D6\u6D88", "ABORTED");
        }
      }
    }
  }
};
function errorFinish(code, message, status) {
  return { type: "finish", reason: { kind: "error", failure: { code, message, status } } };
}

// src/bridge.ts
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { attributionHeaders } from "@deepseek-ai/dsh-llm";
function validRequest(req, destination) {
  const path = (req.url ?? "").split("?")[0];
  if (req.method !== "POST") return false;
  if (destination.kind === "openai") return path === "/v1/chat/completions";
  return path === `/v1beta/models/${destination.model}:streamGenerateContent`;
}
async function readBoundedBody(response, limit) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value.subarray(0, limit - bytes), { stream: true });
      bytes += chunk.value.length;
      if (bytes >= limit) break;
    }
    body += decoder.decode();
  } finally {
    if (reader) void reader.cancel().catch(() => {
    });
  }
  return body;
}
async function readFailure(response, secret) {
  const retryAfter = response.headers.get("retry-after") ?? void 0;
  const body = await readBoundedBody(response, policy.errorBytes);
  const redact = (text2) => text2.replaceAll(secret, "[REDACTED]").replace(/AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+[^\s"']+/g, "[REDACTED]");
  try {
    const decoded = JSON.parse(body, (_, value) => typeof value === "string" ? redact(value) : value);
    return { status: response.status, retryAfter, body: decoded };
  } catch {
    return { status: response.status, retryAfter, body: redact(body) };
  }
}
async function forward(req, res, target, ticket) {
  const client = new AbortController();
  res.once("close", () => client.abort());
  const signal = AbortSignal.any([target.signal, client.signal]);
  const suffix = target.kind === "google" ? `/models/${target.model}:streamGenerateContent?alt=sse` : "/chat/completions";
  const headers = new Headers({ "content-type": "application/json", accept: "text/event-stream" });
  for (const [name2, header] of Object.entries(attributionHeaders())) headers.set(name2, header);
  if (target.kind === "google") headers.set("x-goog-api-key", target.secret);
  else headers.set("authorization", `Bearer ${target.secret}`);
  try {
    target.authorize?.();
  } catch (error) {
    ticket.localError = error;
    res.writeHead(503).end();
    return;
  }
  try {
    const response = await fetch(target.endpoint + suffix, {
      method: "POST",
      headers,
      body: Readable.toWeb(req),
      signal,
      redirect: "error",
      duplex: "half"
    });
    if (!response.ok) {
      ticket.failure = { status: response.status, retryAfter: response.headers.get("retry-after") ?? void 0 };
      ticket.failure = await readFailure(response, target.secret);
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Upstream HTTP ${response.status}` } }));
      return;
    }
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "text/event-stream" });
    if (response.body) await pipeline(response.body, res, { signal });
    else res.end();
  } catch {
    if (!signal.aborted && !ticket.failure) ticket.failure = { network: true };
    if (res.headersSent) res.destroy();
    else res.writeHead(502).end();
  }
}
async function createBridge() {
  const pending = /* @__PURE__ */ new Map();
  const server = createServer((req, res) => {
    const token = req.headers["x-goog-api-key"] ?? req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const entry2 = typeof token === "string" ? pending.get(token) : void 0;
    if (!entry2 || !validRequest(req, entry2.target)) {
      res.writeHead(404).end();
      return;
    }
    entry2.ticket.close();
    void forward(req, res, entry2.target, entry2.ticket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("\u65E0\u6CD5\u542F\u52A8\u6A21\u578B\u5BC6\u94A5\u6C60\u7684\u672C\u5730\u8BF7\u6C42\u6865");
  return {
    url: `http://127.0.0.1:${address.port}`,
    ticket(target) {
      target.signal.throwIfAborted();
      const token = randomBytes(32).toString("hex");
      const close = () => {
        pending.delete(token);
        target.signal.removeEventListener("abort", close);
      };
      const ticket = { token, close };
      pending.set(token, { target, ticket });
      target.signal.addEventListener("abort", close, { once: true });
      return ticket;
    },
    close() {
      for (const entry2 of pending.values()) entry2.ticket.close();
      server.close();
      server.closeAllConnections();
    }
  };
}

// src/checkpoints.ts
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { z as z2 } from "zod";
var entry = z2.object({
  reason: z2.enum(["DAILY_QUOTA", "BALANCE", "INVALID_KEY", "PERMISSION"]),
  until: z2.number().int().positive().max(864e13).optional(),
  status: z2.number().int().min(100).max(599).optional(),
  code: z2.string().regex(/^[a-z0-9_:-]{1,100}$/i).optional()
}).strict();
var schema = z2.object({ version: z2.literal(1), health: z2.array(z2.tuple([z2.string().max(800), entry])) }).strict();
var Checkpoints = class {
  issue;
  blocked = false;
  pending = Promise.resolve();
  changed = false;
  writing = false;
  path;
  scheduler;
  constructor(path, scheduler) {
    this.path = path;
    this.scheduler = scheduler;
  }
  async load() {
    try {
      if ((await stat(this.path)).size > policy.checkpointBytes) throw new Error("oversized checkpoint");
      const snapshot = schema.parse(JSON.parse(await readFile(this.path, "utf8")));
      for (const [id2, record] of snapshot.health) {
        if (!record.until || record.until > Date.now()) this.scheduler.health.set(id2, record);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      this.blocked = true;
      this.issue = "\u5065\u5EB7\u68C0\u67E5\u70B9\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u5DF2\u6682\u505C\u53D1\u9001\u3002\u786E\u8BA4\u540E\u53EF\u91CD\u5EFA\u5065\u5EB7\u8BB0\u5F55\u3002";
    }
  }
  save() {
    this.changed = true;
    if (this.writing) return this.pending;
    this.writing = true;
    this.pending = this.flush();
    return this.pending;
  }
  async close() {
    await this.pending;
    if (this.issue && !this.blocked) await this.save();
  }
  async flush() {
    try {
      while (this.changed) {
        this.changed = false;
        const health = [...this.scheduler.health].filter(([, record]) => record.reason !== "RATE_LIMIT" && (!record.until || record.until > Date.now()));
        const document = JSON.stringify({ version: 1, health });
        if (Buffer.byteLength(document) > policy.checkpointBytes) throw new Error("oversized checkpoint");
        await writeFileAtomic(this.path, document, { mode: 384, dirMode: 448 });
        this.issue = void 0;
        this.blocked = false;
      }
    } catch {
      this.issue = "\u5065\u5EB7\u68C0\u67E5\u70B9\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 DSH profile \u76EE\u5F55\u6743\u9650\u3002";
    } finally {
      this.writing = false;
    }
  }
};
async function claimProfile(path) {
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  let unlock;
  const lifetime = new Promise((resolve) => {
    unlock = resolve;
  });
  let entered;
  let refused;
  const acquired = new Promise((resolve, reject) => {
    entered = resolve;
    refused = reject;
  });
  const lock = withFileLock(path, async () => {
    entered();
    await lifetime;
  }, { waitMs: policy.instanceLockWaitMs });
  void lock.catch(refused);
  try {
    await acquired;
  } catch {
    throw new Error("\u6B64 DSH profile \u5DF2\u6709\u4E00\u4E2A\u6A21\u578B\u5BC6\u94A5\u6C60\u5B9E\u4F8B\uFF0C\u6216\u63D2\u4EF6\u6570\u636E\u76EE\u5F55\u4E0D\u53EF\u5199");
  }
  return async () => {
    unlock();
    await lock;
  };
}

// src/diagnostics.ts
import { attributionHeaders as attributionHeaders2 } from "@deepseek-ai/dsh-llm";
import { setTimeout as delay2 } from "node:timers/promises";
import { z as z3 } from "zod";
var geminiCatalog = z3.object({
  models: z3.array(z3.object({ name: z3.string(), supportedGenerationMethods: z3.array(z3.string()).optional() })).default([]),
  nextPageToken: z3.string().max(2048).optional()
});
var openaiCatalog = z3.object({ data: z3.array(z3.object({ id: z3.string() })) });
var KeyDiagnostics = class {
  running = false;
  lastSent = -Infinity;
  async run(request) {
    if (this.running) throw new Error("\u5DF2\u6709 Key \u6B63\u5728\u6D4B\u8BD5\u6216\u83B7\u53D6\u6A21\u578B\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    this.running = true;
    const started = performance.now();
    const signal = AbortSignal.timeout(policy.diagnosticTimeoutMs);
    const { kind, endpoint, secret, model } = request;
    let status;
    const headers = new Headers(attributionHeaders2());
    headers.set(kind === "google" ? "x-goog-api-key" : "Authorization", kind === "google" ? secret : `Bearer ${secret}`);
    const send = async (suffix, payload) => {
      const remaining = this.lastSent + policy.diagnosticIntervalMs - performance.now();
      if (remaining > 0) await delay2(remaining, void 0, { signal });
      this.lastSent = performance.now();
      const response = await fetch(endpoint + suffix, {
        headers,
        signal,
        redirect: "error",
        ...payload && { method: "POST", body: JSON.stringify(payload) }
      });
      status = response.status;
      return response;
    };
    const result = (ok, message, status2) => ({ ok, message, status: status2, elapsedMs: Math.round(performance.now() - started) });
    const failed = async (response) => {
      const failure = await readFailure(response, secret);
      const { code, description } = classify(kind, failure, Date.now(), "");
      return result(false, description || code || "\u4E0A\u6E38\u62D2\u7EDD\u8BF7\u6C42", response.status);
    };
    try {
      if (model) {
        headers.set("Content-Type", "application/json");
        const limit = new URL(endpoint).hostname === "api.openai.com" ? { max_completion_tokens: 16 } : { max_tokens: 16 };
        const response = kind === "google" ? await send(
          `/models/${encodeURIComponent(model)}:generateContent`,
          { contents: [{ parts: [{ text: "Reply OK." }] }], generationConfig: { maxOutputTokens: 16 } }
        ) : await send(
          "/chat/completions",
          { model, messages: [{ role: "user", content: "Reply OK." }], ...limit }
        );
        if (!response.ok) return await failed(response);
        const body = JSON.parse(await readBoundedBody(response, policy.catalogBytes));
        if (body?.error) return result(false, "\u4E0A\u6E38\u8FD4\u56DE\u4E86\u751F\u6210\u9519\u8BEF", response.status);
        const generated = kind === "google" ? body?.candidates : body?.choices;
        return Array.isArray(generated) && generated.length ? result(true, "\u8FDE\u901A", response.status) : result(false, "\u4E0A\u6E38\u672A\u8FD4\u56DE\u751F\u6210\u7ED3\u679C", response.status);
      }
      const ids = /* @__PURE__ */ new Set();
      let token;
      for (let page = 0; page < policy.catalogPages; page++) {
        const response = await send("/models" + (token ? `?pageToken=${encodeURIComponent(token)}` : ""));
        if (!response.ok) return await failed(response);
        const body = JSON.parse(await readBoundedBody(response, policy.catalogBytes));
        if (body?.error) return result(false, "\u4E0A\u6E38\u8FD4\u56DE\u4E86\u6A21\u578B\u76EE\u5F55\u9519\u8BEF", status);
        if (kind === "google") {
          const catalog = geminiCatalog.parse(body);
          for (const entry2 of catalog.models) {
            if (entry2.name.startsWith("models/") && entry2.supportedGenerationMethods?.includes("generateContent")) {
              ids.add(entry2.name.slice("models/".length));
            }
          }
          token = catalog.nextPageToken;
        } else {
          for (const entry2 of openaiCatalog.parse(body).data) ids.add(entry2.id);
        }
        if (!token) break;
      }
      const models = [...ids].filter((id2) => !id2.includes(secret) && validUpstream(kind, id2)).sort();
      return { ...result(true, `\u83B7\u53D6\u5230 ${models.length} \u4E2A\u6A21\u578B`, status), models, partial: !!token };
    } catch (error) {
      if (signal.aborted) return result(false, "\u8BF7\u6C42\u8D85\u65F6", status);
      if (error instanceof SyntaxError || error instanceof z3.ZodError) return result(false, "\u4E0A\u6E38\u8FD4\u56DE\u7684\u6570\u636E\u683C\u5F0F\u4E0D\u53D7\u652F\u6301", status);
      return result(false, "\u65E0\u6CD5\u8FDE\u63A5\u4E0A\u6E38\uFF0C\u8BF7\u68C0\u67E5\u7AEF\u70B9\u6216\u7F51\u7EDC");
    } finally {
      this.running = false;
    }
  }
};

// src/index.ts
var name = namespace;
var inject = ["llm", "settings", "credentials"];
var secretSchema = z4.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
var saveSchema = z4.object({
  revision: z4.number().int().nonnegative(),
  config: z4.object({ crossChannel: z4.boolean(), channels: z4.array(z4.unknown()).max(32) }).strict(),
  newKeys: z4.array(z4.object({
    channelId: z4.string().max(80),
    keyId: z4.string().max(80),
    secret: secretSchema
  }).strict()).max(128)
}).strict();
var restoreSchema = z4.object({
  channelId: z4.string().max(80),
  keyId: z4.string().max(80),
  modelId: z4.string().max(160)
}).strict();
var diagnosticSchema = z4.object({
  channelId: z4.string().max(80),
  keyId: z4.string().max(80),
  kind: z4.enum(["google", "openai"]),
  endpoint: z4.string().max(2048),
  model: z4.string().min(1).max(160).optional(),
  secret: secretSchema.optional(),
  revision: z4.number().int().positive()
}).strict();
var json = (entry2) => JSON.parse(JSON.stringify(entry2));
var _restore_dec, _diagnose_dec, _save_dec, _read_dec, _a, _init;
var PoolService = class extends (_a = TypertRemoteService, _read_dec = [Remote], _save_dec = [Remote], _diagnose_dec = [Remote], _restore_dec = [Remote], _a) {
  constructor(ctx, scheduler, checkpoints, profileDir) {
    super(ctx, "modelKeyPool");
    __runInitializers(_init, 5, this);
    __publicField(this, "pendingWrite", Promise.resolve());
    __publicField(this, "diagnostics", new KeyDiagnostics());
    __publicField(this, "host");
    __publicField(this, "scheduler");
    __publicField(this, "checkpoints");
    __publicField(this, "profileDir");
    __publicField(this, "configIssue");
    __publicField(this, "cleanupIssue");
    this.host = ctx;
    this.scheduler = scheduler;
    this.checkpoints = checkpoints;
    this.profileDir = profileDir;
  }
  settingsRevision() {
    const descriptor = this.host.settings.describe({ redactSecrets: true }).find((entry2) => entry2.ns === namespace);
    if (!descriptor) throw new Error("DSH \u5C1A\u672A\u8F7D\u5165\u6A21\u578B\u5BC6\u94A5\u6C60\u7684\u914D\u7F6E");
    return descriptor.revision;
  }
  credential(channel, key, revision) {
    const id2 = createHash("sha256").update(`${this.profileDir}: ${credentialId(channel, key, revision)}`).digest("hex");
    return credentialKey(namespace, `k-${id2}`);
  }
  read() {
    return json({
      revision: this.settingsRevision(),
      config: this.scheduler.config,
      policy,
      health: this.scheduler.snapshot(),
      checkpointBlocked: this.checkpoints.blocked,
      issue: this.configIssue ?? this.checkpoints.issue ?? this.cleanupIssue
    });
  }
  save(payload) {
    const work = this.pendingWrite.then(() => this.commit(payload));
    this.pendingWrite = work.then(() => {
    }, () => {
    });
    return work;
  }
  async diagnose(payload) {
    const parsed = diagnosticSchema.safeParse(payload);
    if (!parsed.success) throw new Error("\u8BF7\u68C0\u67E5\u6D4B\u8BD5\u6240\u7528\u7684 Key \u6216\u6A21\u578B ID");
    const { channelId, keyId, kind, revision, model } = parsed.data;
    if (model && !validUpstream(kind, model)) throw new Error("\u4E0A\u6E38\u6A21\u578B ID \u65E0\u6548");
    const endpoint = normalizeEndpoint(kind, parsed.data.endpoint);
    let secret = parsed.data.secret;
    if (!secret) {
      const channel = this.scheduler.config.channels.find((entry2) => entry2.id === channelId);
      const key = channel?.keys.find((entry2) => entry2.id === keyId);
      if (!key) throw new Error("\u8BF7\u5148\u8F93\u5165 API Key");
      if (key.revision !== revision || channel?.kind !== kind || channel.endpoint !== endpoint) {
        throw new Error("\u51ED\u8BC1\u7248\u672C\u6216\u6E20\u9053\u5730\u5740\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u8F7D\u5165\u914D\u7F6E\u6216\u8F93\u5165\u65B0 Key");
      }
      const record = await this.host.credentials.readRecord(this.credential(channelId, keyId, revision));
      secret = record?.kind === "api-key" ? record.key : void 0;
      if (!secret || !secretSchema.safeParse(secret).success) throw new Error("\u5DF2\u4FDD\u5B58\u7684\u51ED\u8BC1\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165");
    }
    return json(await this.diagnostics.run({ kind, endpoint, secret, model }));
  }
  async commit(payload) {
    const parsed = saveSchema.safeParse(payload);
    if (!parsed.success) throw new Error("\u5BC6\u94A5\u6C60\u914D\u7F6E\u6216\u51ED\u8BC1\u683C\u5F0F\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165");
    const { revision, newKeys } = parsed.data;
    if (this.settingsRevision() !== revision) throw new Error("\u914D\u7F6E\u5DF2\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u8F7D\u5165\u540E\u4FDD\u5B58");
    const next = validateConfig(parsed.data.config);
    const old = this.scheduler.config;
    const newSecrets = new Map(newKeys.map((entry2) => [credentialId(entry2.channelId, entry2.keyId, 0), entry2.secret]));
    if (newSecrets.size !== newKeys.length) throw new Error("\u540C\u4E00\u628A Key \u53EA\u80FD\u63D0\u4EA4\u4E00\u6B21");
    const staged = [];
    const live = /* @__PURE__ */ new Set();
    try {
      for (const channel of next.channels) {
        const previousChannel = old.channels.find((entry2) => entry2.id === channel.id);
        for (const key of channel.keys) {
          const previous = previousChannel?.keys.find((entry2) => entry2.id === key.id);
          const ref = this.credential(channel.id, key.id, key.revision);
          const token = credentialId(channel.id, key.id, 0);
          const secret = newSecrets.get(token);
          newSecrets.delete(token);
          live.add(ref);
          if (!secret) {
            if (!previous || previous.revision !== key.revision || previousChannel?.endpoint !== channel.endpoint || previousChannel.kind !== channel.kind || !(await this.host.credentials.describeRecord(ref)).configured) {
              throw new Error("\u65B0\u589E Key \u6216\u53D8\u66F4\u6E20\u9053\u7AEF\u70B9\u65F6\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u8BE5\u6E20\u9053\u7684\u51ED\u8BC1");
            }
            continue;
          }
          if (key.revision !== (previous?.revision ?? 0) + 1) throw new Error("\u51ED\u8BC1\u7248\u672C\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u8F7D\u5165");
          let created = false;
          await this.host.credentials.modifyRecord(ref, async (record) => {
            if (record) throw new Error("\u51ED\u8BC1\u7248\u672C\u5DF2\u5B58\u5728\uFF0C\u8BF7\u4F7F\u7528\u65B0\u7684 Key \u6761\u76EE");
            created = true;
            return { kind: "api-key", key: secret };
          });
          if (created) staged.push(ref);
        }
      }
      if (newSecrets.size) throw new Error("\u63D0\u4EA4\u7684 Key \u4E0E\u6E20\u9053\u914D\u7F6E\u4E0D\u4E00\u81F4");
      await this.host.settings.replace(namespace, next, revision);
    } catch (error) {
      for (const ref of staged) await this.removeCredential(ref);
      throw error;
    }
    for (const channel of old.channels) {
      for (const key of channel.keys) {
        const ref = this.credential(channel.id, key.id, key.revision);
        if (!live.has(ref)) await this.removeCredential(ref);
      }
    }
    return this.read();
  }
  async removeCredential(ref) {
    try {
      await this.host.credentials.deleteRecord(ref);
    } catch {
      this.cleanupIssue = "\u6709\u65E7\u51ED\u8BC1\u672A\u80FD\u4ECE DSH \u51ED\u8BC1\u5E93\u6E05\u9664\uFF0C\u8BF7\u68C0\u67E5\u5B58\u50A8\u6743\u9650\u3002";
    }
  }
  async restore(payload) {
    if (this.checkpoints.blocked) {
      if (payload !== null) throw new Error("\u8BF7\u5148\u91CD\u5EFA\u5065\u5EB7\u68C0\u67E5\u70B9");
      await this.checkpoints.save();
      return this.read();
    }
    const parsed = restoreSchema.safeParse(payload);
    if (!parsed.success) throw new Error("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u6E20\u9053\u3001Key \u548C\u6A21\u578B");
    const { channelId, keyId, modelId: modelId2 } = parsed.data;
    const candidate = this.scheduler.allCandidates().find((entry2) => entry2.channel.id === channelId && entry2.key.id === keyId && entry2.model.id === modelId2);
    if (!candidate) throw new Error("\u8BE5 Key \u6216\u6A21\u578B\u5DF2\u5220\u9664");
    this.scheduler.recover(candidate);
    await this.checkpoints.save();
    return this.read();
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "read", _read_dec, PoolService);
__decorateElement(_init, 1, "save", _save_dec, PoolService);
__decorateElement(_init, 1, "diagnose", _diagnose_dec, PoolService);
__decorateElement(_init, 1, "restore", _restore_dec, PoolService);
__decoratorMetadata(_init, PoolService);
async function apply(ctx, live) {
  const lifecycle = new AbortController();
  const scheduler = new Scheduler();
  const profileDir = dirname2(ctx.settings.documentPath);
  const releaseProfile = await claimProfile(join(profileDir, namespace, "instance"));
  ctx.effect(() => releaseProfile);
  const checkpoints = new Checkpoints(join(profileDir, namespace, "runtime-checkpoints.json"), scheduler);
  await checkpoints.load();
  const bridge = await createBridge();
  let registration;
  ctx.effect(() => async () => {
    lifecycle.abort();
    scheduler.close();
    registration?.();
    bridge.close();
    await checkpoints.close();
  });
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
  scheduler.onCheckpoint = () => {
    if (!checkpoints.blocked) void checkpoints.save();
  };
  const service = new PoolService(ctx, scheduler, checkpoints, profileDir);
  const adapter = new PoolAdapter({
    bridge,
    scheduler,
    lifecycle: lifecycle.signal,
    secret: async (channel, key, revision) => {
      if (checkpoints.blocked) throw new LlmError2(checkpoints.issue ?? "\u5065\u5EB7\u68C0\u67E5\u70B9\u4E0D\u53EF\u7528", "POOL_CHECKPOINT");
      if (service.configIssue) throw new LlmError2(service.configIssue, "POOL_INVALID_CONFIG");
      const record = await ctx.credentials.readRecord(service.credential(channel, key, revision));
      return record?.kind === "api-key" ? record.key : void 0;
    },
    attachments: () => ctx.get("attachments"),
    imageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      (hostPath) => ctx.get("fs")?.processPathFromHostPath(hostPath),
      ref
    )
  });
  let previous;
  let ownedRoutes = /* @__PURE__ */ new Set();
  function reload() {
    let next;
    try {
      next = validateConfig({ crossChannel: live.crossChannel.get(), channels: live.channels.get() });
    } catch {
      service.configIssue = "\u6E20\u9053\u914D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u3001Key \u548C\u7AEF\u70B9\u8BBE\u7F6E\u3002";
      return;
    }
    const serialized = JSON.stringify(next);
    service.configIssue = void 0;
    if (serialized === previous) return;
    const enabled = next.channels.filter((channel) => channel.enabled && channel.keys.some((key) => key.enabled));
    const routes = enabled.map((channel) => routeFor(channel.id));
    if (ctx.llm.listProviders().some((provider) => routes.includes(provider.id) && !ownedRoutes.has(provider.id))) {
      service.configIssue = "\u6E20\u9053\u8DEF\u7531\u5DF2\u88AB\u5176\u4ED6\u63D2\u4EF6\u5360\u7528\uFF0C\u8BF7\u91CD\u65B0\u521B\u5EFA\u8BE5\u6E20\u9053\u3002";
      return;
    }
    adapter.configure(enabled);
    scheduler.configure(next);
    if (registration) registration.replace(routes);
    else if (routes.length) registration = ctx.llm.registerAdapter(routes, adapter);
    ownedRoutes = new Set(routes);
    previous = serialized;
  }
  ctx.on("settings/document-updated", (changed) => {
    if (changed === namespace) reload();
  });
  reload();
}
export {
  Config,
  apply,
  inject,
  name
};
