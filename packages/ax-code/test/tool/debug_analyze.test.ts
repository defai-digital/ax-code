import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { DebugEngine } from "../../src/debug-engine"
import { Instance } from "../../src/project/instance"
import { FindingSchema } from "../../src/quality/finding"
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
              {
                frame: 1,
                symbol: {
                  id: "sym:src/caller.ts#caller",
                  qualifiedName: "caller",
                  file: "src/caller.ts",
                  range: { start: { line: 4 }, end: { line: 8 } },
                },
                file: "src/caller.ts",
                line: 5,
                role: "entry",
              },
            ],
            rootCauseHypothesis: null,
            fixSuggestion: null,
            confidence: 0.82,
            truncated: false,
            explain: {
              tool: "debug_analyze",
              queryId: "debug-query-1",
              graphQueries: ["graph-query-1"],
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
          chainLength: 2,
          resolvedCount: 1,
          truncated: false,
        })
        const finding = FindingSchema.parse(result.metadata.finding)
        expect(finding).toMatchObject({
          workflow: "debug",
          category: "bug",
          severity: "HIGH",
          confidence: 0.82,
          file: "src/app.ts",
          anchor: { kind: "line", line: 10 },
          ruleId: "axcode:debug-analyze",
        })
        expect(finding.evidenceRefs?.[0]).toEqual({ kind: "graph", id: "graph-query-1" })
        expect(shadowSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            session,
            callID: "call_debug",
            error: "TypeError: undefined is not a function",
            stackTrace: "at handle (/repo/src/app.ts:10:1)",
          }),
        )
      },
    })
  })

  test("does not cite debug query id as graph evidence", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({
          directory: tmp.path,
          title: "Debug Analyze No Graph Evidence",
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
            confidence: 0.1,
            truncated: false,
            explain: {
              tool: "debug_analyze",
              queryId: "debug-query-no-graph",
              graphQueries: [],
              heuristicsApplied: ["stack-trace"],
              indexedAt: 0,
              completeness: "full",
            },
          } as any),
        )
        spies.push(spyOn(Session, "get").mockResolvedValue(session))
        spies.push(spyOn(QualityShadow, "captureDebugAnalyze").mockResolvedValue(undefined))

        const tool = await DebugAnalyzeTool.init()
        const result = await tool.execute(
          {
            error: "ReferenceError: value is not defined",
            stackTrace: "at handle (/repo/src/app.ts:10:1)",
          },
          {
            sessionID: session.id,
            messageID: "msg_test" as any,
            agent: "test-agent",
            abort: new AbortController().signal,
            callID: "call_debug_no_graph",
            messages: [],
            metadata() {},
            ask: async () => {},
          } as any,
        )

        const finding = FindingSchema.parse(result.metadata.finding)
        expect(finding.evidenceRefs).toBeUndefined()
      },
    })
  })

  test("does not emit a finding when analysis has no locatable frames", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.createNext({
          directory: tmp.path,
          title: "Debug Analyze No Frames",
        })

        spies.push(
          spyOn(DebugEngine, "analyzeBug").mockResolvedValue({
            chain: [],
            rootCauseHypothesis: null,
            fixSuggestion: null,
            confidence: 0.1,
            truncated: false,
            explain: {
              tool: "debug_analyze",
              queryId: "query-empty",
              graphQueries: [],
              heuristicsApplied: [],
              indexedAt: 0,
              completeness: "full",
            },
          } as any),
        )
        spies.push(spyOn(Session, "get").mockResolvedValue(session))
        spies.push(spyOn(QualityShadow, "captureDebugAnalyze").mockResolvedValue(undefined))

        const tool = await DebugAnalyzeTool.init()
        const result = await tool.execute(
          { error: "Error: unknown" },
          {
            sessionID: session.id,
            messageID: "msg_test" as any,
            agent: "test-agent",
            abort: new AbortController().signal,
            callID: "call_debug_empty",
            messages: [],
            metadata() {},
            ask: async () => {},
          } as any,
        )

        expect(result.metadata.finding).toBeUndefined()
        expect(result.metadata.findingId).toBeUndefined()
      },
    })
  })
})
