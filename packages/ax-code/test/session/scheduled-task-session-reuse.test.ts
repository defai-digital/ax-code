import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { createStoppedAssistantTextResponse } from "../../src/session/prompt-assistant-response"
import { MessageID } from "../../src/session/schema"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

async function assistant(sessionID: string) {
  return createStoppedAssistantTextResponse({
    sessionID: sessionID as never,
    parent: {
      id: MessageID.ascending(),
      agent: "build",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
    },
    text: "ok",
  })
}

async function createRecurring() {
  return ScheduledTask.create({
    title: "Tokyo weather check",
    prompt: "Fetch current Tokyo weather.",
    schedule: { type: "cron", expression: "0 0 1 1 *" },
  })
}

async function runNowAndSettle(taskID: string) {
  const result = await ScheduledTask.runNow(taskID as never)
  const queueID = result.queueItem?.id
  expect(queueID).toBeDefined()
  await vi.waitFor(async () => {
    const item = await TaskQueue.get(queueID!)
    expect(item.status).toMatch(/^(completed|failed)$/)
    expect(item.sessionID).toBeDefined()
    const runs = await ScheduledTask.listRuns({ taskID: taskID as never })
    expect(runs.some((run) => run.status === "running")).toBe(false)
  })
  return TaskQueue.get(queueID!)
}

describe("scheduled task session reuse", () => {
  test("second fire reuses the first automation session and prepends a new-run note", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompted: Array<{ sessionID: string; text: string }> = []
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
          const text = input.parts
            ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          prompted.push({ sessionID: input.sessionID, text: text ?? "" })
          return assistant(input.sessionID)
        })

        const task = await createRecurring()
        const first = await runNowAndSettle(task.id)
        const second = await runNowAndSettle(task.id)

        expect(first.sessionID).toBeDefined()
        expect(second.sessionID).toBe(first.sessionID)
        expect(prompted.map((entry) => entry.sessionID)).toEqual([first.sessionID, first.sessionID])
        expect(prompted[0]?.text).toContain("Fetch current Tokyo weather.")
        expect(prompted[0]?.text).not.toContain("New occurrence")
        expect(prompted[1]?.text).toContain("New occurrence")
        expect(prompted[1]?.text).toContain("Fetch current Tokyo weather.")
        const session = await Session.get(first.sessionID!)
        expect(session.parentID).toBeUndefined()
        expect(session.title).toBe("Tokyo weather check")
      },
    })
  })

  test("creates a new session when the previous automation session was removed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => assistant(input.sessionID))
        const task = await createRecurring()
        const first = await runNowAndSettle(task.id)
        await Session.remove(first.sessionID!)
        const second = await runNowAndSettle(task.id)
        expect(second.sessionID).toBeDefined()
        expect(second.sessionID).not.toBe(first.sessionID)
      },
    })
  })

  test("creates a new session when the previous automation session is busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => assistant(input.sessionID))
        const task = await createRecurring()
        const first = await runNowAndSettle(task.id)
        const busyID = first.sessionID
        vi.spyOn(SessionPrompt, "assertNotBusy").mockImplementation((sessionID) => {
          if (sessionID === busyID) throw new Error("busy")
        })
        const second = await runNowAndSettle(task.id)
        expect(second.sessionID).toBeDefined()
        expect(second.sessionID).not.toBe(busyID)
      },
    })
  })

  test("does not delete a reused session when a later attach is cancelled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => assistant(input.sessionID))
        const task = await createRecurring()
        const first = await runNowAndSettle(task.id)
        const sessionID = first.sessionID!
        const remove = vi.spyOn(Session, "remove")
        const second = await runNowAndSettle(task.id)
        expect(second.sessionID).toBe(sessionID)
        expect(remove).not.toHaveBeenCalled()
        await Session.get(sessionID)
      },
    })
  })

  test("previousAutomationSessionID ignores the current queue item", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => assistant(input.sessionID))
        const task = await createRecurring()
        const first = await runNowAndSettle(task.id)
        const current = await TaskQueue.enqueue({
          kind: "automation",
          title: task.title,
          sourceTaskID: task.id,
          payload: { scheduledTaskID: task.id, prompt: task.prompt },
        })
        expect(await ScheduledTask.previousAutomationSessionID(task.id, current.id)).toBe(first.sessionID)
        expect(await ScheduledTask.previousAutomationSessionID(task.id, first.id)).toBeUndefined()
      },
    })
  })
})
