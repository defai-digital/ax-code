import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  WorkflowCommandRuntimeDisabledError,
  createWorkflowCommandRun,
  parseWorkflowCommandArguments,
  summarizeWorkflowCommandRun,
  workflowCommandPrompt,
} from "../../src/session/prompt-command-workflow"
import { SessionID } from "../../src/session/schema"
import { WorkflowFixtureSpecs, WorkflowRun, WorkflowScheduler, parseWorkflowSpecV1 } from "../../src/workflow"
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
  expect(parseWorkflowCommandArguments("label=\"release readiness\" owner='build agent' enabled=true")).toEqual({
    label: "release readiness",
    owner: "build agent",
    enabled: true,
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
        expect(prompt).toContain("Status: completed")
        expect(prompt).toContain("Progress: phases")
        expect(prompt).toContain("Budget:")
      },
    })
  } finally {
    if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
    else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
  }
})

test("summarizeWorkflowCommandRun surfaces only exposed artifacts and respects redaction", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
  process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
        const started = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
        const phaseID = started.phases[0]?.id

        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID,
          kind: "summary",
          retention: "session",
          exposeToMainContext: true,
          summary: "Confirmed three triage candidates.",
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID,
          kind: "log",
          retention: "session",
          exposeToMainContext: false,
          summary: "Private child transcript that must not leak.",
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID,
          kind: "finding",
          retention: "session",
          exposeToMainContext: true,
          summary: "Original sensitive finding text.",
          redaction: { status: "redacted", summary: "Finding redacted for safety." },
        })

        const detail = await WorkflowRun.getDetail(run.id)
        const summary = summarizeWorkflowCommandRun(detail)

        expect(summary).toContain("Status: running")
        expect(summary).toContain("Exposed artifacts (2):")
        expect(summary).toContain("[summary] Confirmed three triage candidates.")
        expect(summary).toContain("[finding] Finding redacted for safety.")
        expect(summary).not.toContain("Original sensitive finding text.")
        expect(summary).not.toContain("Private child transcript that must not leak.")
      },
    })
  } finally {
    if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
    else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
  }
})
