import { afterEach, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  WorkflowCommandRuntimeDisabledError,
  createWorkflowCommandRun,
  parseWorkflowCommandArguments,
  workflowCommandPrompt,
} from "../../src/session/prompt-command-workflow"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("parseWorkflowCommandArguments supports key=value JSON assignments and raw fallback", () => {
  expect(parseWorkflowCommandArguments("issue-limit=5 enabled=true label=release")).toEqual({
    "issue-limit": 5,
    enabled: true,
    label: "release",
  })
  expect(parseWorkflowCommandArguments("release readiness")).toEqual({
    arguments: "release readiness",
  })
  expect(parseWorkflowCommandArguments("")).toEqual({})
})

test("createWorkflowCommandRun fails clearly when runtime flag is disabled", async () => {
  const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
  delete process.env.AX_CODE_WORKFLOW_RUNTIME
  try {
    await expect(
      createWorkflowCommandRun({
        commandName: "triage",
        command: { workflow: "builtin:noop-dry-run" },
        arguments: "",
        sessionID: SessionID.descending(),
      }),
    ).rejects.toBeInstanceOf(WorkflowCommandRuntimeDisabledError)
  } finally {
    if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
    else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
  }
})

test("createWorkflowCommandRun creates and starts a durable run for trusted templates when enabled", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
  process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const run = await createWorkflowCommandRun({
          commandName: "noop-workflow",
          command: { workflow: "builtin:noop-dry-run" },
          arguments: "",
          sessionID: session.id,
        })

        expect(run.status).toBe("completed")
        expect(run.parentSessionID).toBe(session.id)
        expect(run.sourceTemplateID).toBe("builtin:noop-dry-run")
        expect(run.sourceTaskID).toBe("command:noop-workflow")

        const prompt = workflowCommandPrompt({
          commandName: "noop-workflow",
          templateID: "builtin:noop-dry-run",
          run,
          template: "No extra notes.",
        })
        expect(prompt).toContain(run.id)
        expect(prompt).toContain("builtin:noop-dry-run")
      },
    })
  } finally {
    if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
    else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
  }
})
