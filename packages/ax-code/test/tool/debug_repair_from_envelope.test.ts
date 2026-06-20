import { afterEach, describe, expect, test, vi } from "vitest"
import { SessionVerifications } from "../../src/session/verifications"
import { DebugRepairFromEnvelopeTool } from "../../src/tool/debug_repair_from_envelope"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"

const envelopeId = "1234567890abcdef"

function ctx() {
  return {
    sessionID: "ses_debug_repair",
    messageID: "msg_test" as any,
    agent: "test-agent",
    abort: new AbortController().signal,
    callID: "call_debug_repair",
    messages: [],
    metadata() {},
    ask: async () => {},
  } as any
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

function mockRun(candidate: VerificationEnvelope) {
  return [
    {
      tool: "verify_project",
      callID: "call_verify",
      metadata: {},
      envelopes: [{ envelopeId, envelope: candidate }],
    },
  ]
}

describe("DebugRepairFromEnvelopeTool", () => {
  const spies: Array<{ mockRestore(): void }> = []

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore()
  })

  test("creates a bounded repair brief for localized structured failures", async () => {
    spies.push(vi.spyOn(SessionVerifications, "loadRunsWithIds").mockReturnValue(mockRun(envelope()) as any))

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
    spies.push(
      vi.spyOn(SessionVerifications, "loadRunsWithIds").mockReturnValue(
        mockRun(
          envelope({
            structuredFailures: [],
          }),
        ) as any,
      ),
    )

    const tool = await DebugRepairFromEnvelopeTool.init()
    const result = await tool.execute({ envelopeId }, ctx())

    expect(result.title).toContain("rejected")
    expect(result.metadata.decision).toMatchObject({ handoff: false })
    expect(result.metadata.brief).toBeUndefined()
    expect(result.output).toContain("Decision: rejected")
    expect(result.output).toContain("no structured failures")
  })

  test("rejects fabricated envelope ids", async () => {
    spies.push(vi.spyOn(SessionVerifications, "loadRunsWithIds").mockReturnValue(mockRun(envelope()) as any))

    const tool = await DebugRepairFromEnvelopeTool.init()

    await expect(tool.execute({ envelopeId: "fedcba0987654321" }, ctx())).rejects.toThrow(
      /unknown VerificationEnvelope/,
    )
  })
})
