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
        body: JSON.stringify({ templateID: "builtin:issue-triage" }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await createResponse.json()) as { id: string; sourceTemplateID: string; status: string }
      expect(created.id).toStartWith("wfr_")
      expect(created.sourceTemplateID).toBe("builtin:issue-triage")
      expect(created.status).toBe("queued")

      const startResponse = await app.request(`/workflow-runs/${created.id}/start?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowScaleBeyondDefaults: true }),
      })
      expect(startResponse.status).toBe(200)
      const started = (await startResponse.json()) as { status: string; children: unknown[]; phases: Array<{ status: string }> }
      expect(started.status).toBe("running")
      expect(started.phases[0]?.status).toBe("running")
      expect(started.children).toHaveLength(8)

      const pauseResponse = await app.request(`/workflow-runs/${created.id}/pause?${directoryQuery}`, { method: "POST" })
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
})
