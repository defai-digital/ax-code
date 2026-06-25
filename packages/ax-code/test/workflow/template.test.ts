import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
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
    expect(templates.find((template) => template.id === "builtin:verified-bug-sweep")?.revision).toBe(1)
  })

  test("does not hide workflow template directory I/O failures", async () => {
    const failure = Object.assign(new Error("permission denied"), { code: "EACCES" })
    const readdir = vi.spyOn(fs, "readdir").mockRejectedValue(failure)

    try {
      await expect(WorkflowTemplate.list()).rejects.toBe(failure)
    } finally {
      readdir.mockRestore()
    }
  })

  test("does not hide corrupt saved workflow templates", async () => {
    await using tmp = await tmpdir({ git: true })
    const spec = {
      ...getParsedWorkflowFixtureSpec("noopDryRun"),
      id: "corrupt-list",
      name: "Corrupt List",
      description: "Project-local workflow template for corrupt list tests.",
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const saved = await WorkflowTemplate.save({ scope: "project", spec })
        if (!saved.path) throw new Error("expected saved template path")
        await fs.writeFile(saved.path, "{not json", "utf8")

        await expect(WorkflowTemplate.list()).rejects.toThrow("Failed to parse JSON")
      },
    })
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
          revision: 1,
          specHash: WorkflowTemplate.specHash(spec),
        })
        expect(saved.path).toContain(".ax-code/workflow-template/local-noop.json")

        const listed = await WorkflowTemplate.list()
        expect(listed.find((template) => template.id === "project:local-noop")).toMatchObject({
          trust: "candidate",
          revision: 1,
          specHash: saved.specHash,
        })

        await expect(WorkflowTemplate.createRun({ templateID: saved.id })).rejects.toThrow(
          WorkflowTemplateUntrustedError,
        )

        const promoted = await WorkflowTemplate.promote(saved.id)
        expect(promoted.trust).toBe("trusted")
        expect(promoted.specHash).toBe(saved.specHash)
        expect(promoted.revision).toBe(2)

        const run = await WorkflowTemplate.createRun({ templateID: promoted.id })
        expect(run.sourceTemplateID).toBe("project:local-noop")
        expect(run.spec.id).toBe("local-noop")

        const updated = await WorkflowTemplate.save({
          scope: "project",
          spec: {
            ...spec,
            description: "Project-local workflow template with a tracked update.",
          },
        })
        expect(updated.trust).toBe("candidate")
        expect(updated.revision).toBe(3)
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

  test("does not overwrite malformed project workflow templates when saving", async () => {
    await using tmp = await tmpdir({ git: true })
    const spec = {
      ...getParsedWorkflowFixtureSpec("noopDryRun"),
      id: "local-noop",
      name: "Local Noop",
      description: "Project-local workflow template for malformed file tests.",
    }
    const file = path.join(tmp.path, ".ax-code", "workflow-template", "local-noop.json")
    const malformed = "{not json"
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, malformed)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(WorkflowTemplate.save({ scope: "project", spec })).rejects.toThrow("Failed to parse JSON")
      },
    })

    expect(await fs.readFile(file, "utf-8")).toBe(malformed)
  })

  test("does not overwrite invalid project workflow template schema when saving", async () => {
    await using tmp = await tmpdir({ git: true })
    const spec = {
      ...getParsedWorkflowFixtureSpec("noopDryRun"),
      id: "local-noop",
      name: "Local Noop",
      description: "Project-local workflow template for invalid schema tests.",
    }
    const file = path.join(tmp.path, ".ax-code", "workflow-template", "local-noop.json")
    const invalid = JSON.stringify({ schemaVersion: 1, revision: 1, trust: "candidate" })
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, invalid)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(WorkflowTemplate.save({ scope: "project", spec })).rejects.toThrow()
      },
    })

    expect(await fs.readFile(file, "utf-8")).toBe(invalid)
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
