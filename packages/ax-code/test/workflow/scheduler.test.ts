import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionShard } from "../../src/session/shard"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskQueue } from "../../src/session/task-queue"
import { Database, eq, sql } from "../../src/storage/db"
import { FileLock } from "../../src/util/filelock"
import { Worktree } from "../../src/worktree"
import {
  WorkflowFixtureSpecs,
  WorkflowRun,
  WorkflowRunID,
  WorkflowScheduler,
  WorkflowSchedulerDisabledError,
  WorkflowTaskQueue,
  WorkflowUnsupportedMergeStrategyError,
  WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
  parseWorkflowSpecV1,
} from "../../src/workflow"
import {
  WorkflowArtifactTable,
  WorkflowChildTable,
  WorkflowPhaseTable,
  WorkflowRunTable,
} from "../../src/workflow/workflow.sql"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

function workflowFinalReportParts(messages: Awaited<ReturnType<typeof Session.messages>>, runID: string) {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part) =>
        part.type === "text" &&
        (part.metadata?.workflowFinalReport as { runID?: unknown } | undefined)?.runID === runID,
    ),
  )
}

describe("WorkflowScheduler", () => {
  test.each(["missing", "unreadable"] as const)("start rejects %s workflow phase data", async (damage) => {
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
        SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
          const phase = eq(WorkflowPhaseTable.run_id, run.id)
          if (damage === "missing") db.delete(WorkflowPhaseTable).where(phase).run()
          else
            db.update(WorkflowPhaseTable)
              .set({ outputs: sql`${"{}"}` })
              .where(phase)
              .run()
        })

        await expect(WorkflowScheduler.start(run.id)).rejects.toMatchObject({ status: 409 })
        expect(await WorkflowRun.get(run.id)).toEqual(run)
      },
    })
  })

  test.each(["position", "kind"] as const)("start rejects a phase with inconsistent %s", async (field) => {
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({
          spec: parseWorkflowSpecV1({
            ...WorkflowFixtureSpecs.noopDryRun,
            phases: [
              { id: "first", name: "First", kind: "noop" },
              { id: "second", name: "Second", kind: "noop", dependsOn: ["first"] },
            ],
          }),
        })
        SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
          db.update(WorkflowPhaseTable)
            .set(field === "position" ? { position: 2 } : { kind: "synthesis" })
            .where(eq(WorkflowPhaseTable.id, run.currentPhaseID!))
            .run()
        })

        await expect(WorkflowScheduler.start(run.id)).rejects.toMatchObject({ status: 409 })
        expect(await WorkflowRun.get(run.id)).toEqual(run)
        expect(await TaskQueue.list()).toEqual([])
      },
    })
  })

  test("stays behind AX_CODE_WORKFLOW_RUNTIME", async () => {
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    try {
      delete process.env.AX_CODE_WORKFLOW_RUNTIME
      await expect(WorkflowScheduler.start(WorkflowRunID.ascending())).rejects.toThrow(WorkflowSchedulerDisabledError)
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("advances sequential multi-phase noop workflows in order", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "multi-noop",
              name: "Multi Noop",
              description: "Two sequential noop phases for multi-phase advancement coverage (BP-13).",
              phases: [
                { id: "phase-a", name: "Phase A", kind: "noop" },
                { id: "phase-b", name: "Phase B", kind: "noop", dependsOn: ["phase-a"] },
              ],
            }),
          })
          const result = await WorkflowScheduler.start(run.id)
          expect(result.status).toBe("completed")
          expect(result.phases).toHaveLength(2)
          expect(result.phases.map((phase) => phase.status)).toEqual(["completed", "completed"])
          expect(result.phases.map((phase) => phase.specPhaseID)).toEqual(["phase-a", "phase-b"])
          // Both phases produced summary artifacts — proves the scheduler
          // advanced past phase-a rather than stopping after the first.
          const phaseSummaries = result.artifacts.filter(
            (artifact) =>
              artifact.kind === "summary" &&
              typeof artifact.summary === "string" &&
              artifact.summary.includes("Noop phase completed"),
          )
          expect(phaseSummaries.length).toBeGreaterThanOrEqual(2)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("runs a noop workflow to completion without queueing children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
          const result = await WorkflowScheduler.start(run.id)

          expect(result.status).toBe("completed")
          expect(result.phases[0]?.status).toBe("completed")
          expect(result.artifacts.some((artifact) => artifact.kind === "summary")).toBe(true)
          expect(result.artifacts.find((artifact) => artifact.specArtifactID === "phase-prompt-noop")).toMatchObject({
            kind: "log",
            exposeToMainContext: false,
            payload: {
              kind: "phase-prompt-summary",
              specPhaseID: "noop",
              promptSummary: "Return a deterministic dry-run summary without using tools.",
            },
          })
          const finalReport = result.artifacts.find(
            (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
          )
          expect(finalReport).toMatchObject({
            kind: "summary",
            exposeToMainContext: true,
          })
          expect(finalReport?.summary).toContain("Verification: not_run (optional)")
          expect(finalReport?.summary).toContain("Evidence refs: artifact:wfa_")
          expect(finalReport?.summary).toContain("Eval decision: promote.")
          expect(finalReport?.summary).toContain("Budget limits: tokens 100000")
          expect(finalReport?.summary).toContain("Pacing: requests/min 12, tokens/min 200000.")
          expect(finalReport?.evidenceRefs).toHaveLength(2)
          expect(finalReport?.payload).toMatchObject({
            budgetLimit: {
              maxTotalTokens: 100_000,
              maxConcurrentAgents: 3,
              maxTotalAgents: 25,
            },
            pacing: {
              maxRequestsPerMinute: 12,
              maxTokensPerMinute: 200_000,
            },
            evidenceRefs: [
              expect.objectContaining({ kind: "artifact" }),
              expect.objectContaining({ kind: "artifact" }),
            ],
            verification: {
              mode: "optional",
              status: "not_run",
              requiredArtifactIds: [],
              verificationEnvelopeCount: 0,
            },
            evaluation: {
              decision: "promote",
              metrics: {
                verifiedCompletionCount: 1,
              },
            },
          })
          expect(result.children).toEqual([])
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toEqual([])
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("syncs a compact final report into the parent session once", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const run = await WorkflowRun.create({
            parentSessionID: session.id,
            spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun),
          })

          await WorkflowScheduler.start(run.id)

          let messages = await Session.messages({ sessionID: session.id })
          let reportParts = workflowFinalReportParts(messages, run.id)
          expect(reportParts).toHaveLength(1)
          const report = reportParts[0]
          if (!report || report.type !== "text") throw new Error("expected workflow final report text part")
          expect(report.text).toContain("Workflow final report: Noop Dry Run")
          expect(report.text).toContain("Final artifact: wfa_")
          expect(report.text).toContain("Linked evidence refs: artifact:wfa_")
          expect(report.text).toContain("Eval decision: promote.")
          expect(report.text).toContain("Budget limits: tokens 100000")
          expect(report.text).toContain("Pacing: requests/min 12, tokens/min 200000.")
          expect(report.text).toContain("Budget used: 0 tokens, 0 tool calls, 0 child agents.")
          expect(report.text).not.toContain("Noop phase completed")
          expect(report.metadata?.workflowFinalReport).toMatchObject({
            schemaVersion: 1,
            runID: run.id,
            status: "completed",
            specID: "noop-dry-run",
          })

          const anchors = messages.flatMap((message) =>
            message.parts.filter(
              (part) =>
                part.type === "text" &&
                (part.metadata?.workflowFinalReportAnchor as { runID?: unknown } | undefined)?.runID === run.id,
            ),
          )
          expect(anchors).toHaveLength(1)
          const anchor = anchors[0]
          if (!anchor || anchor.type !== "text") throw new Error("expected workflow final report anchor text part")
          expect(anchor.synthetic).toBe(true)
          expect(anchor.ignored).toBe(true)

          await WorkflowRun.ensureFinalReportArtifact(run.id)
          messages = await Session.messages({ sessionID: session.id })
          reportParts = workflowFinalReportParts(messages, run.id)
          expect(reportParts).toHaveLength(1)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("includes verification envelope ids in final report evidence refs", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
          const detail = await WorkflowRun.getDetail(run.id)
          const phase = detail.phases[0]!
          await WorkflowRun.setStatus({ id: run.id, status: "running" })
          await WorkflowRun.setPhaseStatus({ id: phase.id, status: "completed" })
          await WorkflowRun.attachVerificationEnvelopeIDs({
            id: run.id,
            envelopeIDs: ["0123456789abcdef"],
          })
          await WorkflowRun.setStatus({ id: run.id, status: "completed" })

          const finalReport = await WorkflowRun.ensureFinalReportArtifact(run.id)

          expect(finalReport?.summary).toContain("Evidence refs: verification:0123456789abcdef.")
          expect(finalReport?.evidenceRefs).toEqual([{ kind: "verification", id: "0123456789abcdef" }])
          expect(finalReport?.payload).toMatchObject({
            evidenceRefs: [{ kind: "verification", id: "0123456789abcdef" }],
            verificationEnvelopeIDs: ["0123456789abcdef"],
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("states deferred verification plan and unresolved risk in the final report", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "deferred-final-report",
            name: "Deferred Final Report",
            description: "A workflow that must state deferred verification risk.",
            verification: {
              mode: "deferred",
              commands: ["bun test test/workflow/spec.test.ts"],
            },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const result = await WorkflowScheduler.start(run.id)
          const finalReport = result.artifacts.find(
            (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
          )

          expect(result.status).toBe("completed")
          expect(finalReport?.summary).toContain("Verification: deferred (deferred)")
          expect(finalReport?.summary).toContain("Deferred verification plan: bun test test/workflow/spec.test.ts.")
          expect(finalReport?.summary).toContain("Unresolved risk: verification is deferred")
          expect(finalReport?.payload).toMatchObject({
            verification: {
              mode: "deferred",
              status: "deferred",
              commands: ["bun test test/workflow/spec.test.ts"],
            },
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("states skipped verification reason in the final report", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "skipped-final-report",
            name: "Skipped Final Report",
            description: "A workflow that must state why verification was skipped.",
            verification: {
              mode: "skipped",
              reason: "read-only exploratory pass with no candidate fix",
            },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const result = await WorkflowScheduler.start(run.id)
          const finalReport = result.artifacts.find(
            (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
          )

          expect(result.status).toBe("completed")
          expect(finalReport?.summary).toContain("Verification: skipped (skipped)")
          expect(finalReport?.summary).toContain(
            "Verification skipped reason: read-only exploratory pass with no candidate fix.",
          )
          expect(finalReport?.payload).toMatchObject({
            verification: {
              mode: "skipped",
              status: "skipped",
              reason: "read-only exploratory pass with no candidate fix",
            },
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("blocks completion when required verification artifacts are missing", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "verification-gated-noop",
            name: "Verification Gated Noop",
            description: "A fixture that cannot complete without its declared verification artifact.",
            artifacts: [{ id: "verification-summary", kind: "verification" }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const result = await WorkflowScheduler.start(run.id)

          expect(result.status).toBe("blocked")
          expect(result.error).toContain("missing required workflow artifacts: verification-summary")
          expect(result.phases[0]?.status).toBe("completed")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("blocks completion when required verification envelope payloads fail", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "failed-verification-envelope",
            name: "Failed Verification Envelope",
            description: "A fixture that cannot complete with failed verification envelope evidence.",
            artifacts: [{ id: "verification-summary", kind: "verification" }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const detail = await WorkflowRun.getDetail(run.id)
          await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: detail.phases[0]!.id,
            specArtifactID: "verification-summary",
            kind: "verification",
            summary: "typecheck failed",
            payload: {
              verificationEnvelopes: [{ envelope: verificationEnvelope(run.id, "failed", false) }],
            },
          })

          const result = await WorkflowRun.setStatus({ id: run.id, status: "completed" })

          expect(result.status).toBe("blocked")
          expect(result.error).toContain("verification envelopes did not pass")
          expect(result.error).toContain("verification-summary:typecheck:failed")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("blocks completion when required verification artifacts have no passing envelope evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "missing-verification-envelope",
            name: "Missing Verification Envelope",
            description: "A fixture that cannot complete with a bare verification artifact.",
            artifacts: [{ id: "verification-summary", kind: "verification" }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const detail = await WorkflowRun.getDetail(run.id)
          await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: detail.phases[0]!.id,
            specArtifactID: "verification-summary",
            kind: "verification",
            summary: "verification summary without envelope",
            payload: { summary: "checked manually" },
          })

          const result = await WorkflowRun.setStatus({ id: run.id, status: "completed" })

          expect(result.status).toBe("blocked")
          expect(result.error).toContain("missing passing verification envelope evidence: verification-summary")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("blocks completion when attached verification envelope ids cannot be resolved", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "unknown-verification-envelope",
            name: "Unknown Verification Envelope",
            description: "A fixture that cannot complete with an invented envelope id.",
            artifacts: [{ id: "verification-summary", kind: "verification" }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ parentSessionID: session.id, spec })
          const detail = await WorkflowRun.getDetail(run.id)
          await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: detail.phases[0]!.id,
            specArtifactID: "verification-summary",
            kind: "verification",
            summary: "verification summary without resolvable envelope",
            payload: { summary: "checked manually" },
          })
          await WorkflowRun.attachVerificationEnvelopeIDs({ id: run.id, envelopeIDs: ["0123456789abcdef"] })

          const result = await WorkflowRun.setStatus({ id: run.id, status: "completed" })

          expect(result.status).toBe("blocked")
          expect(result.error).toContain("missing passing verification envelope evidence")
          expect(result.error).toContain("verification envelope 0123456789abcdef")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("allows completion when attached verification envelope ids resolve to passed parent-session evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "attached-verification-envelope",
            name: "Attached Verification Envelope",
            description: "A fixture that completes with a passed envelope id from the parent session.",
            artifacts: [{ id: "verification-summary", kind: "verification" }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ parentSessionID: session.id, spec })
          const envelope = verificationEnvelope(run.id, "passed", true)
          await recordVerificationEnvelope(session.id, envelope)
          const detail = await WorkflowRun.getDetail(run.id)
          await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: detail.phases[0]!.id,
            specArtifactID: "verification-summary",
            kind: "verification",
            summary: "verification summary linked to parent envelope",
            payload: { summary: "see attached envelope id" },
          })
          await WorkflowRun.attachVerificationEnvelopeIDs({ id: run.id, envelopeIDs: [computeEnvelopeId(envelope)] })

          const result = await WorkflowRun.setStatus({ id: run.id, status: "completed" })

          expect(result.status).toBe("completed")
          expect(result.error).toBeUndefined()
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("allows completion when required verification artifacts contain passing envelope evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "passed-verification-envelope",
            name: "Passed Verification Envelope",
            description: "A fixture that can complete with passing verification envelope evidence.",
            artifacts: [{ id: "verification-summary", kind: "verification" }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const detail = await WorkflowRun.getDetail(run.id)
          await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: detail.phases[0]!.id,
            specArtifactID: "verification-summary",
            kind: "verification",
            summary: "typecheck passed",
            payload: {
              verificationEnvelopes: [{ envelope: verificationEnvelope(run.id, "passed", true) }],
            },
          })

          const result = await WorkflowRun.setStatus({ id: run.id, status: "completed" })

          expect(result.status).toBe("completed")
          expect(result.error).toBeUndefined()
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("blocks completion when required synthesis artifacts are missing", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "synthesis-gated-noop",
            name: "Synthesis Gated Noop",
            description: "A fixture that cannot complete without its declared final synthesis artifact.",
            artifacts: [{ id: "final-summary", kind: "summary" }],
            synthesis: { requiredArtifactIds: ["final-summary"] },
            phases: [{ id: "noop", name: "Noop", kind: "noop" }],
          })
          const run = await WorkflowRun.create({ spec })
          const result = await WorkflowScheduler.start(run.id)

          expect(result.status).toBe("blocked")
          expect(result.error).toContain("missing required workflow artifacts: final-summary")
          expect(result.phases[0]?.status).toBe("completed")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("rejects custom reducer placeholders before queueing workflow children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "custom-reducer-placeholder",
            name: "Custom Reducer Placeholder",
            description: "A fixture that can be saved but cannot execute custom reducer code.",
            phases: [
              {
                id: "reduce",
                name: "Reduce",
                kind: "synthesis",
                mergeStrategy: "custom-reducer",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })

          await expect(WorkflowScheduler.start(run.id)).rejects.toThrow(WorkflowUnsupportedMergeStrategyError)
          expect((await WorkflowRun.getDetail(run.id)).status).toBe("queued")
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toEqual([])
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("bridges the first executable phase into TaskQueue subagent items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            sourceTaskID: "scheduled_task_issue_triage",
            spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage),
          })
          const result = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            autoStartChildren: false,
          })

          expect(result.status).toBe("running")
          expect(result.phases[0]?.status).toBe("running")
          expect(result.phases[1]?.status).toBe("queued")
          expect(result.children).toHaveLength(8)
          expect(result.children.every((child) => child.taskQueueID?.startsWith("tsk_"))).toBe(true)
          expect(result.children.every((child) => child.sessionID?.startsWith("ses_"))).toBe(true)
          expect(result.budgetUsage.childAgents).toBe(8)
          expect(
            result.artifacts.find((artifact) => artifact.specArtifactID === "phase-prompt-collect-issues"),
          ).toMatchObject({
            kind: "log",
            exposeToMainContext: false,
            payload: {
              kind: "phase-prompt-summary",
              specPhaseID: "collect-issues",
              maxParallel: 8,
              estimatedChildren: 8,
            },
          })

          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(8)
          expect(queue.every((item) => item.kind === "subagent")).toBe(true)
          expect(queue.every((item) => item.sessionID?.startsWith("ses_"))).toBe(true)
          expect(queue.every((item) => item.directory === tmp.path)).toBe(true)
          expect(queue.every((item) => item.sourceTaskID === "scheduled_task_issue_triage")).toBe(true)
          expect(queue[0]?.payload.workflow).toMatchObject({
            runID: run.id,
            phaseID: result.phases[0]?.id,
            specPhaseID: "collect-issues",
          })
          expect(queue[0]?.payload.artifactRefs).toEqual([])
          expect(queue[0]?.payload.pacing).toEqual({
            maxRequestsPerMinute: 12,
            maxTokensPerMinute: 200_000,
          })
          expect(queue[0]?.payload.maxParallel).toBe(8)
          expect(queue[0]?.payload.escalationPolicy).toBe("ask")
          expect(WorkflowTaskQueue.readPayload(queue[0]!.payload)).toMatchObject({
            artifactRefs: [],
            worktree: { mode: "current", directory: tmp.path },
            allowedTools: ["github.issue.view"],
            writePolicy: "read-only",
            networkPolicy: "inherit",
            escalationPolicy: "ask",
          })
          expect(queue[0]?.payload.budgetSlice).toMatchObject({
            maxInputTokensPerChild: 50_000,
            maxOutputTokensPerChild: 8_000,
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("start on a paused run resumes it instead of leaving paused children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage),
          })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const paused = await WorkflowScheduler.pause(run.id)
          expect(paused.status).toBe("paused")
          expect(paused.children.every((child) => child.status === "paused")).toBe(true)

          // start() on a paused run used to set it running and return at the
          // existing-children guard, leaving every child paused forever.
          const resumed = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

          expect(resumed.status).toBe("running")
          expect(resumed.phases[0]?.status).toBe("running")
          expect(resumed.children.some((child) => child.status === "paused")).toBe(false)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("queues worktree-required child agents in dedicated worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    let dedicatedWorktree: string | undefined
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "isolated-write-runtime",
            name: "Isolated Write Runtime",
            description: "A write workflow that must queue its child inside a dedicated worktree.",
            permissions: {
              writePolicy: "worktree-required",
            },
            budget: {
              maxConcurrentAgents: 1,
              maxTotalAgents: 1,
            },
            phases: [
              {
                id: "edit",
                name: "Edit",
                kind: "sequential",
                prompt: "Make the isolated edit.",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          const result = await WorkflowScheduler.start(run.id, { allowWriteWorkflows: true })

          expect(result.status).toBe("running")
          expect(result.children).toHaveLength(1)

          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(1)
          const item = queue[0]!
          // The child's runtime directory is the queue row's own directory:
          // worktree-required children are enqueued inside an instance bound to
          // the dedicated worktree, so no separate worktree field is needed.
          const itemDirectory = item.directory
          dedicatedWorktree = itemDirectory
          const itemDirectoryReal = await fs.realpath(itemDirectory)
          const parentReal = await fs.realpath(tmp.path)
          expect(itemDirectoryReal).not.toBe(parentReal)
          expect(item.payload.writePolicy).toBe("worktree-required")
          const payloadWorktree = WorkflowTaskQueue.readPayload(item.payload)?.worktree
          expect(payloadWorktree).toMatchObject({ mode: "dedicated" })
          // Compare resolved paths: the row's directory is normalized while the
          // payload keeps the raw worktree path.
          expect(await fs.realpath(payloadWorktree!.directory)).toBe(itemDirectoryReal)

          const childSessionID = result.children[0]?.sessionID
          expect(childSessionID).toBeDefined()
          const childSession = await Session.get(childSessionID!)
          expect(await fs.realpath(childSession.directory)).toBe(itemDirectoryReal)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
      if (dedicatedWorktree) {
        const directory = dedicatedWorktree
        await Instance.provide({
          directory: tmp.path,
          fn: () => Worktree.remove({ directory }),
        }).catch(() => undefined)
      }
    }
  })

  test("stops active workflow runs before advancing when wall-time budget is exceeded", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "wall-time-stop",
            name: "Wall Time Stop",
            description: "A fixture that must not enqueue children after wall time expires.",
            budget: {
              maxWallTimeMs: 10,
              maxConcurrentAgents: 3,
              maxTotalAgents: 3,
            },
            phases: [
              {
                id: "scan",
                name: "Scan",
                kind: "fanout",
                inputs: ["a", "b"],
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowRun.setStatus({ id: run.id, status: "running" })
          setWorkflowRunStartedAt(run.id, Date.now() - 1_000)

          const result = await WorkflowScheduler.start(run.id)

          expect(result.status).toBe("failed")
          expect(result.error).toContain("wall time")
          expect(result.budgetLedger.some((entry) => entry.kind === "exceeded")).toBe(true)
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toEqual([])
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("does not duplicate children when starting an active queued phase again", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const firstStart = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            autoStartChildren: false,
          })
          const secondStart = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            autoStartChildren: false,
          })

          expect(firstStart.children).toHaveLength(8)
          expect(secondStart.children).toHaveLength(8)
          expect(secondStart.children.map((child) => child.id)).toEqual(firstStart.children.map((child) => child.id))

          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toHaveLength(8)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("registers a durable phase once across linked worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    const linked = path.join(tmp.path, "linked")
    execFileSync("git", ["worktree", "add", "--detach", linked], { cwd: tmp.path })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const projectID = Instance.project.id
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "parallel-start",
              name: "Parallel startup",
              description: "A durable phase is registered only once.",
              phases: [{ id: "read", name: "Read", kind: "sequential", prompt: "Offline fixture." }],
            }),
          })
          const setStatus = WorkflowRun.setStatus
          const rendezvous = Promise.withResolvers<void>()
          let arrivals = 0
          vi.spyOn(WorkflowRun, "setStatus").mockImplementation(async (...args) => {
            if (args[0].status === "running") {
              if (++arrivals === 2) rendezvous.resolve()
              await rendezvous.promise
            }
            return setStatus(...args)
          })
          const first = WorkflowScheduler.start(run.id, { autoStartChildren: false })
          const second = Instance.provide({
            directory: linked,
            fn: async () => {
              expect(Instance.project.id).toBe(projectID)
              return WorkflowScheduler.start(run.id, { autoStartChildren: false })
            },
          })
          const results = await Promise.all([first, second])

          const detail = await WorkflowRun.getDetail(run.id)
          expect(detail.children).toHaveLength(1)
          expect(await TaskQueue.list()).toHaveLength(1)
          expect(detail.budgetUsage.childAgents).toBe(1)
          expect(detail.artifacts.filter((artifact) => artifact.specArtifactID === "phase-prompt-read")).toHaveLength(1)
          expect(results.map((result) => result.children.map((child) => child.id))).toEqual([
            [detail.children[0]?.id],
            [detail.children[0]?.id],
          ])
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await Instance.disposeAll()
      execFileSync("git", ["worktree", "remove", linked], { cwd: tmp.path })
    }
  })

  test("advances a workflow while another run in the same project prepares a phase", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "independent-phase-setup",
            name: "Independent phase setup",
            description: "A preparation in one run must not block another run from advancing.",
            phases: [
              { id: "first", name: "First", kind: "sequential", prompt: "Offline fixture." },
              { id: "next", name: "Next", kind: "sequential", dependsOn: ["first"], prompt: "Offline fixture." },
            ],
          })
          const advancing = await WorkflowRun.create({ spec })
          const blocked = await WorkflowRun.create({ spec })
          const started = await WorkflowScheduler.start(advancing.id, { autoStartChildren: false })
          const taskID = started.children[0]?.taskQueueID
          if (!taskID) throw new Error("Expected a task in the first phase.")

          const entered = Promise.withResolvers<void>()
          const release = Promise.withResolvers<void>()
          const createSession = Session.create
          vi.spyOn(Session, "create").mockImplementationOnce(async (input) => {
            entered.resolve()
            await release.promise
            return createSession(input)
          })
          const acquire = FileLock.acquire
          vi.spyOn(FileLock, "acquire").mockImplementation((file, options) =>
            acquire(file, { ...options, timeoutMs: 100 }),
          )
          const preparation = WorkflowScheduler.start(blocked.id, { autoStartChildren: false })
          try {
            await Promise.race([
              entered.promise,
              preparation.then(() => {
                throw new Error("Expected the other run to wait during session creation.")
              }),
            ])
            await TaskQueue.setStatus({ id: taskID, status: "completed" })
            const advanced = await WorkflowRun.getDetail(advancing.id)
            expect(advanced.phases.map((phase) => phase.status)).toEqual(["completed", "running"])
            expect(advanced.children).toHaveLength(2)
          } finally {
            release.resolve()
            await preparation
          }
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  test.each(["read-only", "worktree-required"] as const)(
    "retries %s phase setup in the original workspace without duplicating resources",
    async (writePolicy) => {
      await using tmp = await tmpdir({ git: true })
      await using linked = await tmpdir()
      execFileSync("git", ["worktree", "add", "--detach", linked.path], { cwd: tmp.path, stdio: "pipe" })
      execFileSync("git", ["commit", "--allow-empty", "-m", "Different checkout base"], { cwd: linked.path })
      const originalHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmp.path, encoding: "utf8" })
      vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const run = await WorkflowRun.create({
              spec: parseWorkflowSpecV1({
                schemaVersion: 1,
                id: "interrupted-phase-setup",
                name: "Interrupted setup",
                description: "Child preparation may fail before a phase is admitted.",
                permissions: { writePolicy },
                phases: [{ id: "read", name: "Read", kind: "fanout", inputs: ["a", "b"], maxParallel: 2 }],
              }),
            })
            const startOptions = { allowWriteWorkflows: true, autoStartChildren: false }
            const create = Session.create
            const spy = vi.spyOn(Session, "create").mockImplementationOnce(async (...args) => {
              await create(...args)
              throw new Error("preparation interrupted")
            })
            await expect(WorkflowScheduler.start(run.id, startOptions)).rejects.toThrow("preparation interrupted")
            spy.mockRestore()
            const partial = await WorkflowRun.getDetail(run.id)
            expect(partial.phases[0]?.status).toBe("queued")
            expect(partial.children).toHaveLength(0)
            expect(partial.budgetUsage.childAgents).toBe(0)
            expect(await TaskQueue.list()).toHaveLength(0)

            const worktree = (await Worktree.list()).find((item) => item.directory !== linked.path)
            const note = worktree ? path.join(worktree.directory, "local-notes.txt") : undefined
            if (note) await fs.writeFile(note, "Notes added after interruption")

            const retried = await Instance.provide({
              directory: linked.path,
              fn: () => WorkflowScheduler.start(run.id, startOptions),
            })
            expect(retried.children).toHaveLength(2)
            expect(retried.budgetUsage.childAgents).toBe(2)
            const tasks = await TaskQueue.list()
            expect(tasks).toHaveLength(2)
            for (const task of tasks) {
              if (writePolicy === "read-only") expect(task.directory).toBe(tmp.path)
              else
                expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: task.directory, encoding: "utf8" })).toBe(
                  originalHead,
                )
            }
            expect([...Session.list()].map((session) => session.id).sort()).toEqual(
              retried.children.map((child) => child.sessionID).sort(),
            )
            const preparedWorktrees = (await Worktree.list()).filter((item) => item.directory !== linked.path)
            expect(preparedWorktrees).toHaveLength(writePolicy === "worktree-required" ? 2 : 0)
            if (note) expect(await fs.readFile(note, "utf8")).toBe("Notes added after interruption")
          },
        })
      } finally {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            for (const worktree of await Worktree.list()) await Worktree.remove({ directory: worktree.directory })
          },
        })
      }
    },
  )

  test("resumes a dedicated worktree after an interruption before bootstrap", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "original")
    execFileSync("git", ["add", "tracked.txt"], { cwd: tmp.path })
    execFileSync("git", ["commit", "-m", "Add tracked fixture"], { cwd: tmp.path })
    await fs.writeFile(path.join(tmp.path, ".git", "hooks", "post-checkout"), "#!/bin/sh\ntouch checkout-hook-ran\n", {
      mode: 0o755,
    })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "interrupted-worktree",
              name: "Interrupted worktree",
              description: "A retry can continue a worktree already created by Git.",
              permissions: { writePolicy: "worktree-required" },
              phases: [{ id: "edit", name: "Edit", kind: "sequential", prompt: "Offline fixture." }],
            }),
          })
          const create = Worktree.createFromInfo
          const spy = vi.spyOn(Worktree, "createFromInfo").mockImplementationOnce(async (...args) => {
            await create(...args)
            throw new Error("interrupted before bootstrap")
          })
          const options = { allowWriteWorkflows: true, autoStartChildren: false }
          await expect(WorkflowScheduler.start(run.id, options)).rejects.toThrow("interrupted before bootstrap")
          spy.mockRestore()
          expect(await TaskQueue.list()).toHaveLength(0)
          const [original] = await Worktree.list()
          const edited = path.join(original.directory, "tracked.txt")
          expect(await fs.readFile(edited, "utf8")).toBe("original")
          await expect(fs.stat(path.join(original.directory, "checkout-hook-ran"))).rejects.toMatchObject({
            code: "ENOENT",
          })
          await fs.writeFile(edited, "staged edit")
          execFileSync("git", ["add", "tracked.txt"], { cwd: original.directory })
          await fs.writeFile(edited, "local edit during interruption")

          const owner = `branch.${original.branch}.axCodeOwned`
          execFileSync("git", ["config", "--unset", owner], { cwd: tmp.path })
          await expect(WorkflowScheduler.start(run.id, options)).rejects.toThrow(
            "Cannot verify ownership of the prepared worktree",
          )
          expect(await Worktree.list()).toEqual([original])
          expect(await TaskQueue.list()).toHaveLength(0)
          execFileSync("git", ["config", owner, original.branch!], { cwd: tmp.path })

          const retried = await WorkflowScheduler.start(run.id, options)
          expect(retried.children).toHaveLength(1)
          expect(await Worktree.list()).toEqual([original])
          const [item] = await TaskQueue.list()
          expect(item.directory).toBe(await fs.realpath(original.directory))
          expect(execFileSync("git", ["show", ":tracked.txt"], { cwd: item.directory, encoding: "utf8" })).toBe(
            "staged edit",
          )
          expect(await fs.readFile(path.join(item.directory, "tracked.txt"), "utf8")).toBe(
            "local edit during interruption",
          )
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          for (const worktree of await Worktree.list()) await Worktree.remove({ directory: worktree.directory })
        },
      })
    }
  })

  test("rejects a phase that exceeds the remaining child budget without charging the rejected batch", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "phase-admission-budget",
              name: "Phase admission budget",
              description: "Admission charges only committed child reservations.",
              budget: { maxTotalAgents: 3 },
              phases: [{ id: "read", name: "Read", kind: "fanout", inputs: ["a", "b"], maxParallel: 2 }],
            }),
          })
          await WorkflowRun.appendBudgetUsage({ runID: run.id, kind: "reserve", usageDelta: { childAgents: 2 } })

          const stopped = await WorkflowScheduler.start(run.id, { autoStartChildren: false })
          expect(stopped.status).toBe("failed")
          expect(stopped.phases[0]?.status).toBe("failed")
          expect(stopped.children).toHaveLength(0)
          expect(await TaskQueue.list()).toHaveLength(0)
          expect([...Session.list()]).toHaveLength(0)
          expect(stopped.budgetUsage.childAgents).toBe(2)
          expect(stopped.budgetLedger).toContainEqual(
            expect.objectContaining({
              kind: "exceeded",
              message: expect.stringContaining("child agents 4/3"),
              usageDelta: expect.objectContaining({ childAgents: 0 }),
            }),
          )
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("dispatches an admitted batch after the original starter exits before starting it", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "interrupted-dispatch",
              name: "Interrupted dispatch",
              description: "Resume dispatch from the committed phase batch.",
              phases: [{ id: "read", name: "Read", kind: "fanout", inputs: ["a", "b"], maxParallel: 2 }],
            }),
          })
          const { TaskQueueExecutor } = await import("../../src/session/task-queue-executor")
          const start = vi.spyOn(TaskQueueExecutor, "start").mockRejectedValueOnce(new Error("dispatch interrupted"))
          await expect(WorkflowScheduler.start(run.id)).rejects.toThrow("dispatch interrupted")

          const queued = await TaskQueue.list()
          expect(queued).toHaveLength(2)
          expect(queued.every((item) => item.status === "queued")).toBe(true)
          start.mockClear().mockImplementation(async (item) => item)
          const recovered = await WorkflowScheduler.start(run.id)
          expect(start.mock.calls.map(([item]) => item.id)).toEqual(queued.map((item) => item.id))
          expect(recovered.budgetUsage.childAgents).toBe(2)
          expect(recovered.children).toHaveLength(2)
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  test("does not duplicate children when starting the same queued phase concurrently", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const [firstStart, secondStart] = await Promise.all([
            WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false }),
            WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false }),
          ])

          const detail = await WorkflowRun.getDetail(run.id)
          expect(firstStart.children).toHaveLength(8)
          expect(secondStart.children).toHaveLength(8)
          expect(detail.children).toHaveLength(8)

          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toHaveLength(8)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("executes workflow subagent queue payloads through TaskQueueExecutor", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const { TaskQueueExecutor } = await import("../../src/session/task-queue-executor")
          const { SessionPrompt } = await import("../../src/session/prompt")
          const [first] = await TaskQueue.list()
          expect(first?.sessionID).toStartWith("ses_")
          const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockResolvedValue({
            info: {
              id: "msg_workflow_child",
              role: "assistant",
              tokens: { input: 11, output: 7, total: 18 },
            },
            parts: [
              { type: "text", text: "Workflow child output with linked evidence." },
              { type: "tool", tool: "bash" },
            ],
          } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>)

          try {
            const edited = await TaskQueue.edit({
              id: first!.id,
              payload: {
                ...first!.payload,
                body: {
                  parts: [{ type: "text", text: "Record this workflow child without model execution." }],
                  noReply: true,
                  agentRouting: "preserve",
                },
              },
            })

            const running = await TaskQueueExecutor.start(edited)
            expect(running.status).toBe("running")
            await waitForValue("workflow queue completion", async () => {
              const item = await TaskQueue.get(first!.id)
              return item.status === "completed" ? item : undefined
            })
          } finally {
            promptSpy.mockRestore()
          }

          const detail = await WorkflowRun.getDetail(run.id)
          const child = detail.children.find((candidate) => candidate.taskQueueID === first!.id)
          expect(child?.status).toBe("completed")
          expect(child?.sessionID).toBe(first?.sessionID)
          expect(child?.artifactIDs.length).toBeGreaterThan(0)
          expect(child?.evidenceRefs).toContainEqual({ kind: "artifact", id: child!.artifactIDs[0]! })
          const linkedArtifacts = detail.artifacts.filter((artifact) => child?.artifactIDs.includes(artifact.id))
          expect(linkedArtifacts).toHaveLength(child!.artifactIDs.length)
          expect(linkedArtifacts.some((artifact) => artifact.kind === "summary")).toBe(true)
          expect(linkedArtifacts.every((artifact) => artifact.childID === child?.id)).toBe(true)
          expect(detail.phases[0]?.status).toBe("running")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("syncs TaskQueue lifecycle back into workflow child and phase state", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const started = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            autoStartChildren: false,
          })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const [first] = await TaskQueue.list()
          expect(first).toBeDefined()

          await TaskQueue.setStatus({ id: first!.id, status: "running" })
          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("running")

          await TaskQueue.setStatus({ id: first!.id, status: "blocked_permission", error: "approval required" })
          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("blocked")
          expect(detail.phases[0]?.status).toBe("blocked")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("blocked_permission")

          await TaskQueue.setStatus({ id: first!.id, status: "running" })
          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.children).toHaveLength(started.children.length)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("advances to the next phase after all queued workflow children complete", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const firstPhaseQueue = await TaskQueue.list()

          for (const item of firstPhaseQueue) {
            await TaskQueue.setStatus({ id: item.id, status: "completed" })
          }

          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.phases[1]?.status).toBe("running")
          expect(detail.children).toHaveLength(firstPhaseQueue.length + 1)

          const nextQueue = (await TaskQueue.list()).filter((item) => item.status === "queued")
          expect(nextQueue).toHaveLength(1)
          expect(nextQueue[0]?.payload.workflow).toMatchObject({
            runID: run.id,
            phaseID: detail.phases[1]?.id,
            specPhaseID: "synthesize-triage",
          })
          expect(nextQueue[0]?.payload.artifactRefs).toEqual(["issue-table"])

          await TaskQueue.setStatus({ id: nextQueue[0]!.id, status: "completed" })
          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("completed")
          expect(detail.phases.every((phase) => phase.status === "completed")).toBe(true)
          expect(detail.children.every((child) => child.status === "completed")).toBe(true)
          const finalReport = detail.artifacts.find(
            (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
          )
          expect(finalReport).toMatchObject({
            kind: "summary",
            exposeToMainContext: true,
          })
          expect(finalReport?.summary).toContain("Workflow final report: Issue Triage")
          expect(finalReport?.summary).toContain("Verification: not_run (optional)")
          expect(finalReport?.summary).toContain("Redaction: none=0, redacted=0, pending=")
          expect(finalReport?.payload).toMatchObject({
            kind: "workflow-final-report",
            status: "completed",
            childCounts: { completed: detail.children.length },
            verification: {
              mode: "optional",
              status: "not_run",
              requiredArtifactIds: [],
              verificationEnvelopeCount: 0,
            },
          })
          const finalPayload = finalReport?.payload as
            | {
                budgetLedger?: Array<{ kind: string; usageDelta?: { childAgents?: number } }>
                redactionSummary?: {
                  counts?: { none?: number; redacted?: number; pending?: number }
                  summaries?: string[]
                }
              }
            | undefined
          expect(Array.isArray(finalPayload?.budgetLedger)).toBe(true)
          expect(finalPayload?.budgetLedger).toHaveLength(detail.budgetLedger.length)
          expect(finalPayload?.budgetLedger?.some((entry) => entry.kind === "reserve")).toBe(true)
          expect(finalPayload?.budgetLedger?.some((entry) => entry.usageDelta?.childAgents === 1)).toBe(true)
          expect(finalPayload?.redactionSummary?.counts?.pending).toBeGreaterThan(0)
          expect(finalPayload?.redactionSummary?.summaries?.some((item) => item.includes("payload omitted"))).toBe(true)

          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const finalDetail = await WorkflowRun.getDetail(run.id)
          expect(
            finalDetail.artifacts.filter(
              (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
            ),
          ).toHaveLength(1)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("advances first-success queued phases and cancels superseded children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "first-success-queued",
            name: "First Success Queued",
            description: "A queued fan-out phase should advance after the first successful child.",
            budget: {
              maxConcurrentAgents: 3,
              maxTotalAgents: 4,
            },
            phases: [
              {
                id: "race",
                name: "Race",
                kind: "fanout",
                inputs: ["a", "b", "c"],
                maxParallel: 3,
                mergeStrategy: "first-success",
              },
              {
                id: "summarize",
                name: "Summarize",
                kind: "synthesis",
                dependsOn: ["race"],
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          const started = await WorkflowScheduler.start(run.id, { autoStartChildren: false })
          const firstPhase = started.phases[0]
          const secondPhase = started.phases[1]
          if (!firstPhase || !secondPhase) throw new Error("expected two workflow phases")

          const { TaskQueue } = await import("../../src/session/task-queue")
          const firstPhaseQueue = await TaskQueue.list()
          expect(firstPhaseQueue).toHaveLength(3)

          await TaskQueue.setStatus({ id: firstPhaseQueue[0]!.id, status: "completed" })
          const detail = await WorkflowRun.getDetail(run.id)
          expect(detail.phases[1]?.status).toBe("running")

          expect(detail.phases[0]?.status).toBe("completed")
          const firstPhaseChildren = detail.children.filter((child) => child.phaseID === firstPhase.id)
          expect(firstPhaseChildren.map((child) => child.status).sort()).toEqual([
            "cancelled",
            "cancelled",
            "completed",
          ])
          const queue = await TaskQueue.list()
          expect(
            queue
              .filter((item) => workflowSpecPhaseID(item) === "race")
              .map((item) => item.status)
              .sort(),
          ).toEqual(["cancelled", "cancelled", "completed"])
          expect(queue.filter((item) => workflowSpecPhaseID(item) === "summarize")).toHaveLength(1)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("completes durable first-success phases after the first child succeeds", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "durable-first-success",
            name: "Durable First Success",
            description: "A durable queue workflow that should finish as soon as one child succeeds.",
            phases: [
              {
                id: "search",
                name: "Search",
                kind: "fanout",
                inputs: ["a", "b", "c"],
                mergeStrategy: "first-success",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id)
          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(3)

          await TaskQueue.setStatus({ id: queue[0]!.id, status: "completed" })

          const detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("completed")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.children.filter((child) => child.status === "completed")).toHaveLength(1)
          expect(detail.children.filter((child) => child.status === "cancelled")).toHaveLength(2)
          expect((await TaskQueue.list()).filter((item) => item.status === "cancelled")).toHaveLength(2)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("completes durable majority phases once a majority succeeds", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "durable-majority",
            name: "Durable Majority",
            description: "A durable queue workflow that completes after a successful majority.",
            phases: [
              {
                id: "vote",
                name: "Vote",
                kind: "fanout",
                inputs: ["a", "b", "c"],
                mergeStrategy: "majority",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id)
          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(3)

          await TaskQueue.setStatus({ id: queue[0]!.id, status: "completed" })
          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")

          await TaskQueue.setStatus({ id: queue[1]!.id, status: "completed" })

          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("completed")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.children.filter((child) => child.status === "completed")).toHaveLength(2)
          expect(detail.children.filter((child) => child.status === "cancelled")).toHaveLength(1)
          expect((await TaskQueue.get(queue[2]!.id)).status).toBe("cancelled")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("waits for durable critic confirmation after majority succeeds", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "durable-critic-confirmation",
            name: "Durable Critic Confirmation",
            description: "A durable queue workflow that waits for the final critic child before merging.",
            phases: [
              {
                id: "vote",
                name: "Vote",
                kind: "fanout",
                inputs: ["worker-a", "worker-b", "critic"],
                mergeStrategy: "vote-with-critic",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id)
          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(3)
          const started = await WorkflowRun.getDetail(run.id)
          const criticChild = started.children.at(-1)
          const workerChildren = started.children.slice(0, -1)
          if (!criticChild?.taskQueueID || workerChildren.some((child) => !child.taskQueueID)) {
            throw new Error("expected queued critic and worker children")
          }

          await TaskQueue.setStatus({ id: workerChildren[0]!.taskQueueID!, status: "completed" })
          await TaskQueue.setStatus({ id: workerChildren[1]!.taskQueueID!, status: "completed" })

          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.children.filter((child) => child.status === "completed")).toHaveLength(2)
          expect((await TaskQueue.get(criticChild.taskQueueID)).status).not.toBe("completed")

          await TaskQueue.setStatus({ id: criticChild.taskQueueID, status: "completed" })

          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("completed")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.children.filter((child) => child.status === "completed")).toHaveLength(3)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("fails durable majority phases once a majority fails or cancels", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "durable-majority-failure",
            name: "Durable Majority Failure",
            description: "A durable queue workflow that fails after a failed majority.",
            phases: [
              {
                id: "vote",
                name: "Vote",
                kind: "fanout",
                inputs: ["a", "b", "c"],
                mergeStrategy: "majority",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id)
          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(3)

          await TaskQueue.setStatus({ id: queue[0]!.id, status: "failed", error: "first worker failed" })
          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")

          await TaskQueue.setStatus({ id: queue[1]!.id, status: "cancelled", error: "second worker cancelled" })

          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("failed")
          expect(detail.phases[0]?.status).toBe("failed")
          expect(
            detail.children.filter((child) => child.status === "failed" || child.status === "cancelled"),
          ).toHaveLength(2)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("cancels durable majority phases when every child is cancelled", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "durable-majority-cancelled",
            name: "Durable Majority Cancelled",
            description: "A durable queue workflow that should cancel when every child is cancelled.",
            phases: [
              {
                id: "vote",
                name: "Vote",
                kind: "fanout",
                inputs: ["a", "b", "c"],
                mergeStrategy: "majority",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id)
          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(3)

          await TaskQueue.setStatus({ id: queue[0]!.id, status: "cancelled", error: "first worker cancelled" })
          await TaskQueue.setStatus({ id: queue[1]!.id, status: "cancelled", error: "second worker cancelled" })
          await TaskQueue.setStatus({ id: queue[2]!.id, status: "cancelled", error: "third worker cancelled" })

          const detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("cancelled")
          expect(detail.phases[0]?.status).toBe("cancelled")
          expect(detail.children.every((child) => child.status === "cancelled")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("pauses and resumes queued workflow children without advancing future phases", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })

          const paused = await WorkflowScheduler.pause(run.id)
          expect(paused.status).toBe("paused")
          expect(paused.phases[0]?.status).toBe("paused")
          expect(paused.phases[1]?.status).toBe("queued")
          expect(paused.children.every((child) => child.status === "paused")).toBe(true)
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect((await TaskQueue.list()).every((item) => item.status === "paused")).toBe(true)

          const resumed = await WorkflowScheduler.resume(run.id)
          expect(resumed.status).toBe("running")
          expect(resumed.phases[0]?.status).toBe("running")
          expect(resumed.phases[1]?.status).toBe("queued")
          expect(resumed.children.every((child) => child.status === "queued")).toBe(true)
          expect((await TaskQueue.list()).every((item) => item.status === "queued")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("keeps a run paused when the paused running child's cancelled turn settles later", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "pause-running-child",
            name: "Pause Running Child",
            description: "Pausing a run with a running child keeps it paused.",
            budget: { maxConcurrentAgents: 2, maxTotalAgents: 3 },
            phases: [{ id: "work", name: "Work", kind: "fanout", inputs: ["a"], maxParallel: 1, mergeStrategy: "all" }],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id, { autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const [item] = await TaskQueue.list()
          await TaskQueue.setStatus({ id: item!.id, status: "running" })

          const paused = await WorkflowScheduler.pause(run.id)
          expect(paused.status).toBe("paused")
          // The executor drains the turn the pause cancelled.
          await TaskQueue.setStatus({
            id: item!.id,
            status: "failed",
            error: "Session was aborted before completing the task",
          })

          const after = await WorkflowRun.getDetail(run.id)
          expect(after.status).toBe("paused")
          expect(after.children[0]?.status).toBe("paused")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("keeps a run cancelled when the cancel lands while a child completion is syncing", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "cancel-mid-sync",
            name: "Cancel Mid Sync",
            description: "A cancel landing mid-sync stays authoritative.",
            budget: { maxConcurrentAgents: 2, maxTotalAgents: 3 },
            phases: [
              {
                id: "work",
                name: "Work",
                kind: "fanout",
                inputs: ["a", "b"],
                maxParallel: 2,
                mergeStrategy: "first-success",
              },
              { id: "summarize", name: "Summarize", kind: "synthesis", dependsOn: ["work"] },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id, { autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const detail = await WorkflowRun.getDetail(run.id)
          const first = detail.children.find((child) => child.phaseID === detail.phases[0]!.id)!
          const setChildStatus = WorkflowRun.setChildStatus
          let cancelled = false
          vi.spyOn(WorkflowRun, "setChildStatus").mockImplementation(async (input) => {
            const result = await setChildStatus(input)
            // The user's cancel lands right after the completed child is written.
            if (!cancelled && input.status === "completed") {
              cancelled = true
              await WorkflowScheduler.cancel(run.id)
            }
            return result
          })
          try {
            await TaskQueue.setStatus({ id: first.taskQueueID!, status: "completed" })
          } finally {
            vi.restoreAllMocks()
          }

          expect(cancelled).toBe(true)
          expect((await WorkflowRun.get(run.id)).status).toBe("cancelled")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("retries failed workflow queue children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const [first] = await TaskQueue.list()

          await TaskQueue.setStatus({ id: first!.id, status: "failed", error: "model failed" })
          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("failed")
          expect(detail.phases[0]?.status).toBe("failed")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("failed")

          detail = await WorkflowScheduler.retry(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.budgetUsage.retries).toBe(1)
          expect(detail.budgetLedger.some((entry) => entry.message === "Retry requested for workflow run.")).toBe(true)
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("queued")
          expect((await TaskQueue.get(first!.id)).status).toBe("queued")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("does not requeue workflow children after retry budget is exhausted", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const [first] = await TaskQueue.list()

          await TaskQueue.setStatus({ id: first!.id, status: "failed", error: "model failed" })
          await WorkflowScheduler.retry(run.id)
          expect((await TaskQueue.get(first!.id)).status).toBe("queued")

          await TaskQueue.setStatus({ id: first!.id, status: "failed", error: "model failed again" })
          const exhausted = await WorkflowScheduler.retry(run.id)

          expect(exhausted.status).toBe("failed")
          expect(exhausted.budgetUsage.retries).toBe(2)
          expect(exhausted.budgetLedger.some((entry) => entry.message?.includes("Retry requested"))).toBe(true)
          expect(exhausted.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("failed")
          expect((await TaskQueue.get(first!.id)).status).toBe("failed")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("retries only the selected failed workflow phase", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const firstPhaseQueue = await TaskQueue.list()
          for (const item of firstPhaseQueue) {
            await TaskQueue.setStatus({ id: item.id, status: "completed" })
          }

          let detail = await WorkflowRun.getDetail(run.id)
          const secondPhase = detail.phases[1]
          if (!secondPhase) throw new Error("expected second workflow phase")
          const [secondPhaseItem] = (await TaskQueue.list()).filter((item) => item.status === "queued")
          await TaskQueue.setStatus({ id: secondPhaseItem!.id, status: "failed", error: "synthesis failed" })

          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("failed")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.phases[1]?.status).toBe("failed")

          detail = await WorkflowScheduler.retryPhase(run.id, secondPhase.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.phases[1]?.status).toBe("running")
          const firstPhaseChildren = detail.children.filter((child) => child.phaseID === detail.phases[0]?.id)
          expect(firstPhaseChildren.every((child) => child.status === "completed")).toBe(true)
          expect(detail.children.find((child) => child.taskQueueID === secondPhaseItem!.id)?.status).toBe("queued")
          expect((await TaskQueue.get(secondPhaseItem!.id)).status).toBe("queued")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("workflow cancellation preserves a concurrent replacement child attempt", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const started = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            autoStartChildren: false,
          })
          const id = started.children[0]?.taskQueueID
          if (!id) throw new Error("Expected a workflow child queue item")
          const first = await TaskQueue.claimForExecution(id)
          if (first.kind !== "claimed") throw new Error("Expected to claim the workflow child")
          vi.spyOn(SessionPrompt, "cancel").mockImplementationOnce(async () => {
            await TaskQueue.finishExecution(first.attempt, { status: "failed" })
            await TaskQueue.retry(id)
            expect((await TaskQueue.claimForExecution(id)).kind).toBe("claimed")
          })

          const stopped = await WorkflowScheduler.cancel(run.id).then(
            () => undefined,
            (error: unknown) => error,
          )

          expect(stopped).toMatchObject({ status: 409 })
          expect((await TaskQueue.get(id)).status).toBe("running")
          expect((await WorkflowRun.get(run.id)).status).toBe("running")
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  test("workflow cancellation sees the first queue item before startup publishes its session metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const published = Promise.withResolvers<void>()
          const resume = Promise.withResolvers<void>()
          const setMetadata = Session.setProductMetadata
          vi.spyOn(Session, "setProductMetadata").mockImplementationOnce(async (input) => {
            const result = await setMetadata(input)
            published.resolve()
            await resume.promise
            return result
          })
          const start = WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          try {
            await Promise.race([
              published.promise,
              start.then(() => {
                throw new Error("Startup skipped queue metadata")
              }),
            ])
            expect((await WorkflowScheduler.cancel(run.id)).status).toBe("cancelled")
          } finally {
            resume.resolve()
            await start
          }

          const rows = await TaskQueue.list()
          expect(rows).toHaveLength(8)
          expect(rows.every((item) => item.status === "cancelled")).toBe(true)
          const first = rows[0]
          if (!first) throw new Error("Expected the cancelled queue item to remain visible")
          await expect(TaskQueue.retry(first.id)).rejects.toMatchObject({ status: 409 })
          const legacy = await TaskQueue.enqueue({
            sessionID: first.sessionID,
            kind: first.kind,
            title: "Legacy workflow dispatch",
            payload: first.payload,
          })
          expect((await TaskQueue.claimForExecution(legacy.id)).kind).toBe("unavailable")
          expect((await WorkflowRun.get(run.id)).status).toBe("cancelled")
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  test("workflow cancellation rechecks for children before recording the terminal status", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const [first] = await TaskQueue.list()
          if (!first) throw new Error("Expected a queued workflow child")
          const setMetadata = Session.setProductMetadata
          vi.spyOn(Session, "setProductMetadata").mockImplementationOnce(async (input) => {
            await TaskQueue.enqueue({
              sessionID: first.sessionID,
              kind: first.kind,
              title: "Concurrent legacy dispatch",
              payload: first.payload,
            })
            return setMetadata(input)
          })

          await expect(WorkflowScheduler.cancel(run.id)).rejects.toMatchObject({ status: 409 })

          expect((await WorkflowRun.get(run.id)).status).toBe("running")
          expect((await TaskQueue.list()).filter((item) => item.status === "queued").map((item) => item.title)).toEqual(
            ["Concurrent legacy dispatch"],
          )
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  test("workflow cancellation wins over a pending startup status write", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const writing = Promise.withResolvers<void>()
          const resume = Promise.withResolvers<void>()
          const setStatus = WorkflowRun.setStatus
          vi.spyOn(WorkflowRun, "setStatus").mockImplementationOnce(async (...args) => {
            writing.resolve()
            await resume.promise
            return setStatus(...args)
          })
          const start = WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          try {
            await Promise.race([
              writing.promise,
              start.then(() => {
                throw new Error("Startup skipped status write")
              }),
            ])
            expect((await WorkflowScheduler.cancel(run.id)).status).toBe("cancelled")
          } finally {
            resume.resolve()
            await start
          }

          expect((await WorkflowRun.get(run.id)).status).toBe("cancelled")
          expect(await TaskQueue.list()).toHaveLength(0)
        },
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  test("cancels queued workflow children and linked queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })

          const cancelled = await WorkflowScheduler.cancel(run.id)

          expect(cancelled.status).toBe("cancelled")
          expect(cancelled.children.every((child) => child.status === "cancelled")).toBe(true)
          expect(cancelled.phases.every((phase) => phase.status === "cancelled")).toBe(true)
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect((await TaskQueue.list()).every((item) => item.status === "cancelled")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("cancels a workflow with unreadable phase, child, and artifact data", async () => {
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
        const started = await WorkflowScheduler.start(run.id, {
          allowScaleBeyondDefaults: true,
          autoStartChildren: false,
        })
        const [phase] = started.phases
        const [child] = started.children
        expect(child?.taskQueueID).toBeDefined()
        const artifact = await WorkflowRun.appendArtifact({ runID: run.id, kind: "log", summary: "Damaged artifact" })
        const store = SessionShard.storeForProject(Instance.project.id, { write: true })
        const phaseID = eq(WorkflowPhaseTable.id, phase.id)
        const childID = eq(WorkflowChildTable.id, child.id)
        store.use((db) => {
          db.update(WorkflowPhaseTable)
            .set({ outputs: sql`${"["}` })
            .where(phaseID)
            .run()
          db.update(WorkflowChildTable)
            .set({ evidence_refs: sql`${"{}"}` })
            .where(childID)
            .run()
          db.update(WorkflowArtifactTable)
            .set({ payload: sql`${"["}` })
            .where(eq(WorkflowArtifactTable.id, artifact.id))
            .run()
        })

        const cancelled = await WorkflowScheduler.cancel(run.id)

        expect(cancelled.status).toBe("cancelled")
        expect(cancelled.phases.map(({ id }) => id)).toEqual(started.phases.slice(1).map(({ id }) => id))
        expect(cancelled.children.map(({ id }) => id)).toEqual(started.children.slice(1).map(({ id }) => id))
        expect(cancelled.artifacts).toEqual(started.artifacts)
        expect((await WorkflowRun.get(run.id)).status).toBe("cancelled")
        expect((await TaskQueue.list()).map(({ status }) => status)).toEqual(started.children.map(() => "cancelled"))
        store.use((db) => {
          expect(
            db
              .select({ status: WorkflowPhaseTable.status, raw: sql`${WorkflowPhaseTable.outputs}` })
              .from(WorkflowPhaseTable)
              .where(phaseID)
              .get(),
          ).toEqual({ status: "cancelled", raw: "[" })
          expect(
            db
              .select({ status: WorkflowChildTable.status, raw: sql`${WorkflowChildTable.evidence_refs}` })
              .from(WorkflowChildTable)
              .where(childID)
              .get(),
          ).toEqual({ status: "cancelled", raw: "{}" })
        })
      },
    })
  })

  test("cancels running workflow children and linked queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const queued = await TaskQueue.list()
          expect(queued.length).toBeGreaterThan(0)
          for (const item of queued) {
            await TaskQueue.setStatus({ id: item.id, status: "running" })
          }
          expect((await TaskQueue.list()).some((item) => item.status === "running")).toBe(true)

          const cancelled = await WorkflowScheduler.cancel(run.id)

          expect(cancelled.status).toBe("cancelled")
          expect(cancelled.children.every((child) => child.status === "cancelled")).toBe(true)
          expect(cancelled.phases.every((phase) => phase.status === "cancelled")).toBe(true)
          const queueAfterCancel = await TaskQueue.list()
          expect(queueAfterCancel.every((item) => item.status === "cancelled")).toBe(true)
          expect(queueAfterCancel.some((item) => item.status === "running")).toBe(false)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("resume restarts a child whose queue item was cancelled during pause", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          await WorkflowScheduler.pause(run.id)

          const { TaskQueue } = await import("../../src/session/task-queue")
          // Pausing a RUNNING child cancels its active queue item, so the item
          // is terminal (cancelled) rather than paused when resume runs.
          for (const item of await TaskQueue.list()) await TaskQueue.cancel(item.id)
          for (const child of (await WorkflowRun.getDetail(run.id)).children) {
            await WorkflowRun.setChildStatus({ id: child.id, status: "paused" })
          }
          expect((await TaskQueue.list()).every((item) => item.status === "cancelled")).toBe(true)

          const resumed = await WorkflowScheduler.resume(run.id)
          expect(resumed.status).toBe("running")
          expect(resumed.children.every((child) => child.status === "queued")).toBe(true)
          // The cancelled items must be re-queued, or the run is stuck forever
          // with children that have no execution carrier.
          expect((await TaskQueue.list()).every((item) => item.status === "queued")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("resume re-syncs a child whose queue item completed during the pause", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })

          const { TaskQueue } = await import("../../src/session/task-queue")
          const { SessionPrompt } = await import("../../src/session/prompt")
          const child = (await WorkflowRun.getDetail(run.id)).children[0]!
          const item = await TaskQueue.get(child.taskQueueID!)
          await TaskQueue.setStatus({ id: item.id, status: "running" })

          // The child's turn finishes inside the cancel window, so its item
          // settles to completed and the workflow sync marks the child
          // completed before the pause parks it.
          const cancel = vi.spyOn(SessionPrompt, "cancel").mockImplementation(async () => {
            await TaskQueue.setStatus({ id: item.id, status: "completed" })
          })
          try {
            await WorkflowScheduler.pause(run.id)
          } finally {
            cancel.mockRestore()
          }
          const parked = (await WorkflowRun.getDetail(run.id)).children.find((row) => row.id === child.id)!
          expect(parked.status).toBe("paused")
          expect((await TaskQueue.get(item.id)).status).toBe("completed")

          const resumed = await WorkflowScheduler.resume(run.id)
          const synced = resumed.children.find((row) => row.id === child.id)!
          // Queueing the child would leave it without an execution carrier
          // (its item is already terminal) and strand the run in "running".
          expect(synced.status).toBe("completed")
          expect((await TaskQueue.get(item.id)).status).toBe("completed")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("pause leaves a settled workflow run settled", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const cancelled = await WorkflowScheduler.cancel(run.id)
          expect(cancelled.status).toBe("cancelled")

          const paused = await WorkflowScheduler.pause(run.id)

          expect(paused.status).toBe("cancelled")
          expect(paused.time.completed).toBe(cancelled.time.completed)
          expect((await WorkflowScheduler.resume(run.id)).status).toBe("cancelled")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("resume leaves a cancelled workflow run cancelled when nothing was paused", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true, autoStartChildren: false })
          const cancelled = await WorkflowScheduler.cancel(run.id)
          expect(cancelled.status).toBe("cancelled")

          const resumed = await WorkflowScheduler.resume(run.id)

          // Resume only re-activates paused children. With nothing paused the
          // terminal run must not flip back to a zombie "running" state.
          expect(resumed.status).toBe("cancelled")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})

async function waitForValue<T>(label: string, read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function workflowSpecPhaseID(item: { payload: Record<string, unknown> }) {
  const workflow = item.payload.workflow
  if (!workflow || typeof workflow !== "object") return undefined
  const specPhaseID = (workflow as { specPhaseID?: unknown }).specPhaseID
  return typeof specPhaseID === "string" ? specPhaseID : undefined
}

function setWorkflowRunStartedAt(id: WorkflowRun.Info["id"], startedAt: number) {
  Database.use((db) => {
    db.update(WorkflowRunTable).set({ time_started: startedAt }).where(eq(WorkflowRunTable.id, id)).run()
  })
}

async function recordVerificationEnvelope(sessionID: Session.Info["id"], envelope: VerificationEnvelope) {
  Recorder.begin(sessionID)
  Recorder.emit({
    type: "tool.result",
    sessionID,
    tool: "verify_project",
    callID: `call-verify-${computeEnvelopeId(envelope)}`,
    status: "completed",
    metadata: { verificationEnvelopes: [envelope] },
    durationMs: 1,
  })
  await Recorder.end(sessionID)
}

function verificationEnvelope(runID: string, status: "passed" | "failed", passed: boolean): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "review",
    scope: { kind: "workspace", description: "workflow fixture" },
    command: { runner: "bun", argv: ["test"], cwd: "/tmp/workflow-fixture" },
    result: {
      name: "typecheck",
      type: "typecheck",
      passed,
      status,
      issues: [],
      duration: 1,
      output: status === "passed" ? "ok" : "typecheck failed",
    },
    structuredFailures:
      status === "passed" ? [] : [{ kind: "custom", message: "typecheck failed", details: { runID } }],
    artifactRefs: [],
    source: { tool: "workflow-test", version: "1.0.0", runId: runID },
  }
}
