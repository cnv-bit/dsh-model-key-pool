import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { policy } from './policy.ts'
import type { Scheduler } from './scheduler.ts'

const entry = z.object({
  reason: z.enum(['DAILY_QUOTA', 'BALANCE', 'INVALID_KEY', 'PERMISSION']),
  until: z.number().int().positive().max(8.64e15).optional(),
  status: z.number().int().min(100).max(599).optional(),
  code: z.string().regex(/^[a-z0-9_:-]{1,100}$/i).optional(),
}).strict()
const schema = z.object({ version: z.literal(1), health: z.array(z.tuple([z.string().max(800), entry])) }).strict()

export class Checkpoints {
  issue?: string
  blocked = false
  private pending = Promise.resolve()
  private changed = false
  private writing = false
  private readonly path: string
  private readonly scheduler: Scheduler

  constructor(path: string, scheduler: Scheduler) {
    this.path = path
    this.scheduler = scheduler
  }

  async load() {
    try {
      if ((await stat(this.path)).size > policy.checkpointBytes) throw new Error('oversized checkpoint')
      const snapshot = schema.parse(JSON.parse(await readFile(this.path, 'utf8')))
      for (const [id, record] of snapshot.health) {
        if (!record.until || record.until > Date.now()) this.scheduler.health.set(id, record)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.blocked = true
      this.issue = '健康检查点无法读取，已暂停发送。确认后可重建健康记录。'
    }
  }

  save() {
    this.changed = true
    if (this.writing) return this.pending
    this.writing = true
    this.pending = this.flush()
    return this.pending
  }

  async close() {
    await this.pending
    if (this.issue && !this.blocked) await this.save()
  }

  private async flush() {
    try {
      while (this.changed) {
        this.changed = false
        const health = [...this.scheduler.health].filter(([, record]) =>
          record.reason !== 'RATE_LIMIT' && (!record.until || record.until > Date.now()))
        const document = JSON.stringify({ version: 1, health })
        if (Buffer.byteLength(document) > policy.checkpointBytes) throw new Error('oversized checkpoint')
        await writeFileAtomic(this.path, document, { mode: 0o600, dirMode: 0o700 })
        this.issue = undefined
        this.blocked = false
      }
    } catch {
      this.issue = '健康检查点保存失败，请检查 DSH profile 目录权限。'
    } finally {
      this.writing = false
    }
  }
}

export async function claimProfile(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let unlock!: () => void
  const lifetime = new Promise<void>(resolve => { unlock = resolve })
  let entered!: () => void
  let refused!: (reason: unknown) => void
  const acquired = new Promise<void>((resolve, reject) => { entered = resolve; refused = reject })
  const lock = withFileLock(path, async () => { entered(); await lifetime }, { waitMs: policy.instanceLockWaitMs })
  void lock.catch(refused)
  try {
    await acquired
  } catch {
    throw new Error('此 DSH profile 已有一个模型密钥池实例，或插件数据目录不可写')
  }
  return async () => { unlock(); await lock }
}
