import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  WorkflowTemplate,
  WorkflowTemplateNotFoundError,
  WorkflowTemplateUntrustedError,
  getParsedWorkflowFixtureSpec,
} from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowTemplate", () => {
  test("lists built-in workflow templates", async () => {
    const templates = await WorkflowTemplate.list()
    expect(templates.map((template) => template.id)).toContain("builtin:issue-triage")
    expect(templates.map((template) => template.id)).toContain("builtin:noop-dry-run")
    expect(templates.map((template) => template.id)).toContain("builtin:verified-bug-sweep")
    expect(templates.find((template) => template.id === "builtin:verified-bug-sweep")?.spec.verification.mode).toBe(
      "required",
    )
    expect(templates.find((template) => template.id === "builtin:verified-bug-sweep")?.trust).toBe("trusted")
  })

  test("creates workflow runs from built-in templates", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowTemplate.createRun({ templateID: "builtin:verified-bug-sweep" })
        expect(run.sourceTemplateID).toBe("builtin:verified-bug-sweep")
        expect(run.spec.id).toBe("verified-bug-sweep")
        expect(run.status).toBe("queued")
      },
    })
  })

  test("saves project-local candidates and promotes them before reuse", async () => {
    await using tmp = await tmpdir({ git: true })
    const spec = {
      ...getParsedWorkflowFixtureSpec("noopDryRun"),
      id: "local-noop",
      name: "Local Noop",
      description: "Project-local workflow template for reuse tests.",
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const saved = await WorkflowTemplate.save({ scope: "project", spec })
        expect(saved).toMatchObject({
          id: "project:local-noop",
          source: "project",
          trust: "candidate",
          name: "Local Noop",
        })
        expect(saved.path).toContain(".ax-code/workflow-template/local-noop.json")

        const listed = await WorkflowTemplate.list()
        expect(listed.find((template) => template.id === "project:local-noop")?.trust).toBe("candidate")

        await expect(WorkflowTemplate.createRun({ templateID: saved.id })).rejects.toThrow(
          WorkflowTemplateUntrustedError,
        )

        const promoted = await WorkflowTemplate.promote(saved.id)
        expect(promoted.trust).toBe("trusted")

        const run = await WorkflowTemplate.createRun({ templateID: promoted.id })
        expect(run.sourceTemplateID).toBe("project:local-noop")
        expect(run.spec.id).toBe("local-noop")
      },
    })
  })

  test("rejects unknown templates", async () => {
    await expect(WorkflowTemplate.get("builtin:missing" as WorkflowTemplate.ID)).rejects.toThrow(
      WorkflowTemplateNotFoundError,
    )
  })
})
