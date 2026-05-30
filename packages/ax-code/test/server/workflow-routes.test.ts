import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("workflow routes", () => {
  test("stay disabled without AX_CODE_WORKFLOW_RUNTIME", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    delete process.env.AX_CODE_WORKFLOW_RUNTIME
    try {
      const app = Server.Default()
      const response = await app.request(`/workflow-templates?directory=${encodeURIComponent(tmp.path)}`)
      expect(response.status).toBe(404)
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("creates and controls workflow runs from built-in templates", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const templatesResponse = await app.request(`/workflow-templates?${directoryQuery}`)
      expect(templatesResponse.status).toBe(200)
      const templates = (await templatesResponse.json()) as Array<{ id: string }>
      expect(templates.map((template) => template.id)).toContain("builtin:issue-triage")

      const createResponse = await app.request(`/workflow-runs?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateID: "builtin:issue-triage",
          modelPolicy: {
            effort: "max-workflow",
            workerModel: "cheap-route",
            synthesizerModel: "strong-route",
          },
        }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as {
        id: string
        sourceTemplateID: string
        status: string
        spec: { modelPolicy: { effort: string; workerModel: string; synthesizerModel: string } }
      }
      expect(created.id).toStartWith("wfr_")
      expect(created.sourceTemplateID).toBe("builtin:issue-triage")
      expect(created.status).toBe("queued")
      expect(created.spec.modelPolicy).toMatchObject({
        effort: "max-workflow",
        workerModel: "cheap-route",
        synthesizerModel: "strong-route",
      })

      const startResponse = await app.request(`/workflow-runs/${created.id}/start?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowScaleBeyondDefaults: true }),
      })
      expect(startResponse.status).toBe(200)
      const started = (await startResponse.json()) as {
        status: string
        children: unknown[]
        phases: Array<{ status: string }>
      }
      expect(started.status).toBe("running")
      expect(started.phases[0]?.status).toBe("running")
      expect(started.children).toHaveLength(8)

      const dashboardResponse = await app.request(`/workflow-runs/dashboard?${directoryQuery}`)
      expect(dashboardResponse.status).toBe(200)
      expect(await dashboardResponse.json()).toEqual([
        expect.objectContaining({
          runID: created.id,
          status: "running",
          currentPhaseName: "Collect Issues",
          effort: "max-workflow",
          childCounts: expect.objectContaining({ queued: 8 }),
          budgetUsage: expect.objectContaining({ childAgents: 8 }),
        }),
      ])

      const pauseResponse = await app.request(`/workflow-runs/${created.id}/pause?${directoryQuery}`, {
        method: "POST",
      })
      expect(pauseResponse.status).toBe(200)
      expect(await pauseResponse.json()).toMatchObject({ status: "paused" })

      const resumeResponse = await app.request(`/workflow-runs/${created.id}/resume?${directoryQuery}`, {
        method: "POST",
      })
      expect(resumeResponse.status).toBe(200)
      expect(await resumeResponse.json()).toMatchObject({ status: "running" })

      const cancelResponse = await app.request(`/workflow-runs/${created.id}/cancel?${directoryQuery}`, {
        method: "POST",
      })
      expect(cancelResponse.status).toBe(200)
      expect(await cancelResponse.json()).toMatchObject({ status: "cancelled" })

      const getResponse = await app.request(`/workflow-runs/${created.id}?${directoryQuery}`)
      expect(getResponse.status).toBe(200)
      expect(await getResponse.json()).toMatchObject({ id: created.id, status: "cancelled" })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("lists workflow artifacts with compact drill-down filters", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const createResponse = await app.request(`/workflow-runs?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateID: "builtin:noop-dry-run" }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await app.request(`/workflow-runs/${created.id}/start?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(startResponse.status).toBe(200)
      const started = (await startResponse.json()) as {
        phases: Array<{ id: string }>
        artifacts: Array<{ phaseID?: string; payload?: unknown }>
      }
      const phaseID = started.phases[0]!.id
      expect(started.artifacts).toHaveLength(1)

      const artifactsResponse = await app.request(
        `/workflow-runs/${created.id}/artifacts?${directoryQuery}&phaseID=${phaseID}&kind=summary&includePayload=false`,
      )
      expect(artifactsResponse.status).toBe(200)
      const artifacts = (await artifactsResponse.json()) as Array<{ phaseID?: string; kind: string; payload?: unknown }>
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toMatchObject({ phaseID, kind: "summary" })
      expect(artifacts[0]?.payload).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("returns workflow eval summaries for preview promotion gates", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const createResponse = await app.request(`/workflow-runs?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateID: "builtin:noop-dry-run" }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await app.request(`/workflow-runs/${created.id}/start?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(startResponse.status).toBe(200)

      const evalResponse = await app.request(`/workflow-runs/${created.id}/eval-summary?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseline: {
            label: "single-agent",
            metrics: {
              confirmedFindings: 0,
              falsePositiveFindings: 0,
              totalTokens: 1_000,
            },
          },
        }),
      })
      expect(evalResponse.status).toBe(200)
      expect(await evalResponse.json()).toMatchObject({
        runID: created.id,
        decision: "promote",
        verificationSatisfied: true,
        comparison: {
          baselineLabel: "single-agent",
          confirmedFindingsDelta: 0,
          falsePositiveFindingsDelta: 0,
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("saves and promotes project workflow templates", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const templatesResponse = await app.request(`/workflow-templates?${directoryQuery}`)
      expect(templatesResponse.status).toBe(200)
      const templates = (await templatesResponse.json()) as Array<{ id: string; spec: Record<string, unknown> }>
      const noop = templates.find((template) => template.id === "builtin:noop-dry-run")
      expect(noop).toBeDefined()

      const spec = {
        ...noop!.spec,
        id: "route-noop",
        name: "Route Noop",
        description: "Project workflow template saved through routes.",
      }
      const saveResponse = await app.request(`/workflow-templates?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", spec }),
      })
      expect(saveResponse.status).toBe(200)
      expect(await saveResponse.json()).toMatchObject({
        id: "project:route-noop",
        source: "project",
        trust: "candidate",
      })

      const promoteResponse = await app.request(`/workflow-templates/project:route-noop/promote?${directoryQuery}`, {
        method: "POST",
      })
      expect(promoteResponse.status).toBe(200)
      expect(await promoteResponse.json()).toMatchObject({
        id: "project:route-noop",
        trust: "trusted",
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})
