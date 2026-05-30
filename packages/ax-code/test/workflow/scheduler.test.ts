import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
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
import { WorkflowRunTable } from "../../src/workflow/workflow.sql"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
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
          const result = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

          expect(result.status).toBe("running")
          expect(result.phases[0]?.status).toBe("running")
          expect(result.phases[1]?.status).toBe("queued")
          expect(result.children).toHaveLength(8)
          expect(result.children.every((child) => child.taskQueueID?.startsWith("tsk_"))).toBe(true)
          expect(result.children.every((child) => child.sessionID?.startsWith("ses_"))).toBe(true)
          expect(result.budgetUsage.childAgents).toBe(8)
          expect(result.artifacts.find((artifact) => artifact.specArtifactID === "phase-prompt-collect-issues"))
            .toMatchObject({
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
          expect(queue.every((item) => item.worktree === tmp.path)).toBe(true)
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
          const firstStart = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
          const secondStart = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

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

  test("executes workflow subagent queue payloads through TaskQueueExecutor", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const { TaskQueueExecutor } = await import("../../src/session/task-queue-executor")
          const { SessionPrompt } = await import("../../src/session/prompt")
          const [first] = await TaskQueue.list()
          expect(first?.sessionID).toStartWith("ses_")
          const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({
            info: {
              id: "msg_workflow_child",
              role: "assistant",
              tokens: { input: 11, output: 7, total: 18 },
              estimatedCostUsd: 0.001,
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
          const started = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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
            | { budgetLedger?: Array<{ kind: string; usageDelta?: { childAgents?: number } }> }
            | undefined
          expect(Array.isArray(finalPayload?.budgetLedger)).toBe(true)
          expect(finalPayload?.budgetLedger).toHaveLength(detail.budgetLedger.length)
          expect(finalPayload?.budgetLedger?.some((entry) => entry.kind === "reserve")).toBe(true)
          expect(finalPayload?.budgetLedger?.some((entry) => entry.usageDelta?.childAgents === 1)).toBe(true)

          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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
          const started = await WorkflowScheduler.start(run.id)
          const firstPhase = started.phases[0]
          const secondPhase = started.phases[1]
          if (!firstPhase || !secondPhase) throw new Error("expected two workflow phases")

          const { TaskQueue } = await import("../../src/session/task-queue")
          const firstPhaseQueue = await TaskQueue.list()
          expect(firstPhaseQueue).toHaveLength(3)

          await TaskQueue.setStatus({ id: firstPhaseQueue[0]!.id, status: "completed" })
          const detail = await waitForValue("first-success phase advance", async () => {
            const current = await WorkflowRun.getDetail(run.id)
            return current.phases[1]?.status === "running" ? current : undefined
          })

          expect(detail.phases[0]?.status).toBe("completed")
          const firstPhaseChildren = detail.children.filter((child) => child.phaseID === firstPhase.id)
          expect(firstPhaseChildren.map((child) => child.status).sort()).toEqual([
            "cancelled",
            "cancelled",
            "completed",
          ])
          const queue = await TaskQueue.list()
          expect(queue.filter((item) => workflowSpecPhaseID(item) === "race").map((item) => item.status).sort()).toEqual(
            ["cancelled", "cancelled", "completed"],
          )
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
                mergeStrategy: "vote-with-critic",
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

  test("pauses and resumes queued workflow children without advancing future phases", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

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

  test("retries failed workflow queue children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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

  test("cancels queued workflow children and linked queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

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

  test("cancels running workflow children and linked queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
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

function verificationEnvelope(runID: string, status: "passed" | "failed", passed: boolean) {
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
      status === "passed"
        ? []
        : [{ kind: "custom", message: "typecheck failed", details: { runID } }],
    artifactRefs: [],
    source: { tool: "workflow-test", version: "1.0.0", runId: runID },
  }
}
