import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { RegisterFindingTool } from "../../src/tool/register_finding"
import { computeFindingId, FindingSchema } from "../../src/quality/finding"
import { Installation } from "../../src/installation"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "ses_test_register_finding",
  messageID: "msg_test" as any,
  agent: "build",
  abort: new AbortController().signal,
  callID: "call_test",
  messages: [],
  metadata: () => {},
  ask: async () => {},
} as any

const validInput = {
  workflow: "review" as const,
  category: "bug" as const,
  severity: "HIGH" as const,
  summary: "Off-by-one in pagination loop",
  file: "src/server/routes/list.ts",
  anchor: { kind: "line" as const, line: 42 },
  rationale: "Loop runs n+1 times when limit equals total.",
  evidence: ["src/server/routes/list.ts:42 - condition uses <= instead of <"],
  suggestedNextAction: "Change condition to `<` and add a regression test.",
}

type Workflow = "review" | "debug" | "qa"

function buildEnvelope(workflow: Workflow, runId: string): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow,
    scope: { kind: "file", paths: ["src/server/routes/list.ts"] },
    command: { runner: "test", argv: ["bun", "test", "test/server/routes/list.test.ts"], cwd: "/tmp/work" },
    result: {
      name: "route pagination test",
      type: "test",
      passed: true,
      status: "passed",
      issues: [],
      duration: 12,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "verify_project", version: "4.x.x", runId },
  }
}

async function withRecordedEnvelope(
  workflow: Workflow,
  fn: (ctxWithSession: typeof ctx, envelopeId: string) => Promise<void>,
) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const envelope = buildEnvelope(workflow, session.id)
      const envelopeId = computeEnvelopeId(envelope)

      Recorder.begin(session.id)
      Recorder.emit({
        type: "session.start",
        sessionID: session.id,
        agent: "build",
        model: "test/model",
        directory: tmp.path,
      })
      Recorder.emit({
        type: "tool.result",
        sessionID: session.id,
        tool: "verify_project",
        callID: `call-${workflow}-verify`,
        status: "completed",
        metadata: { verificationEnvelopes: [envelope] },
        durationMs: 12,
      })
      Recorder.end(session.id)
      await new Promise((resolve) => setTimeout(resolve, 50))

      await fn({ ...ctx, sessionID: session.id }, envelopeId)
    },
  })
}

describe("RegisterFindingTool", () => {
  test("validates a minimal valid input and returns a stable findingId", async () => {
    const tool = await RegisterFindingTool.init()
    const result = await tool.execute(validInput, ctx)

    expect(result.metadata.findingId).toMatch(/^[0-9a-f]{16}$/)
    expect(result.metadata.findingId).toBe(
      computeFindingId({
        workflow: validInput.workflow,
        category: validInput.category,
        file: validInput.file,
        anchor: validInput.anchor,
      }),
    )
    expect(result.title).toContain("HIGH")
    expect(result.title).toContain("bug")
  })

  test("returns the full Finding shape in metadata.finding and it parses against FindingSchema", async () => {
    const tool = await RegisterFindingTool.init()
    const result = await tool.execute(validInput, ctx)

    expect(() => FindingSchema.parse(result.metadata.finding)).not.toThrow()
    const finding = result.metadata.finding
    expect(finding.schemaVersion).toBe(1)
    expect(finding.findingId).toBe(result.metadata.findingId)
    expect(finding.severity).toBe("HIGH")
    expect(finding.category).toBe("bug")
    expect(finding.source.runId).toBe(ctx.sessionID)
    expect(finding.source.tool).toBe("review")
  })

  test("output line includes the file:line anchor and the summary", async () => {
    const tool = await RegisterFindingTool.init()
    const result = await tool.execute(validInput, ctx)

    expect(result.output).toContain("src/server/routes/list.ts:42")
    expect(result.output).toContain("Off-by-one in pagination loop")
    expect(result.output).toContain(result.metadata.findingId)
  })

  test("rejects invalid severity", async () => {
    const tool = await RegisterFindingTool.init()
    await expect(tool.execute({ ...validInput, severity: "BLOCKER" } as any, ctx)).rejects.toThrow()
  })

  test("rejects invalid category", async () => {
    const tool = await RegisterFindingTool.init()
    await expect(tool.execute({ ...validInput, category: "style" } as any, ctx)).rejects.toThrow()
  })

  test("rejects malformed ruleId", async () => {
    const tool = await RegisterFindingTool.init()
    await expect(tool.execute({ ...validInput, ruleId: "vendor:Some_Rule" } as any, ctx)).rejects.toThrow()
  })

  test("rejects summary over 200 chars", async () => {
    const tool = await RegisterFindingTool.init()
    await expect(tool.execute({ ...validInput, summary: "x".repeat(201) } as any, ctx)).rejects.toThrow()
  })

  test("findingId is deterministic across two calls with the same anchor and category", async () => {
    const tool = await RegisterFindingTool.init()
    const a = await tool.execute(validInput, ctx)
    const b = await tool.execute(validInput, ctx)
    expect(a.metadata.findingId).toBe(b.metadata.findingId)
  })

  test("findingId differs when anchor.line changes", async () => {
    const tool = await RegisterFindingTool.init()
    const a = await tool.execute(validInput, ctx)
    const b = await tool.execute({ ...validInput, anchor: { kind: "line", line: 43 } }, ctx)
    expect(a.metadata.findingId).not.toBe(b.metadata.findingId)
  })

  test("findingId includes ruleId so the same defect under two rules dedups separately", async () => {
    const tool = await RegisterFindingTool.init()
    const a = await tool.execute({ ...validInput, ruleId: "axcode:rule-a" }, ctx)
    const b = await tool.execute({ ...validInput, ruleId: "axcode:rule-b" }, ctx)
    expect(a.metadata.findingId).not.toBe(b.metadata.findingId)
  })

  test("symbol anchor produces a different findingId than a line anchor on the same file", async () => {
    const tool = await RegisterFindingTool.init()
    const a = await tool.execute(validInput, ctx)
    const b = await tool.execute(
      {
        ...validInput,
        anchor: { kind: "symbol", symbolId: "node://src/server/routes/list.ts#paginate" },
      },
      ctx,
    )
    expect(a.metadata.findingId).not.toBe(b.metadata.findingId)
  })

  test("optional confidence and ruleId are preserved in the output finding when provided", async () => {
    const tool = await RegisterFindingTool.init()
    const result = await tool.execute({ ...validInput, confidence: 0.83, ruleId: "axcode:bug-empty-catch" }, ctx)
    expect(result.metadata.finding.confidence).toBe(0.83)
    expect(result.metadata.finding.ruleId).toBe("axcode:bug-empty-catch")
  })

  test("source.tool defaults to 'review' but accepts user override", async () => {
    const tool = await RegisterFindingTool.init()
    const def = await tool.execute(validInput, ctx)
    expect(def.metadata.finding.source.tool).toBe("review")
    const override = await tool.execute({ ...validInput, tool: "manual-audit" }, ctx)
    expect(override.metadata.finding.source.tool).toBe("manual-audit")
  })

  test("source.runId is taken from ctx.sessionID", async () => {
    const tool = await RegisterFindingTool.init()
    const customCtx = { ...ctx, sessionID: "ses_other_session" }
    const result = await tool.execute(validInput, customCtx)
    expect(result.metadata.finding.source.runId).toBe("ses_other_session")
  })

  test("source.version is sourced from Installation.VERSION (not hardcoded)", async () => {
    const tool = await RegisterFindingTool.init()
    const result = await tool.execute(validInput, ctx)
    expect(result.metadata.finding.source.version).toBe(Installation.VERSION)
    expect(result.metadata.finding.source.version).not.toBe("4.x.x")
  })

  test("rejects evidenceRefs with kind: 'verification' when the id is not in the session", async () => {
    // Mock ctx has sessionID with no recorded envelopes — any verification
    // ref must therefore be rejected as fabricated.
    const tool = await RegisterFindingTool.init()
    await expect(
      tool.execute(
        {
          ...validInput,
          evidenceRefs: [{ kind: "verification", id: "fabricated0000abc" }],
        },
        ctx,
      ),
    ).rejects.toThrow(/unknown verification envelope id/)
  })

  test("rejects verification evidenceRefs from a different workflow", async () => {
    await withRecordedEnvelope("qa", async (ctxWithSession, envelopeId) => {
      const tool = await RegisterFindingTool.init()
      await expect(
        tool.execute(
          {
            ...validInput,
            workflow: "review",
            evidenceRefs: [{ kind: "verification", id: envelopeId }],
          },
          ctxWithSession,
        ),
      ).rejects.toThrow(/belongs to workflow "qa"/)
    })
  })

  test("accepts verification evidenceRefs from the same workflow", async () => {
    await withRecordedEnvelope("review", async (ctxWithSession, envelopeId) => {
      const tool = await RegisterFindingTool.init()
      const result = await tool.execute(
        {
          ...validInput,
          workflow: "review",
          evidenceRefs: [{ kind: "verification", id: envelopeId }],
        },
        ctxWithSession,
      )

      expect(result.metadata.finding.evidenceRefs).toEqual([{ kind: "verification", id: envelopeId }])
    })
  })

  test("does not strict-validate non-verification evidenceRefs (log/graph/diff pass through)", async () => {
    // Other ref kinds don't yet have session-level loaders; they're
    // accepted as-is. P2.5 step 4 scopes the strict check to verification
    // refs only.
    const tool = await RegisterFindingTool.init()
    const result = await tool.execute(
      {
        ...validInput,
        evidenceRefs: [
          { kind: "log", id: "any-log-id" },
          { kind: "graph", id: "any-graph-id" },
          { kind: "diff", id: "any-diff-id" },
        ],
      },
      ctx,
    )
    expect(result.metadata.finding.evidenceRefs).toHaveLength(3)
    expect(result.metadata.finding.evidenceRefs?.[0].kind).toBe("log")
  })
})
