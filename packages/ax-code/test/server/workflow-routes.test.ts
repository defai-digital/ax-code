import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { WorkflowFixtureSpecs, WorkflowTemplate, parseWorkflowSpecV1 } from "../../src/workflow"
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
            allowedProviders: ["anthropic", "openai"],
          },
          inputValues: {
            "issue-limit": 5,
          },
        }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as {
        id: string
        sourceTemplateID: string
        status: string
        inputValues: Record<string, unknown>
        spec: {
          modelPolicy: { effort: string; workerModel: string; synthesizerModel: string; allowedProviders: string[] }
        }
      }
      expect(created.id).toStartWith("wfr_")
      expect(created.sourceTemplateID).toBe("builtin:issue-triage")
      expect(created.status).toBe("queued")
      expect(created.inputValues).toEqual({ "issue-limit": 5 })
      expect(created.spec.modelPolicy).toMatchObject({
        effort: "max-workflow",
        workerModel: "cheap-route",
        synthesizerModel: "strong-route",
        allowedProviders: ["anthropic", "openai"],
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
      expect(started.artifacts.some((artifact) => artifact.phaseID === phaseID)).toBe(true)

      const artifactsResponse = await app.request(
        `/workflow-runs/${created.id}/artifacts?${directoryQuery}&phaseID=${phaseID}&kind=summary&includePayload=false`,
      )
      expect(artifactsResponse.status).toBe(200)
      const artifacts = (await artifactsResponse.json()) as Array<{
        phaseID?: string
        kind: string
        payload?: unknown
        redaction?: { status: string; summary?: string }
      }>
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toMatchObject({ phaseID, kind: "summary" })
      expect(artifacts[0]?.payload).toBeUndefined()
      expect(artifacts[0]?.redaction).toMatchObject({
        status: "pending",
        summary: expect.stringContaining("payload omitted"),
      })
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

  test("returns workflow eval cases for seeded preview gates", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const casesResponse = await app.request(`/workflow-runs/eval-cases?${directoryQuery}`)
      expect(casesResponse.status).toBe(200)
      const cases = (await casesResponse.json()) as Array<{ id: string; seeds: unknown[] }>
      expect(cases).toContainEqual(
        expect.objectContaining({
          id: "verified-bug-sweep-seeded",
          seeds: expect.arrayContaining([
            expect.objectContaining({ id: "text-content-xss-rejected", expectedStatus: "rejected" }),
          ]),
        }),
      )

      const createResponse = await app.request(`/workflow-runs?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateID: "builtin:verified-bug-sweep" }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as { id: string }

      const evalResponse = await app.request(`/workflow-runs/${created.id}/eval-case?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseID: "verified-bug-sweep-seeded" }),
      })
      expect(evalResponse.status).toBe(200)
      expect(await evalResponse.json()).toMatchObject({
        caseID: "verified-bug-sweep-seeded",
        decision: "hold",
        missingSeedIDs: expect.arrayContaining(["text-content-xss-rejected"]),
        metrics: {
          expectedConfirmedFindings: 1,
          expectedLikelyFindings: 1,
          expectedRejectedFindings: 1,
          expectedUnverifiedFindings: 1,
          falsePositiveRejectionRate: 0,
        },
        summary: {
          comparison: { baselineLabel: "single-agent-seeded-review" },
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("saves workflow runs as candidate templates", async () => {
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

      const earlySaveResponse = await app.request(`/workflow-runs/${created.id}/save-template?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project" }),
      })
      expect(earlySaveResponse.status).toBe(200)
      expect(await earlySaveResponse.json()).toMatchObject({
        id: "project:noop-dry-run",
        source: "project",
        trust: "candidate",
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

  test("runs trusted local API workflow routines", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            ...WorkflowFixtureSpecs.noopDryRun,
            id: "route-api-noop",
            name: "Route API Noop",
            routine: {
              enabled: true,
              mode: "api",
              apiRoute: "workflow/route-api-noop",
              securityGate: "local-only",
            },
          })
          await WorkflowTemplate.save({ scope: "project", trust: "trusted", spec })
        },
      })

      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const listResponse = await app.request(`/workflow-routines?${directoryQuery}`)
      expect(listResponse.status).toBe(200)
      expect(await listResponse.json()).toContainEqual(
        expect.objectContaining({
          route: "workflow/route-api-noop",
          templateID: "project:route-api-noop",
          enabled: true,
        }),
      )

      const runResponse = await app.request(`/workflow-routines/run?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ route: "workflow/route-api-noop" }),
      })
      expect(runResponse.status).toBe(200)
      expect(await runResponse.json()).toMatchObject({
        routine: { route: "workflow/route-api-noop", templateID: "project:route-api-noop" },
        template: { id: "project:route-api-noop", trust: "trusted" },
        run: { sourceTemplateID: "project:route-api-noop", status: "completed" },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("creates workflow routine triggers from templates", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()
      const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

      const createResponse = await app.request(`/workflow-routines?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateID: "builtin:noop-dry-run",
          scope: "project",
          route: "workflow/route-created-noop",
          enabled: true,
          trust: "trusted",
        }),
      })
      expect(createResponse.status).toBe(200)
      expect(await createResponse.json()).toMatchObject({
        route: "workflow/route-created-noop",
        templateID: "project:noop-dry-run",
        trust: "trusted",
        enabled: true,
      })

      const listResponse = await app.request(`/workflow-routines?${directoryQuery}`)
      expect(listResponse.status).toBe(200)
      expect(await listResponse.json()).toContainEqual(
        expect.objectContaining({
          route: "workflow/route-created-noop",
          templateID: "project:noop-dry-run",
        }),
      )
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})
