import { poolRemote } from './remote.ts'

export const TYPERT = {
  package: 'dsh-model-key-pool',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  get invocations() { return poolRemote.descriptors },
}
