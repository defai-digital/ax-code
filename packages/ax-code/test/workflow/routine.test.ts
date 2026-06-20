import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import {
  WorkflowFixtureSpecs,
  WorkflowRoutineDisabledError,
  WorkflowRoutineNotFoundError,
  WorkflowRoutineTrigger,
  WorkflowTemplate,
  parseWorkflowSpecV1,
} from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowRoutineTrigger", () => {
  test("creates candidate and trusted API routine triggers from templates", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const candidate = await WorkflowRoutineTrigger.create({
          templateID: "builtin:noop-dry-run",
          scope: "project",
          route: "workflow/local-candidate-noop",
        })

        expect(candidate).toMatchObject({
          route: "workflow/local-candidate-noop",
          templateID: "project:noop-dry-run",
          source: "project",
          trust: "candidate",
          enabled: false,
          mode: "api",
          securityGate: "local-only",
        })
        await expect(WorkflowRoutineTrigger.run({ route: "workflow/local-candidate-noop" })).rejects.toThrow(
          WorkflowRoutineDisabledError,
        )

        const trusted = await WorkflowRoutineTrigger.create({
          templateID: "builtin:noop-dry-run",
          scope: "project",
          route: "workflow/local-trusted-noop",
          enabled: true,
          trust: "trusted",
        })
        expect(trusted).toMatchObject({
          route: "workflow/local-trusted-noop",
          templateID: "project:noop-dry-run",
          trust: "trusted",
          enabled: true,
        })

        const routines = await WorkflowRoutineTrigger.list()
        expect(routines).toContainEqual(expect.objectContaining({ route: "workflow/local-trusted-noop" }))
      },
    })
  })

  test("creates and lists scheduled routine triggers from templates", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const routine = await WorkflowRoutineTrigger.create({
          templateID: "builtin:noop-dry-run",
          scope: "project",
          trust: "trusted",
          mode: "scheduled",
          schedule: "0 9 * * *",
          timezone: "America/Toronto",
          enabled: true,
        })

        expect(routine).toMatchObject({
          route: "workflow/noop-dry-run",
          templateID: "project:noop-dry-run",
          source: "project",
          trust: "trusted",
          enabled: true,
          mode: "scheduled",
          schedule: "0 9 * * *",
          timezone: "America/Toronto",
          securityGate: "local-only",
          scheduledTaskStatus: "active",
        })
        expect(routine.scheduledTaskID).toBeString()
        expect(routine.nextRunAt).toBeGreaterThan(0)

        const template = await WorkflowTemplate.get("project:noop-dry-run")
        expect(template.spec.trigger).toEqual({
          kind: "scheduled",
          schedule: "0 9 * * *",
          timezone: "America/Toronto",
          enabled: true,
        })
        expect(template.spec.routine).toMatchObject({
          enabled: true,
          mode: "scheduled",
          apiRoute: "workflow/noop-dry-run",
          schedule: "0 9 * * *",
          timezone: "America/Toronto",
          securityGate: "local-only",
        })
        const { ScheduledTask } = await import("../../src/session/scheduled-task")
        const scheduledTasks = await ScheduledTask.list()
        expect(scheduledTasks).toContainEqual(
          expect.objectContaining({
            id: routine.scheduledTaskID,
            title: "Workflow: Noop Dry Run",
            workflowTemplateID: "project:noop-dry-run",
            status: "active",
          }),
        )

        const routines = await WorkflowRoutineTrigger.list()
        expect(routines).toContainEqual(
          expect.objectContaining({
            route: "workflow/noop-dry-run",
            mode: "scheduled",
            scheduledTaskID: routine.scheduledTaskID,
            scheduledTaskStatus: "active",
          }),
        )

        const paused = await WorkflowRoutineTrigger.create({
          templateID: "project:noop-dry-run",
          scope: "project",
          trust: "candidate",
          mode: "scheduled",
          schedule: "15 10 * * *",
          enabled: false,
        })
        expect(paused).toMatchObject({
          route: "workflow/noop-dry-run",
          templateID: "project:noop-dry-run",
          trust: "candidate",
          enabled: false,
          mode: "scheduled",
          scheduledTaskID: routine.scheduledTaskID,
          scheduledTaskStatus: "paused",
        })
        const refreshedTasks = await ScheduledTask.list()
        expect(refreshedTasks.filter((task) => task.workflowTemplateID === "project:noop-dry-run")).toHaveLength(1)

        await expect(WorkflowRoutineTrigger.run({ route: "workflow/noop-dry-run" })).rejects.toThrow(
          WorkflowRoutineNotFoundError,
        )
      },
    })
  })

  test("creates disabled webhook routine trigger metadata from templates", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const routine = await WorkflowRoutineTrigger.create({
          templateID: "builtin:noop-dry-run",
          scope: "project",
          trust: "candidate",
          mode: "webhook",
          webhookEvent: "github.issue.opened",
        })

        expect(routine).toMatchObject({
          route: "workflow/noop-dry-run",
          templateID: "project:noop-dry-run",
          source: "project",
          trust: "candidate",
          enabled: false,
          mode: "webhook",
          webhookEvent: "github.issue.opened",
          securityGate: "required",
        })
        expect(routine.scheduledTaskID).toBeUndefined()

        const template = await WorkflowTemplate.get("project:noop-dry-run")
        expect(template.spec.trigger).toEqual({
          kind: "webhook",
          event: "github.issue.opened",
          enabled: false,
          securityGate: "required",
        })
        expect(template.spec.routine).toMatchObject({
          enabled: false,
          mode: "webhook",
          webhookEvent: "github.issue.opened",
          securityGate: "required",
        })

        await expect(
          WorkflowRoutineTrigger.create({
            templateID: "builtin:noop-dry-run",
            scope: "project",
            mode: "webhook",
            webhookEvent: "github.issue.opened",
            enabled: true,
          }),
        ).rejects.toThrow("webhook routines must remain disabled")
      },
    })
  })

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
