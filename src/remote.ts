import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteMethodSpec } from '@deepseek-ai/dsh-typert-protocol'

const json = {
  mode: 'strict' as const, create: () => z.json(), typeSymbol: 'dsh-model-key-pool#json',
  jsonSchema: {},
}
const method = (description: string, payload?: string): TypertRemoteMethodSpec => ({
  service: 'modelKeyPool', invocation: { kind: 'direct' }, description,
  parameters: payload ? [{ source: 'json', name: payload, codec: json, strictCodec: json }] : [],
  result: json,
  sourceLocation: { file: 'src/index.ts', line: 1, column: 1 },
})

export const poolRemote = createTypertRemoteInfo({
  package: 'dsh-model-key-pool',
  methods: {
    'modelKeyPool/read': method('Read model key pool settings and redacted health.'),
    'modelKeyPool/save': method('Commit model key pool settings and new credentials.', 'payload'),
    'modelKeyPool/restore': method('Restore the selected Key after verifying its configuration.', 'payload'),
  },
}, z)
