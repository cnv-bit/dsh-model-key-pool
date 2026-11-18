import React, { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Channel, KeyConfig, KeyInput, ModelConfig, PoolConfig } from './config.ts'
import type { DiagnosticResult } from './diagnostics.ts'
import type { Scheduler } from './scheduler.ts'
import type { policy } from './policy.ts'
import { poolRemote } from './remote.ts'

type View = {
  revision: number; config: PoolConfig; policy: typeof policy
  health: ReturnType<Scheduler['snapshot']>
  issue?: string; checkpointBlocked: boolean
}
type Diagnose = (payload: unknown) => Promise<DiagnosticResult>
type Call = {
  (method: 'read' | 'save' | 'restore', payload?: unknown): Promise<View>
  (method: 'diagnose', payload: unknown): Promise<DiagnosticResult>
}
const NS = 'model-key-pool'
const labels = {
  RATE_LIMIT: '频控冷却', DAILY_QUOTA: '日额度耗尽', BALANCE: '余额或预算不足',
  INVALID_KEY: '凭证不可用', PERMISSION: '权限不足',
}

const style = `
.dsh-model-pool{display:grid;gap:12px;padding:12px}
.dsh-model-pool fieldset,.dsh-model-pool details{min-width:0;border:1px solid #80808055;border-radius:8px;padding:10px}
.dsh-model-pool summary{cursor:pointer}
.dsh-model-pool input:not([type=checkbox]),.dsh-model-pool select,.dsh-model-pool textarea{background:transparent;color:inherit;border:1px solid #80808088;border-radius:6px;padding:5px;max-width:100%}
.dsh-model-pool button{background:transparent;color:inherit;border:1px solid #80808088;border-radius:6px;padding:4px 8px;cursor:pointer}
.dsh-model-pool button:disabled{opacity:.55;cursor:default}
.dsh-model-pool small{display:block}
.dsh-model-pool .pool-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:6px 0}
.dsh-model-pool .pool-row label{display:inline-flex;gap:4px;align-items:center}
.dsh-model-pool .pool-method{color:#bf5734}
.dsh-model-pool .pool-bulk>label{display:grid;gap:6px;margin:8px 0}
.dsh-model-pool .pool-bulk textarea{box-sizing:border-box;width:100%}
.dsh-model-pool .pool-key{border-bottom:1px solid #80808040}
.dsh-model-pool .pool-key-header{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 0}
.dsh-model-pool button.pool-key-summary{flex:1 1 16em;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;text-align:left;border:0;min-width:0}
.dsh-model-pool .pool-key-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-model-pool .pool-key-summary small{opacity:.75;overflow:hidden;text-overflow:ellipsis}
.dsh-model-pool .pool-key-status{margin:0;white-space:nowrap;font-size:.85em}
.dsh-model-pool .pool-key-details{padding:4px 8px 10px}
.dsh-model-pool .pool-key-details[hidden]{display:none}
.dsh-model-pool .pool-key-diagnostic{overflow-wrap:anywhere}
`
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')

function newChannel(kind: Channel['kind']): Channel {
  return {
    id: newId(), name: kind === 'google' ? 'Google AI Studio' : 'OpenAI 兼容',
    kind, endpoint: '', enabled: true, failover: false, models: [], keys: [],
  }
}

function newKey(number: number): KeyConfig {
  return { id: newId(), label: `Key ${number}`, enabled: true, revision: 1, group: '' }
}

function KeyRow({ channel, entry, model, view, secret, number, initiallyOpen, diagnose, addModel, change, setSecret, remove, restore }: {
  channel: Channel; entry: KeyConfig; model: string; view: View; secret: string; number: number; initiallyOpen: boolean
  diagnose: Diagnose; addModel: (model: string) => void
  change: (patch: Partial<KeyConfig>) => void; setSecret: (secret: string) => void; remove: () => void; restore: () => void
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const [running, setRunning] = useState<'test' | 'catalog'>()
  const [test, setTest] = useState<DiagnosticResult>()
  const [catalog, setCatalog] = useState<DiagnosticResult>()
  const [picked, setPicked] = useState('')
  const keyChanges = useRef(0)
  const modelChanges = useRef(0)
  const saved = view.config.channels.find(row => row.id === channel.id)?.keys.find(row => row.id === entry.id)
  const configured = channel.models.find(row => row.id === model && row.upstream) ?? channel.models.find(row => row.upstream)
  const upstream = picked || configured?.upstream
  const health = view.health.find(row => row.channelId === channel.id && row.keyId === entry.id && row.modelId === configured?.id)
  useEffect(() => {
    keyChanges.current++
    setTest(undefined)
    setCatalog(undefined)
    setPicked('')
  }, [channel.kind, channel.endpoint, entry.revision, secret])
  useEffect(() => {
    modelChanges.current++
    setTest(undefined)
  }, [upstream])
  const state = !entry.enabled ? '已停用' : health?.health ? labels[health.health.reason] :
    health?.current ? '当前使用' : health?.verified ? '可用' : '未验证'
  const modelStatus = health?.last?.status ?? health?.health?.status
  const status = test ? test.status : modelStatus ?? catalog?.status
  const summary = test ? (test.ok ? '连通' : '测试失败') :
    !entry.enabled || health?.health || health?.verified || modelStatus ? state :
    catalog ? (catalog.ok ? '目录可访问' : '目录失败') : state
  const haveKey = !!(secret.trim() || saved)
  const detailsId = `pool-key-${channel.id}-${entry.id}`
  const check = async (kind: 'test' | 'catalog') => {
    const keyVersion = keyChanges.current
    const modelVersion = modelChanges.current
    setRunning(kind)
    setOpen(true)
    let result: DiagnosticResult
    try {
      result = await diagnose({
        channelId: channel.id, keyId: entry.id, kind: channel.kind, endpoint: channel.endpoint, revision: entry.revision,
        ...(secret.trim() && { secret: secret.trim() }), ...(kind === 'test' && { model: upstream }),
      })
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : '请求失败', elapsedMs: 0 }
    }
    if (keyChanges.current === keyVersion) {
      if (kind === 'catalog') setCatalog(result)
      else if (modelChanges.current === modelVersion) setTest(result)
    }
    setRunning(undefined)
  }
  return <div className="pool-key">
    <div className="pool-key-header">
      <button type="button" className="pool-key-summary" aria-expanded={open} aria-controls={detailsId}
        onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="pool-key-title" title={entry.group}><strong>{number}. {entry.label}</strong><small>{entry.group || '未填写项目或配额组'}</small></span>
        <span className="pool-key-status">{summary}{status !== undefined && ` · HTTP ${status}`}</span>
      </button>
      <button type="button" disabled={!haveKey || !upstream || !!running} onClick={() => void check('test')}>
        {running === 'test' ? '测试中…' : '测试连通'}</button>
      <button type="button" disabled={!haveKey || !!running} onClick={() => void check('catalog')}>
        {running === 'catalog' ? '获取中…' : '获取模型'}</button>
    </div>
    <div className="pool-key-details" id={detailsId} hidden={!open}>
    <fieldset disabled={!!running}>
    <div className="pool-row">
      <label>别名 <input value={entry.label} onChange={event => change({ label: event.target.value })} /></label>
      <label>{channel.kind === 'google' ? '项目 ID / 编号' : '共享配额组'}
        <input value={entry.group} placeholder="归属未确认" onChange={event => change({ group: event.target.value.trim() })} />
      </label>
      <label><input type="checkbox" checked={entry.enabled} onChange={event => change({ enabled: event.target.checked })} />启用</label>
      <button type="button" onClick={remove}>删除 Key</button>
    </div>
    <label>{saved ? '更换凭证' : 'API Key'} <input type="password" autoComplete="new-password" value={secret}
      onChange={event => setSecret(event.target.value)} placeholder={saved ? '留空保留原凭证' : ''} /></label>
    <small>{upstream ? `测试模型 ${upstream}。测试会发送一次短生成请求。` : '添加模型或从目录中选择模型后即可测试连通。'}</small>
    {test && <p className="pool-key-diagnostic" role="status">
      {test.status !== undefined && `HTTP ${test.status} · `}{test.message}{test.elapsedMs > 0 && ` · ${test.elapsedMs} ms`}
    </p>}
    {catalog && <p className="pool-key-diagnostic" role="status">
      {catalog.status !== undefined && `目录 HTTP ${catalog.status} · `}{catalog.message}{catalog.partial && '（仅显示已读分页）'}
    </p>}
    {!!catalog?.models?.length && <div className="pool-row">
      <label>上游模型目录 <select value={picked} onChange={event => setPicked(event.target.value)}>
        <option value="">选择一个模型</option>
        {catalog.models.map(id => <option key={id}>{id}</option>)}
      </select></label>
      <button type="button" disabled={!picked || channel.models.some(entry => entry.upstream === picked)}
        onClick={() => addModel(picked)}>加入渠道</button>
    </div>}
    {configured && <div className="pool-row">
      <span>{configured.id} · {state}{health && ` · ${health.rpm} RPM`}</span>
      {health?.health?.until && <span>恢复时间 {new Date(health.health.until).toLocaleString()}</span>}
      {health?.last && <details><summary>错误详情</summary>
        <small>{new Date(health.last.at).toLocaleString()}</small>
        {health.last.status ? `HTTP ${health.last.status} ` : ''}{health.last.code ?? '上游未提供可识别的错误码'}
        {health.last.description && <p>{health.last.description}</p>}
        {health.last.groupConflict && '。上游项目与配置不一致，请核对项目编号。'}
      </details>}
      {health?.health &&
        <button type="button" onClick={restore}>清除本地封存</button>}
    </div>}
    </fieldset>
    </div>
  </div>
}

function ModelRow({ entry, change, remove }: {
  entry: ModelConfig; change: (patch: Partial<ModelConfig>) => void; remove: () => void
}) {
  return <div className="pool-row">
    <label>逻辑模型 <input value={entry.id} onChange={event => change({ id: event.target.value.trim() })} /></label>
    <label>上游模型 <input value={entry.upstream} onChange={event => change({ upstream: event.target.value.trim() })} /></label>
    <label>RPM <input type="number" min="1" value={entry.rpm ?? ''} placeholder="未核实"
      onChange={event => change({ rpm: event.target.value ? Number(event.target.value) : undefined })} /></label>
    <label>上下文 token <input type="number" min="1" value={entry.contextWindow ?? ''} placeholder="未核实"
      onChange={event => change({ contextWindow: event.target.value ? Number(event.target.value) : undefined })} /></label>
    <label>最大输出 token <input type="number" min="1" value={entry.maxTokens ?? ''} placeholder="未核实"
      onChange={event => change({ maxTokens: event.target.value ? Number(event.target.value) : undefined })} /></label>
    <label><input type="checkbox" checked={entry.tools} onChange={event => change({ tools: event.target.checked })} />工具</label>
    <label><input type="checkbox" checked={entry.images} onChange={event => change({ images: event.target.checked })} />图片</label>
    <label><input type="checkbox" checked={entry.reasoning} onChange={event => change({ reasoning: event.target.checked })} />推理</label>
    <button type="button" onClick={remove}>删除模型</button>
  </div>
}

function BulkKeys({ count, add }: {
  count: number
  add: (entries: { key: KeyConfig; secret: string }[]) => void
}) {
  const [text, setText] = useState('')
  const [group, setGroup] = useState('')
  const [error, setError] = useState('')
  const remaining = 128 - count
  return <details className="pool-bulk">
    <summary>批量添加 Key</summary>
    <label>所属项目或共享配额组 <input value={group} onChange={event => setGroup(event.target.value.trim())} /></label>
    <label>每行一把 Key <textarea rows={4} autoComplete="off" value={text}
      onChange={event => setText(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => {
      const secrets = [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
      if (!secrets.length || secrets.length > remaining) {
        setError(`请填写至少一把 Key，当前还能添加 ${remaining} 把。`)
        return
      }
      add(secrets.map((secret, index) => ({ key: { ...newKey(count + index + 1), group }, secret })))
      setText('')
      setError('')
    }}>加入草稿</button>
  </details>
}

function Card({ call }: { call: Call }) {
  const [view, setView] = useState<View>()
  const [draft, setDraft] = useState<PoolConfig>()
  const [revision, setRevision] = useState(0)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [chosenModel, setChosenModel] = useState('')
  const [kind, setKind] = useState<Channel['kind']>('google')
  const [newKeyId, setNewKeyId] = useState('')
  const [formEpoch, setFormEpoch] = useState(0)
  useEffect(() => {
    let mounted = true
    let loading = false
    let first = true
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const next = await call('read')
        if (!mounted) return
        setView(current => !current || next.revision >= current.revision ? next : current)
        if (first) {
          first = false
          setDraft(structuredClone(next.config))
          setRevision(next.revision)
          setMessage('')
        }
      } catch (error) { if (mounted && first) setMessage(String(error)) }
      finally { loading = false }
    }
    void load()
    const timer = setInterval(load, 2500)
    return () => { mounted = false; clearInterval(timer) }
  }, [call])

  async function perform(work: () => Promise<View>, reset = false) {
    setBusy(true)
    setMessage('')
    try {
      const next = await work()
      setView(next)
      if (reset) {
        setDraft(structuredClone(next.config))
        setRevision(next.revision)
        setSecrets({})
        setNewKeyId('')
        setFormEpoch(epoch => epoch + 1)
      }
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }

  if (!view || !draft) return <p role="status">{message || '正在载入模型密钥池…'}</p>
  const models = [...new Set(draft.channels.flatMap(channel => channel.models.map(model => model.id).filter(Boolean)))]
  const selected = models.includes(chosenModel) ? chosenModel : models[0] ?? ''
  const changeChannel = (index: number, patch: Partial<Channel>) => {
    setDraft(current => current && {
      ...current, channels: current.channels.map((channel, position) => position === index ? { ...channel, ...patch } : channel),
    })
  }
  const save = () => perform(() => {
    const config = structuredClone(draft)
    const newKeys: KeyInput[] = []
    for (const channel of config.channels) {
      for (const key of channel.keys) {
        const secret = secrets[`${channel.id}/${key.id}`]?.trim()
        if (!secret) continue
        const old = view.config.channels.find(entry => entry.id === channel.id)?.keys.find(entry => entry.id === key.id)
        key.revision = (old?.revision ?? 0) + 1
        newKeys.push({ channelId: channel.id, keyId: key.id, secret })
      }
    }
    return call('save', { revision, config, newKeys })
  }, true)

  return <section className="dsh-model-pool" aria-label="模型密钥池">
    <style>{style}</style>
    <strong>模型密钥池</strong>
    <small>首版仅在首字未出时自动接力。回复中途截断不会自动换 Key 重试。</small>
    <small>推理或工具输出一旦开始，也会停止自动接力。</small>
    <small>最多排队 {view.policy.queueMs / 1000} 秒，全局并发 {view.policy.concurrency}，最多尝试 {view.policy.attempts} 次，含首次。</small>
    <small>未填写 RPM 时，按未核实配额的本地默认值 {view.policy.fallbackRpm} RPM 限流。</small>
    <small>清除本地封存会恢复相关共享配额组的候选资格，实际额度仍以上游为准。</small>
    <small>上下文与最大输出留空时沿用宿主默认假设。请按模型文档核对，也可直接填写已知值。</small>
    {view.issue && <p role="alert">{view.issue}</p>}
    {view.checkpointBlocked && <button disabled={busy} onClick={() => void perform(() => call('restore', null))}>重建健康记录</button>}
    {message && <p role="alert">{message}</p>}
    {revision !== view.revision && <p role="alert">已有更新的配置，请重新载入后再保存。</p>}
    <fieldset disabled={busy}>
      <div className="pool-row">
        <label><input type="checkbox" checked={draft.crossChannel}
          onChange={event => setDraft({ ...draft, crossChannel: event.target.checked })} />跨渠道自动接力</label>
        <label>查看模型 <select value={selected} onChange={event => setChosenModel(event.target.value)}>
          {!models.length && <option value="">无模型</option>}
          {models.map(model => <option key={model}>{model}</option>)}
        </select></label>
      </div>
      {draft.channels.map((channel, index) => {
        const reorder = (offset: number) => {
          const channels = [...draft.channels]
          const target = index + offset
          channels[index] = draft.channels[target]
          channels[target] = channel
          setDraft({ ...draft, channels })
        }
        return <details className="pool-channel" key={channel.id}>
          <summary>{channel.name} · {channel.enabled ? '启用' : '停用'}{channel.failover && ' · 参与接力'}</summary>
          <div className="pool-row">
            <label>名称 <input value={channel.name} onChange={event => changeChannel(index, { name: event.target.value })} /></label>
            <span className="pool-method">{channel.kind === 'google' ? 'Google AI Studio' : 'OpenAI 兼容'}</span>
            <label><input type="checkbox" checked={channel.enabled} onChange={event => changeChannel(index, { enabled: event.target.checked })} />启用渠道</label>
            <label><input type="checkbox" checked={channel.failover} onChange={event => changeChannel(index, { failover: event.target.checked })} />加入接力池</label>
            <button type="button" disabled={!index} onClick={() => reorder(-1)}>上移</button>
            <button type="button" disabled={index === draft.channels.length - 1} onClick={() => reorder(1)}>下移</button>
            <button type="button" onClick={() => setDraft({ ...draft, channels: draft.channels.filter((_, i) => i !== index) })}>删除渠道</button>
          </div>
          {channel.kind === 'openai' && <label>Base URL <input type="url" value={channel.endpoint}
            placeholder="https://example.com/v1" onChange={event => changeChannel(index, { endpoint: event.target.value.trim() })} /></label>}
          <fieldset>
            <legend>模型映射</legend>
            {channel.models.map((model, modelIndex) => <ModelRow key={modelIndex} entry={model}
              change={patch => changeChannel(index, { models: channel.models.map((entry, i) => i === modelIndex ? { ...entry, ...patch } : entry) })}
              remove={() => changeChannel(index, { models: channel.models.filter((_, i) => i !== modelIndex) })} />)}
            <button type="button" onClick={() => changeChannel(index, { models: [...channel.models,
              { id: '', upstream: '', tools: true, images: false, reasoning: channel.kind === 'google' }] })}>添加模型</button>
          </fieldset>
          {channel.keys.map((key, keyIndex) => {
            const id = `${channel.id}/${key.id}`
            return <KeyRow key={`${key.id}/${formEpoch}`} channel={channel} entry={key} model={selected} view={view}
              secret={secrets[id] ?? ''} number={keyIndex + 1} initiallyOpen={newKeyId === key.id}
              diagnose={payload => call('diagnose', payload)}
              addModel={upstream => {
                const base = upstream.replaceAll('/', '-')
                let id = base
                for (let suffix = 2; channel.models.some(model => model.id === id); suffix++) {
                  id = `${base.slice(0, 150)}-${suffix}`
                }
                changeChannel(index, { models: [...channel.models, {
                  id, upstream, tools: true, images: false, reasoning: channel.kind === 'google',
                }] })
              }}
              change={patch => changeChannel(index, { keys: channel.keys.map(entry => entry.id === key.id ? { ...entry, ...patch } : entry) })}
              setSecret={secret => setSecrets(current => ({ ...current, [id]: secret }))}
              remove={() => {
                changeChannel(index, { keys: channel.keys.filter(entry => entry.id !== key.id) })
                setSecrets(current => Object.fromEntries(Object.entries(current).filter(([name]) => name !== id)))
              }}
              restore={() => void perform(() => call('restore', { channelId: channel.id, keyId: key.id,
                modelId: (channel.models.find(row => row.id === selected && row.upstream) ?? channel.models.find(row => row.upstream))?.id }))} />
          })}
          <button type="button" onClick={() => {
            const entry = newKey(channel.keys.length + 1)
            setNewKeyId(entry.id)
            changeChannel(index, { keys: [...channel.keys, entry] })
          }}>添加 Key</button>
          <BulkKeys count={channel.keys.length} add={entries => {
            changeChannel(index, { keys: [...channel.keys, ...entries.map(entry => entry.key)] })
            setSecrets(current => ({
              ...current, ...Object.fromEntries(entries.map(entry => [`${channel.id}/${entry.key.id}`, entry.secret])),
            }))
          }} />
        </details>
      })}
      <div className="pool-row">
        <label>渠道模板 <select value={kind} onChange={event => setKind(event.target.value === 'openai' ? 'openai' : 'google')}>
          <option value="google">Google AI Studio</option>
          <option value="openai">OpenAI 兼容</option>
        </select></label>
        <button type="button" onClick={() => setDraft({ ...draft, channels: [...draft.channels, newChannel(kind)] })}>添加渠道</button>
      </div>
    </fieldset>
    <div className="pool-row">
      <button disabled={busy || revision !== view.revision} onClick={() => void save()}>保存</button>
      <button disabled={busy} onClick={() => void perform(() => call('read'), true)}>重载配置并丢弃草稿</button>
    </div>
  </section>
}

export const inject = ['slots', 'remote', 'configForms']
export function apply(ctx: Context) {
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let active = true
    const mount = ctx.remote.$mount(poolRemote)
    void mount.then((off: () => void) => { if (active) dispose = off; else off() }, (error: unknown) => ctx.logger.error(error))
    return () => { active = false; dispose?.() }
  })
  ctx.inject(['remote.modelKeyPool'], child => {
    const call = (async (method: 'read' | 'save' | 'restore' | 'diagnose', payload?: unknown) => {
      const result = await poolRemote.methods[`modelKeyPool/${method}`].invoke(child.remote, method === 'read' ? {} : { payload })
      if (!('ok' in result)) throw new Error('DSH 返回了意外的流式设置响应')
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }) as Call
    const Page = () => <Card call={call} />
    child.effect(() => child.configForms.whileServed([NS], () => child.slots.inject(
      'settings.plugins.tab', () => child.slots.register({
        name: 'settings.plugins.tab', id: NS, label: () => '模型密钥池', order: 105,
      }, Page),
    )))
  })
}
