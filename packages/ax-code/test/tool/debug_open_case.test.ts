import { describe, expect, test } from "bun:test"
import { DebugOpenCaseTool } from "../../src/tool/debug_open_case"
import {
  computeDebugCaseId,
  DebugCaseSchema,
  DEBUG_ID_PATTERN,
} from "../../src/debug-engine/runtime-debug"
import { Installation } from "../../src/installation"

const ctx = {
  sessionID: "ses_test_open_case",
  messageID: "msg_test" as any,
  agent: "build",
  abort: new AbortController().signal,
  callID: "call_test",
  messages: [],
  metadata: () => {},
  ask: async () => {},
} as any

describe("DebugOpenCaseTool", () => {
  test("returns a 16-char hex caseId derived deterministically from problem + sessionID", async () => {
    const tool = await DebugOpenCaseTool.init()
    const result = await tool.execute({ problem: "tests time out in CI" }, ctx)
    expect(result.metadata.caseId).toMatch(DEBUG_ID_PATTERN)
    expect(result.metadata.caseId).toBe(
      computeDebugCaseId({ problem: "tests time out in CI", runId: ctx.sessionID }),
    )
  })

  test("metadata.debugCase parses against DebugCaseSchema with status='open' and current source/version", async () => {
    const tool = await DebugOpenCaseTool.init()
    const result = await tool.execute({ problem: "endpoint /api/users 5xx since deploy 4a1b2c" }, ctx)
    const parsed = DebugCaseSchema.parse(result.metadata.debugCase)
    expect(parsed.status).toBe("open")
    expect(parsed.source.tool).toBe("debug_open_case")
    expect(parsed.source.version).toBe(Installation.VERSION)
    expect(parsed.source.runId).toBe(ctx.sessionID)
    expect(parsed.problem).toContain("endpoint")
  })

  test("output truncates problem to 80 chars + ellipsis when long", async () => {
    const tool = await DebugOpenCaseTool.init()
    const long = "x".repeat(200)
    const result = await tool.execute({ problem: long }, ctx)
    expect(result.output).toContain("…")
  })

  test("calling twice with the same problem in the same session returns the same caseId (dedup)", async () => {
    const tool = await DebugOpenCaseTool.init()
    const a = await tool.execute({ problem: "same problem" }, ctx)
    const b = await tool.execute({ problem: "same problem" }, ctx)
    expect(a.metadata.caseId).toBe(b.metadata.caseId)
  })

  test("rejects empty or over-long problem (Zod input validation)", async () => {
    const tool = await DebugOpenCaseTool.init()
    await expect(tool.execute({ problem: "" } as any, ctx)).rejects.toThrow()
    await expect(tool.execute({ problem: "x".repeat(501) } as any, ctx)).rejects.toThrow()
  })
})
