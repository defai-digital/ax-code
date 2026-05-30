import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  WorkflowTemplate,
  WorkflowTemplateNotFoundError,
  WorkflowTemplateUntrustedError,
  WorkflowRun,
  getParsedWorkflowFixtureSpec,
  parseWorkflowSpecV1,
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
    expect(templates.find((template) => template.id === "builtin:verified-bug-sweep")?.specHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    )
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
        expect(run.inputValues).toEqual({})
        expect(run.status).toBe("queued")
      },
    })
  })

  test("applies model policy overrides when creating runs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowTemplate.createRun({
          templateID: "builtin:issue-triage",
          modelPolicy: {
            effort: "max-workflow",
            workerModel: "cheap-local",
            synthesizerModel: "strong-cloud",
          },
          inputValues: {
            "issue-limit": 2,
          },
        })

        expect(run.spec.modelPolicy).toMatchObject({
          effort: "max-workflow",
          workerModel: "cheap-local",
          synthesizerModel: "strong-cloud",
        })
        expect(run.spec.modelPolicy.plannerModel).toBeUndefined()
        expect(run.inputValues).toEqual({ "issue-limit": 2 })
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
          specHash: WorkflowTemplate.specHash(spec),
        })
        expect(saved.path).toContain(".ax-code/workflow-template/local-noop.json")

        const listed = await WorkflowTemplate.list()
        expect(listed.find((template) => template.id === "project:local-noop")).toMatchObject({
          trust: "candidate",
          specHash: saved.specHash,
        })

        await expect(WorkflowTemplate.createRun({ templateID: saved.id })).rejects.toThrow(
          WorkflowTemplateUntrustedError,
        )

        const promoted = await WorkflowTemplate.promote(saved.id)
        expect(promoted.trust).toBe("trusted")
        expect(promoted.specHash).toBe(saved.specHash)

        const run = await WorkflowTemplate.createRun({ templateID: promoted.id })
        expect(run.sourceTemplateID).toBe("project:local-noop")
        expect(run.spec.id).toBe("local-noop")
      },
    })
  })

  test("saves generated workflow run snapshots as candidate templates", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({
          spec: {
            ...getParsedWorkflowFixtureSpec("noopDryRun"),
            id: "run-generated-noop",
            name: "Run Generated Noop",
            description: "Workflow spec generated during a successful run.",
          },
        })
        const saved = await WorkflowTemplate.saveFromRun({ runID: run.id, scope: "project" })

        expect(saved).toMatchObject({
          id: "project:run-generated-noop",
          source: "project",
          trust: "candidate",
          name: "Run Generated Noop",
        })
        expect(saved.specHash).toBe(WorkflowTemplate.specHash(run.spec))
      },
    })
  })

  test("rejects unknown templates", async () => {
    await expect(WorkflowTemplate.get("builtin:missing" as WorkflowTemplate.ID)).rejects.toThrow(
      WorkflowTemplateNotFoundError,
    )
  })

  test("hashes specs canonically for diffable template identity", () => {
    const spec = getParsedWorkflowFixtureSpec("noopDryRun")
    const reordered = {
      phases: spec.phases,
      description: spec.description,
      schemaVersion: spec.schemaVersion,
      id: spec.id,
      name: spec.name,
      tags: spec.tags,
    }

    expect(WorkflowTemplate.specHash(spec)).toBe(WorkflowTemplate.specHash(parseWorkflowSpecV1(reordered)))
  })
})
