import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  WorkflowFixtureSpecs,
  WorkflowRoutineDisabledError,
  WorkflowRoutineTrigger,
  WorkflowTemplate,
  parseWorkflowSpecV1,
} from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowRoutineTrigger", () => {
  test("lists and runs trusted local API routines", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            ...WorkflowFixtureSpecs.noopDryRun,
            id: "local-api-noop",
            name: "Local API Noop",
            routine: {
              enabled: true,
              mode: "api",
              apiRoute: "workflow/local-api-noop",
              securityGate: "local-only",
            },
          })
          const template = await WorkflowTemplate.save({ scope: "project", trust: "trusted", spec })

          const routines = await WorkflowRoutineTrigger.list()
          expect(routines).toContainEqual(
            expect.objectContaining({
              route: "workflow/local-api-noop",
              templateID: template.id,
              enabled: true,
              mode: "api",
              securityGate: "local-only",
            }),
          )

          const result = await WorkflowRoutineTrigger.run({
            route: "workflow/local-api-noop",
          })

          expect(result.template.id).toBe(template.id)
          expect(result.run.sourceTemplateID).toBe(template.id)
          expect(result.run.status).toBe("completed")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("does not run disabled or candidate API routines", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spec = parseWorkflowSpecV1({
          ...WorkflowFixtureSpecs.noopDryRun,
          id: "candidate-api-noop",
          name: "Candidate API Noop",
          routine: {
            enabled: true,
            mode: "api",
            apiRoute: "workflow/candidate-api-noop",
            securityGate: "local-only",
          },
        })
        await WorkflowTemplate.save({ scope: "project", trust: "candidate", spec })

        await expect(WorkflowRoutineTrigger.run({ route: "workflow/candidate-api-noop" })).rejects.toThrow(
          WorkflowRoutineDisabledError,
        )
      },
    })
  })
})
