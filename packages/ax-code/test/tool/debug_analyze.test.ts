import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { DebugEngine } from "../../src/debug-engine"
import { Instance } from "../../src/project/instance"
import { QualityShadow } from "../../src/quality/shadow-runtime"
import { Session } from "../../src/session"
import { DebugAnalyzeTool } from "../../src/tool/debug_analyze"
import { tmpdir } from "../fixture/fixture"

describe("DebugAnalyzeTool", () => {
  const spies: Array<{ mockRestore(): void }> = []

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore()
    }
  })

  test("captures runtime debug shadow after successful analysis", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({
          directory: tmp.path,
          title: "Debug Analyze Tool Shadow",
        })

        spies.push(
          spyOn(DebugEngine, "analyzeBug").mockResolvedValue({
            chain: [
              {
                frame: 0,
                symbol: null,
                file: "src/app.ts",
                line: 10,
                role: "failure",
              },
            ],
            rootCauseHypothesis: null,
            fixSuggestion: null,
            confidence: 0.82,
            truncated: false,
            explain: {
              tool: "debug_analyze",
              queryId: "query-1",
              graphQueries: [],
              heuristicsApplied: ["stack-trace"],
              indexedAt: 0,
              completeness: "full",
            },
          } as any),
        )
        spies.push(spyOn(Session, "get").mockResolvedValue(session))
        const shadowSpy = spyOn(QualityShadow, "captureDebugAnalyze").mockResolvedValue(undefined)
        spies.push(shadowSpy)

        const tool = await DebugAnalyzeTool.init()
        const result = await tool.execute(
          {
            error: "TypeError: undefined is not a function",
            stackTrace: "at handle (/repo/src/app.ts:10:1)",
          },
          {
            sessionID: session.id,
            messageID: "msg_test" as any,
            agent: "test-agent",
            abort: new AbortController().signal,
            callID: "call_debug",
            messages: [],
            metadata() {},
            ask: async () => {},
          } as any,
        )

        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.metadata).toMatchObject({
          confidence: 0.82,
          chainLength: 1,
          resolvedCount: 0,
          truncated: false,
        })
        expect(shadowSpy).toHaveBeenCalledWith(expect.objectContaining({
          session,
          callID: "call_debug",
          error: "TypeError: undefined is not a function",
          stackTrace: "at handle (/repo/src/app.ts:10:1)",
        }))
      },
    })
  })
})
