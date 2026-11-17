// src/remote.ts
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
var json = {
  mode: "strict",
  create: () => z.json(),
  typeSymbol: "dsh-model-key-pool#json",
  jsonSchema: {}
};
var method = (description, payload) => ({
  service: "modelKeyPool",
  invocation: { kind: "direct" },
  description,
  parameters: payload ? [{ source: "json", name: payload, codec: json, strictCodec: json }] : [],
  result: json,
  sourceLocation: { file: "src/index.ts", line: 1, column: 1 }
});
var poolRemote = createTypertRemoteInfo({
  package: "dsh-model-key-pool",
  methods: {
    "modelKeyPool/read": method("Read model key pool settings and redacted health."),
    "modelKeyPool/save": method("Commit model key pool settings and new credentials.", "payload"),
    "modelKeyPool/restore": method("Restore the selected Key after verifying its configuration.", "payload")
  }
}, z);

// src/typert.ts
var TYPERT = {
  package: "dsh-model-key-pool",
  face: "host",
  schemas: [],
  model: { services: [], events: [], objects: [] },
  get invocations() {
    return poolRemote.descriptors;
  }
};
export {
  TYPERT
};
