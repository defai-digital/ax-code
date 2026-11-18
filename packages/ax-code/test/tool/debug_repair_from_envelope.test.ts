import { afterEach, describe, expect, test, vi } from "vitest"
import { EventQuery } from "../../src/replay/query"
import { DebugRepairFromEnvelopeTool } from "../../src/tool/debug_repair_from_envelope"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { SessionID, MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"

const envelopeId = computeEnvelopeId(envelope())

function ctx(): Tool.Context {
  return {
    sessionID: SessionID.make("ses_debug_repair"),
    messageID: MessageID.make("msg_test"),
    agent: "test-agent",
    abort: new AbortController().signal,
    callID: "call_debug_repair",
    messages: [],
    metadata() {},
    ask: async () => {},
  }
}

function envelope(overrides: Partial<VerificationEnvelope> = {}): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "debug",
    scope: { kind: "file", paths: ["src/foo.ts"] },
    command: { runner: "typecheck", argv: ["sh", "-c", "bun run typecheck"], cwd: "/tmp/work" },
    result: {
      name: "typecheck",
      type: "typecheck",
      passed: false,
      status: "failed",
      issues: [],
      duration: 12,
      output: "src/foo.ts(10,4): error TS2322: wrong type",
    },
    structuredFailures: [
      {
        kind: "typecheck",
        file: "src/foo.ts",
        line: 10,
        column: 4,
        code: "TS2322",
        message: "wrong type",
      },
    ],
    artifactRefs: [],
    source: { tool: "verify_project", version: "4.x.x", runId: "ses_debug_repair" },
    ...overrides,
  }
}

function mockEvents(
  candidate: VerificationEnvelope,
  siblings: readonly unknown[] = [],
): ReturnType<typeof EventQuery.bySession> {
  return [
    {
      type: "tool.result",
      sessionID: "ses_debug_repair",
      tool: "verify_project",
      callID: "call_verify",
      status: "completed",
      metadata: { verificationEnvelopes: [candidate, ...siblings] },
      durationMs: 1,
    },
  ]
}

describe("DebugRepairFromEnvelopeTool", () => {
  const spies: Array<{ mockRestore(): void }> = []

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore()
  })

  test("creates a bounded repair brief for localized structured failures", async () => {
    spies.push(vi.spyOn(EventQuery, "bySessionStrict").mockReturnValue(mockEvents(envelope())))

    const tool = await DebugRepairFromEnvelopeTool.init()
    const result = await tool.execute({ envelopeId }, ctx())

    expect(result.title).toContain("ready")
    expect(result.metadata.decision).toMatchObject({ handoff: true })
    expect(result.metadata.brief).toContain("Repair brief: typecheck")
    expect(result.metadata.brief).toContain("src/foo.ts:10:4 TS2322")
    expect(result.output).toContain("Decision: candidate")
    expect(result.output).toContain("Source: verify_project/call_verify")
  })

  test("rejects envelopes that are not localized repair candidates", async () => {
    const candidate = envelope({ structuredFailures: [] })
    spies.push(vi.spyOn(EventQuery, "bySessionStrict").mockReturnValue(mockEvents(candidate)))

    const tool = await DebugRepairFromEnvelopeTool.init()
    const result = await tool.execute({ envelopeId: computeEnvelopeId(candidate) }, ctx())

    expect(result.title).toContain("rejected")
    expect(result.metadata.decision).toMatchObject({ handoff: false })
    expect(result.metadata.brief).toBeUndefined()
    expect(result.output).toContain("Decision: rejected")
    expect(result.output).toContain("no structured failures")
  })

  test("rejects fabricated envelope ids", async () => {
    spies.push(vi.spyOn(EventQuery, "bySessionStrict").mockReturnValue(mockEvents(envelope())))

    const tool = await DebugRepairFromEnvelopeTool.init()

    await expect(tool.execute({ envelopeId: "fedcba0987654321" }, ctx())).rejects.toThrow(
      /unknown VerificationEnvelope/,
    )
  })
  test("valid failure evidence remains available for diagnostic repair when a sibling is malformed", async () => {
    spies.push(vi.spyOn(EventQuery, "bySessionStrict").mockReturnValue(mockEvents(envelope(), [{ schemaVersion: 99 }])))
    const tool = await DebugRepairFromEnvelopeTool.init()
    const result = await tool.execute({ envelopeId }, ctx())
    expect(result.metadata.decision.handoff).toBe(true)
    expect(result.metadata.brief).toContain("Repair brief: typecheck")
  })
})
