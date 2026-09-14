import { expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import type { ModelMessage } from "ai"
import { Instance } from "../../src/project/instance"
import { ReadTool } from "../../src/tool/read"
import { EvidenceCache } from "../../src/evidence/cache"
import { projectToolEvidence } from "../../src/session/evidence-projection"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

test.runIf(process.env.AX_TEST_EVIDENCE_NATIVE === "1")(
  "paired fixed read workload measures rendering reuse and request bytes separately",
  async () => {
    const source = Array.from({ length: 200 }, (_, i) => `export const value${i} = ${i}`).join("\n")
    const ctx = {
      sessionID: SessionID.make("ses_eval"),
      messageID: MessageID.make("msg_eval"),
      callID: "eval",
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {},
      ask: async () => {},
    }
    const results: Array<{
      mode: string
      sourceBytes: number
      requestedReadCalls: number
      sourceReadsAvoided: number
      renderingCacheHits: number
      serializedResultBytes: number
      projectedResultBytes: number
      omittedOutputBytes: number
      elapsedMs: number
    }> = []
    try {
      for (const mode of ["off", "memory", "rocksdb"]) {
        vi.stubEnv("AX_CODE_EVIDENCE_CACHE", mode)
        await using tmp = await tmpdir({ init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), source) })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const read = await ReadTool.init()
            const messages: ModelMessage[] = []
            const start = performance.now()
            for (let i = 0; i < 10; i++) {
              const result = await read.execute({ filePath: path.join(tmp.path, "source.ts") }, ctx)
              expect(result.output).toContain("value199 = 199")
              messages.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolName: "read",
                    toolCallId: `call_${i}`,
                    output: { type: "text", value: result.output },
                  },
                ],
              })
            }
            const elapsedMs = performance.now() - start
            const projection = mode === "off" ? { messages, omittedBytes: 0 } : projectToolEvidence(messages)
            const stats = await EvidenceCache.stats()
            expect(stats.backend).toBe(mode)
            expect(stats.hits).toBe(mode === "off" ? 0 : 9)
            results.push({
              mode,
              sourceBytes: Buffer.byteLength(source),
              requestedReadCalls: 10,
              sourceReadsAvoided: 0,
              renderingCacheHits: stats.hits,
              serializedResultBytes: Buffer.byteLength(JSON.stringify(messages)),
              projectedResultBytes: Buffer.byteLength(JSON.stringify(projection.messages)),
              omittedOutputBytes: projection.omittedBytes,
              elapsedMs,
            })
          },
        })
        await Instance.disposeAll()
      }
      process.stdout.write(
        "EVIDENCE_CACHE_EVAL " + JSON.stringify({ kind: "fixed-fixture-not-model-benchmark", results }) + "\n",
      )
    } finally {
      await Instance.disposeAll()
      vi.unstubAllEnvs()
    }
  },
)
