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
          Bus.subscribe(WorkflowRun.Event.PhaseUpdated, (event) => {
            events.push(`${event.type}:${event.properties.phase.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildCreated, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ChildUpdated, (event) => {
            events.push(`${event.type}:${event.properties.child.status}`)
          }),
          Bus.subscribe(WorkflowRun.Event.ArtifactWritten, (event) => {
            events.push(`${event.type}:${event.properties.artifact.kind}`)
          }),
          Bus.subscribe(WorkflowRun.Event.BudgetAppended, (event) => {
            events.push(`${event.type}:${event.properties.entry.kind}`)
          }),
        ]

        try {
          const run = await WorkflowRun.create({
            parentSessionID: session.id,
            sourceTemplateID: "builtin:noop-dry-run",
            spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun),
          })

          expect(run.id).toStartWith("wfr_")
          expect(run.status).toBe("queued")
          expect(run.projectID).toBe(session.projectID)
          expect(run.parentSessionID).toBe(session.id)
          expect(run.spec.id).toBe("noop-dry-run")
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
            kind: "summary",
            summary: "dry-run output",
            exposeToMainContext: true,
            payload: { ok: true },
            redaction: { status: "none" },
          })
          expect(artifact.id).toStartWith("wfa_")
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

          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(events).toContain("workflow.run.created")
          expect(events).toContain("workflow.run.updated:running")
          expect(events).toContain("workflow.run.updated:completed")
          expect(events).toContain("workflow.phase.updated:running")
          expect(events).toContain("workflow.phase.updated:completed")
          expect(events).toContain("workflow.child.created:queued")
          expect(events).toContain("workflow.child.updated:completed")
          expect(events).toContain("workflow.artifact.written:summary")
          expect(events).toContain("workflow.budget.appended:consume")
        } finally {
          for (const unsubscribe of unsubscribers) unsubscribe()
          await Session.remove(session.id)
        }
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
