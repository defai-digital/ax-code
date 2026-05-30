import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { WorkflowFixtureSpecs, WorkflowRun, parseWorkflowSpecV1 } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowRun state", () => {
  test("persists run detail state and publishes lifecycle events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const events: string[] = []
        const unsubscribers = [
          Bus.subscribe(WorkflowRun.Event.Created, (event) => {
            events.push(event.type)
          }),
          Bus.subscribe(WorkflowRun.Event.Updated, (event) => {
            events.push(`${event.type}:${event.properties.run.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.Started, (event) => {
            events.push(event.type)
          }),
          Bus.subscribe(WorkflowRun.Event.Completed, (event) => {
            events.push(event.type)
          }),
          Bus.subscribe(WorkflowRun.Event.PhaseUpdated, (event) => {
            events.push(`${event.type}:${event.properties.phase.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.PhaseStarted, (event) => {
            events.push(event.type)
          }),
          Bus.subscribe(WorkflowRun.Event.PhaseCompleted, (event) => {
            events.push(event.type)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildCreated, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildUpdated, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildCompleted, (event) => {
            events.push(event.type)
          }),
          Bus.subscribe(WorkflowRun.Event.ArtifactWritten, (event) => {
            events.push(`${event.type}:${event.properties.artifact.kind}`)
          }),
          Bus.subscribe(WorkflowRun.Event.BudgetAppended, (event) => {
            events.push(`${event.type}:${event.properties.entry.kind}`)
          }),
          Bus.subscribe(WorkflowRun.Event.VerificationAttached, (event) => {
            events.push(`${event.type}:${event.properties.verification.envelopeIDs.join(",")}`)
          }),
        ]

        try {
          const run = await WorkflowRun.create({
            parentSessionID: session.id,
            sourceTemplateID: "builtin:noop-dry-run",
            sourceTaskID: "scheduled_task_workflow_source",
            spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun),
          })

          expect(run.id).toStartWith("wfr_")
          expect(run.status).toBe("queued")
          expect(run.projectID).toBe(session.projectID)
          expect(run.parentSessionID).toBe(session.id)
          expect(run.sourceTaskID).toBe("scheduled_task_workflow_source")
          expect(run.spec.id).toBe("noop-dry-run")
          expect(run.inputValues).toEqual({})
          expect(run.currentPhaseID).toStartWith("wfp_")

          const listed = await WorkflowRun.list({ parentSessionID: session.id })
          expect(listed.map((item) => item.id)).toEqual([run.id])

          const running = await WorkflowRun.setStatus({ id: run.id, status: "running" })
          expect(running.time.started).toBeDefined()

          const detail = await WorkflowRun.getDetail(run.id)
          expect(detail.phases).toHaveLength(1)
          expect(detail.phases[0]?.status).toBe("queued")

          const phase = await WorkflowRun.setPhaseStatus({ id: detail.phases[0]!.id, status: "running" })
          expect(phase.status).toBe("running")
          expect(phase.time.started).toBeDefined()

          const child = await WorkflowRun.appendChild({
            runID: run.id,
            phaseID: phase.id,
            agent: "worker",
            model: { providerID: "test", modelID: "cheap" },
            budgetSlice: { maxTotalTokens: 1000 },
          })
          expect(child.id).toStartWith("wfc_")
          expect(child.status).toBe("queued")

          const artifact = await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: phase.id,
            childID: child.id,
            specArtifactID: "dry-run-summary",
            kind: "summary",
            summary: "dry-run output",
            exposeToMainContext: true,
            payload: { ok: true },
            redaction: { status: "none" },
          })
          expect(artifact.id).toStartWith("wfa_")
          expect(artifact.specArtifactID).toBe("dry-run-summary")
          expect(artifact.exposeToMainContext).toBe(true)

          const completedChild = await WorkflowRun.setChildStatus({
            id: child.id,
            status: "completed",
            outputSummary: "child summary",
            evidenceRefs: [{ kind: "artifact", id: artifact.id }],
          })
          expect(completedChild.artifactIDs).toEqual([artifact.id])
          expect(completedChild.outputSummary).toBe("child summary")
          expect(completedChild.time.completed).toBeDefined()

          const budgetEntry = await WorkflowRun.appendBudgetUsage({
            runID: run.id,
            phaseID: phase.id,
            childID: child.id,
            kind: "consume",
            usageDelta: {
              totalTokens: 150,
              inputTokens: 100,
              outputTokens: 50,
              toolCalls: 2,
              childAgents: 1,
              retries: 0,
              estimatedCostUsd: 0.01,
            },
          })
          expect(budgetEntry.id).toStartWith("wfb_")

          const verified = await WorkflowRun.attachVerificationEnvelopeIDs({
            id: run.id,
            envelopeIDs: ["0123456789abcdef"],
          })
          expect(verified.verificationEnvelopeIDs).toEqual(["0123456789abcdef"])

          const completedPhase = await WorkflowRun.setPhaseStatus({ id: phase.id, status: "completed" })
          expect(completedPhase.time.completed).toBeDefined()

          const completedRun = await WorkflowRun.setStatus({ id: run.id, status: "completed" })
          expect(completedRun.time.completed).toBeDefined()

          const finalDetail = await WorkflowRun.getDetail(run.id)
          expect(finalDetail.children).toHaveLength(1)
          expect(finalDetail.artifacts).toHaveLength(1)
          expect(finalDetail.budgetLedger).toHaveLength(1)
          expect(finalDetail.budgetUsage).toMatchObject({
            totalTokens: 150,
            inputTokens: 100,
            outputTokens: 50,
            toolCalls: 2,
            childAgents: 1,
          })
          expect(finalDetail.verificationEnvelopeIDs).toEqual(["0123456789abcdef"])
          expect(finalDetail.sourceTaskID).toBe("scheduled_task_workflow_source")

          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(events).toContain("workflow.run.created")
          expect(events).toContain("workflow.run.updated:running")
          expect(events).toContain("workflow.run.started")
          expect(events).toContain("workflow.run.updated:completed")
          expect(events).toContain("workflow.run.completed")
          expect(events).toContain("workflow.phase.updated:running")
          expect(events).toContain("workflow.phase.started")
          expect(events).toContain("workflow.phase.updated:completed")
          expect(events).toContain("workflow.phase.completed")
          expect(events).toContain("workflow.child.created:queued")
          expect(events).toContain("workflow.child.updated:completed")
          expect(events).toContain("workflow.child.completed")
          expect(events).toContain("workflow.artifact.written:summary")
          expect(events).toContain("workflow.budget.appended:consume")
          expect(events).toContain("workflow.verification.attached:0123456789abcdef")
        } finally {
          for (const unsubscribe of unsubscribers) unsubscribe()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("publishes run, phase, and child status transition events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: string[] = []
        const unsubscribers = [
          Bus.subscribe(WorkflowRun.Event.Blocked, (event) => {
            events.push(`${event.type}:${event.properties.run.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.Paused, (event) => {
            events.push(`${event.type}:${event.properties.run.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.Resumed, (event) => {
            events.push(`${event.type}:${event.properties.run.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.Cancelled, (event) => {
            events.push(`${event.type}:${event.properties.run.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.PhaseFailed, (event) => {
            events.push(`${event.type}:${event.properties.phase.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildStarted, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildFailed, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildCancelled, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
        ]

        try {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
          const detail = await WorkflowRun.getDetail(run.id)
          const phase = detail.phases[0]!
          const failedChild = await WorkflowRun.appendChild({ runID: run.id, phaseID: phase.id, agent: "worker" })
          const cancelledChild = await WorkflowRun.appendChild({ runID: run.id, phaseID: phase.id, agent: "worker" })

          await WorkflowRun.setStatus({ id: run.id, status: "blocked", error: "approval required" })
          await WorkflowRun.setStatus({ id: run.id, status: "paused" })
          await WorkflowRun.setStatus({ id: run.id, status: "running" })
          await WorkflowRun.setChildStatus({ id: failedChild.id, status: "running" })
          await WorkflowRun.setChildStatus({ id: failedChild.id, status: "failed", error: "model failed" })
          await WorkflowRun.setChildStatus({ id: cancelledChild.id, status: "cancelled" })
          await WorkflowRun.setPhaseStatus({ id: phase.id, status: "failed", error: "phase failed" })
          await WorkflowRun.setStatus({ id: run.id, status: "cancelled" })

          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(events).toContain("workflow.run.blocked:blocked")
          expect(events).toContain("workflow.run.paused:paused")
          expect(events).toContain("workflow.run.resumed:running")
          expect(events).toContain("workflow.run.cancelled:cancelled")
          expect(events).toContain("workflow.phase.failed:failed")
          expect(events).toContain("workflow.child.started:running")
          expect(events).toContain("workflow.child.failed:failed")
          expect(events).toContain("workflow.child.cancelled:cancelled")
        } finally {
          for (const unsubscribe of unsubscribers) unsubscribe()
        }
      },
    })
  })

  test("publishes budget warning and exceeded events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: string[] = []
        const unsubscribers = [
          Bus.subscribe(WorkflowRun.Event.BudgetWarning, (event) => {
            events.push(`${event.type}:${event.properties.warnings.join(";")}`)
          }),
          Bus.subscribe(WorkflowRun.Event.BudgetExceeded, (event) => {
            events.push(`${event.type}:${event.properties.exceeded.join(";")}`)
          }),
          Bus.subscribe(WorkflowRun.Event.Failed, (event) => {
            events.push(`${event.type}:${event.properties.run.status}`)
          }),
        ]

        try {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              ...WorkflowFixtureSpecs.noopDryRun,
              budget: {
                maxTotalTokens: 100,
                maxWallTimeMs: 600_000,
                maxConcurrentAgents: 3,
                maxTotalAgents: 25,
                maxToolCalls: 100,
                maxRetries: 2,
              },
            }),
          })

          await WorkflowRun.appendBudgetUsage({
            runID: run.id,
            kind: "consume",
            usageDelta: { totalTokens: 80 },
          })
          await WorkflowRun.appendBudgetUsage({
            runID: run.id,
            kind: "consume",
            usageDelta: { totalTokens: 21 },
          })

          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(events).toContain("workflow.budget.warning:total tokens 80/100")
          expect(events).toContain("workflow.budget.exceeded:total tokens 101/100")
          expect(events).toContain("workflow.run.failed:failed")
        } finally {
          for (const unsubscribe of unsubscribers) unsubscribe()
        }
      },
    })
  })

  test("fails a workflow when a child exceeds its input or output token slice", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: string[] = []
        const unsubscribers = [
          Bus.subscribe(WorkflowRun.Event.BudgetExceeded, (event) => {
            events.push(`${event.type}:${event.properties.exceeded.join(";")}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildUpdated, (event) => {
            events.push(`${event.type}:${event.properties.child.status}:${event.properties.child.error ?? ""}`)
          }),
        ]

        try {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
          const detail = await WorkflowRun.getDetail(run.id)
          const phase = detail.phases[0]!
          await WorkflowRun.setStatus({ id: run.id, status: "running" })
          await WorkflowRun.setPhaseStatus({ id: phase.id, status: "running" })
          const child = await WorkflowRun.appendChild({
            runID: run.id,
            phaseID: phase.id,
            agent: "worker",
            budgetSlice: {
              maxTotalTokens: 100,
              maxInputTokensPerChild: 30,
              maxOutputTokensPerChild: 20,
            },
          })

          await WorkflowRun.appendBudgetUsage({
            runID: run.id,
            phaseID: phase.id,
            childID: child.id,
            kind: "consume",
            usageDelta: {
              totalTokens: 55,
              inputTokens: 35,
              outputTokens: 20,
            },
          })

          const failed = await WorkflowRun.getDetail(run.id)
          expect(failed.status).toBe("failed")
          expect(failed.phases[0]?.status).toBe("failed")
          expect(failed.children[0]?.status).toBe("failed")
          expect(failed.error).toContain("child input tokens 35/30")
          expect(failed.budgetUsage).toMatchObject({
            totalTokens: 55,
            inputTokens: 35,
            outputTokens: 20,
          })

          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(events).toContain("workflow.budget.exceeded:child input tokens 35/30")
          expect(events.some((event) => event.includes("workflow.child.updated:failed"))).toBe(true)
        } finally {
          for (const unsubscribe of unsubscribers) unsubscribe()
        }
      },
    })
  })

  test("persists resolved workflow input values", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spec = parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage)
        const defaulted = await WorkflowRun.create({ spec })
        expect(defaulted.inputValues).toEqual({ "issue-limit": 10 })
        expect((await WorkflowRun.getDetail(defaulted.id)).inputValues).toEqual({ "issue-limit": 10 })

        const overridden = await WorkflowRun.create({
          spec,
          inputValues: {
            "issue-limit": 3,
          },
        })
        expect(overridden.inputValues).toEqual({ "issue-limit": 3 })
        expect((await WorkflowRun.get(overridden.id)).inputValues).toEqual({ "issue-limit": 3 })
      },
    })
  })

  test("recovers interrupted active runs after backend restart", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const running = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
        const queued = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })

        const runningDetail = await WorkflowRun.getDetail(running.id)
        const phase = runningDetail.phases[0]!
        await WorkflowRun.setStatus({ id: running.id, status: "running" })
        await WorkflowRun.setPhaseStatus({ id: phase.id, status: "running" })
        const child = await WorkflowRun.appendChild({ runID: running.id, phaseID: phase.id, agent: "worker" })
        await WorkflowRun.setChildStatus({ id: child.id, status: "running" })

        const recovered = await WorkflowRun.recoverInterrupted()

        expect(recovered.failed.map((item) => item.id)).toEqual([running.id])
        expect((await WorkflowRun.get(running.id)).status).toBe("failed")
        expect((await WorkflowRun.get(queued.id)).status).toBe("queued")

        const recoveredDetail = await WorkflowRun.getDetail(running.id)
        expect(recoveredDetail.error).toContain("backend restart")
        expect(recoveredDetail.phases[0]?.status).toBe("failed")
        expect(recoveredDetail.children[0]?.status).toBe("failed")
      },
    })
  })
})
