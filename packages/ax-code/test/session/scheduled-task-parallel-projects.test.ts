import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { createStoppedAssistantTextResponse } from "../../src/session/prompt/prompt-assistant-response"
import { MessageID, type SessionID } from "../../src/session/schema"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

// Real scheduler, claims, project shards, queue executor and session creation.
// Only the prompt boundary is controlled: this qualifies concurrent dispatch and
// outcome isolation, not a provider, MCP server, packaged binary or Desktop UI.
test("six due tasks across three projects overlap and isolate pause, stop and failure", async () => {
  await using alpha = await tmpdir({ git: true })
  await using beta = await tmpdir({ git: true })
  await using gamma = await tmpdir({ git: true })
  const directories = [alpha.path, beta.path, gamma.path]
  const pending = new Map<SessionID, { directory: string; release: () => void; text: string }>()
  const finished = new Set<SessionID>()
  vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    const directory = Instance.directory
    const text =
      input.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") ?? ""
    await new Promise<void>((release) => pending.set(input.sessionID, { directory, release, text }))
    try {
      if (text === "fail this occurrence") throw new Error("Controlled occurrence failure")
      return await createStoppedAssistantTextResponse({
        sessionID: input.sessionID,
        parent: {
          id: MessageID.ascending(),
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
        },
        text: `Completed fixture in ${directory}`,
      })
    } finally {
      finished.add(input.sessionID)
    }
  })

  const now = Date.now()
  try {
    const projects = await Promise.all(
      directories.map((directory, projectIndex) =>
        Instance.provide({
          directory,
          fn: async () => {
            const tasks = await Promise.all(
              [0, 1].map((slot) =>
                ScheduledTask.create({
                  title: `Shared task title ${slot}`,
                  prompt:
                    projectIndex === 1 && slot === 0 ? "fail this occurrence" : `project ${projectIndex} slot ${slot}`,
                  schedule: { type: "once", runAt: now + 60_000 },
                  catchUpPolicy: "run_once",
                }),
              ),
            )
            const admitted = await ScheduledTask.runDue(now + 6 * 60_000)
            expect(admitted).toHaveLength(2)
            return { directory, projectID: Instance.project.id, tasks, admitted }
          },
        }),
      ),
    )

    // Nothing is released until all six prompts have entered. A serialized
    // executor cannot satisfy this barrier; simultaneous labels are insufficient.
    await vi.waitFor(() => expect(pending.size).toBe(6), { timeout: 15_000 })
    expect(finished.size).toBe(0)
    expect(new Set(projects.map((project) => project.projectID)).size).toBe(3)
    for (const project of projects) {
      await Instance.provide({
        directory: project.directory,
        fn: async () => {
          for (const result of project.admitted) {
            const item = await TaskQueue.get(result.queueItem!.id)
            expect(item.status).toBe("running")
            expect(item.projectID).toBe(project.projectID)
            expect(pending.get(item.sessionID!)?.directory).toBe(project.directory)
            expect((await Session.get(item.sessionID!)).projectID).toBe(project.projectID)
          }
          expect((await ScheduledTask.list()).map((task) => task.id).sort()).toEqual(
            project.tasks.map((task) => task.id).sort(),
          )
        },
      })
    }

    const first = projects[0]!
    const stoppedID = first.admitted[0]!.queueItem!.id
    await Instance.provide({
      directory: first.directory,
      fn: async () => {
        await ScheduledTask.pause(first.admitted[1]!.task.id)
        expect((await TaskQueue.get(first.admitted[1]!.queueItem!.id)).status).toBe("running")
        await TaskQueue.stop(stoppedID)
        expect((await TaskQueue.get(stoppedID)).status).toBe("cancelled")
      },
    })
    // The other projects stay in flight while one schedule is paused and one
    // queue execution is stopped; the controlled prompt may return late.
    for (const project of projects.slice(1)) {
      await Instance.provide({
        directory: project.directory,
        fn: async () => {
          for (const result of project.admitted)
            expect((await TaskQueue.get(result.queueItem!.id)).status).toBe("running")
        },
      })
    }
    for (const item of pending.values()) item.release()
    await vi.waitFor(() => expect(finished.size).toBe(6), { timeout: 15_000 })
    for (const project of projects) {
      await Instance.provide({
        directory: project.directory,
        fn: async () => {
          await vi.waitFor(
            async () => {
              for (const result of project.admitted) {
                const item = await TaskQueue.get(result.queueItem!.id)
                const expected =
                  item.id === stoppedID
                    ? "cancelled"
                    : result.task.prompt === "fail this occurrence"
                      ? "failed"
                      : "completed"
                expect(item.status).toBe(expected)
                const runs = await ScheduledTask.listRuns({ taskID: result.task.id })
                expect(runs).toHaveLength(1)
                expect(runs[0]!.queueID).toBe(item.id)
                expect(runs[0]!.projectID).toBe(project.projectID)
                expect(runs[0]!.status).not.toBe("running")
                // The current history schema has no cancelled variant. Do not
                // allow a late successful prompt to rewrite the stopped run as
                // completed, or count this as cancellation UX qualification.
                if (expected === "cancelled") expect(runs[0]!.status).not.toBe("completed")
                else expect(runs[0]!.status).toBe(expected)
              }
            },
            { timeout: 15_000 },
          )
        },
      })
    }
  } finally {
    for (const item of pending.values()) item.release()
    await vi.waitFor(() => expect(finished.size).toBe(pending.size), { timeout: 15_000 })
  }
}, 60_000)
