import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { WorkflowTemplate, WorkflowTemplateNotFoundError } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowTemplate", () => {
  test("lists built-in workflow templates", () => {
    const templates = WorkflowTemplate.list()
    expect(templates.map((template) => template.id).sort()).toEqual([
      "builtin:issue-triage",
      "builtin:noop-dry-run",
      "builtin:verified-bug-sweep",
    ])
    expect(templates.find((template) => template.id === "builtin:verified-bug-sweep")?.spec.verification.mode).toBe(
      "required",
    )
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

  test("rejects unknown templates", () => {
    expect(() => WorkflowTemplate.get("builtin:missing" as WorkflowTemplate.ID)).toThrow(WorkflowTemplateNotFoundError)
  })
})
