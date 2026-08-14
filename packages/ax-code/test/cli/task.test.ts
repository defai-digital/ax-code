import { describe, expect, test } from "vitest"
import { formatTaskList, formatTaskShow } from "../../src/cli/cmd/task"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

describe("cli.task formatters", () => {
  test("formatTaskList renders a compact operator table", () => {
    expect(formatTaskList([])).toBe("No tasks found.\n")
    const output = formatTaskList([
      {
        id: "tsk_one" as any,
        projectID: "prj_1" as any,
        directory: "/tmp",
        kind: "subagent",
        status: "running",
        priority: 0,
        position: 0,
        title: "Explore the repo",
        sessionID: "ses_child" as any,
        agent: "explore",
        payload: { deliveryStatus: "pending", source: "task" },
        time: { created: 1 },
      },
    ])
    expect(output).toContain("status")
    expect(output).toContain("running")
    expect(output).toContain("pending")
    expect(output).toContain("subagent")
    expect(output).toContain("tsk_one")
    expect(output).toContain("Explore the repo")
  })

  test("formatTaskShow includes delivery and parent session", () => {
    const output = formatTaskShow({
      id: "tsk_two" as any,
      projectID: "prj_1" as any,
      directory: "/tmp",
      kind: "subagent",
      status: "failed",
      priority: 0,
      position: 1,
      title: "Review code",
      sessionID: "ses_child" as any,
      agent: "general",
      error: "provider timed out",
      payload: {
        deliveryStatus: "blocked",
        deliveryError: "no parent",
        parentSessionID: "ses_parent",
        source: "task",
        subagentType: "general",
        deliveryEmpty: true,
      },
      time: { created: 1_700_000_000_000, started: 1_700_000_001_000, completed: 1_700_000_002_000 },
    })
    expect(output).toContain("Task tsk_two")
    expect(output).toContain("status: failed")
    expect(output).toContain("delivery: blocked")
    expect(output).toContain("parentSession: ses_parent")
    expect(output).toContain("error: provider timed out")
    expect(output).toContain("deliveryEmpty: true")
    expect(output).not.toContain("body")
  })
})

describe("cli.task stop", () => {
  test("stop cancels a running queue item and leaves the session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Child" })
        const item = await TaskQueue.enqueue({
          sessionID: session.id,
          kind: "subagent",
          title: "Explore",
          payload: { source: "task", resumeOnRestart: true },
        })
        await TaskQueue.setStatus({ id: item.id, status: "running" })
        const stopped = await TaskQueue.stop(item.id)
        expect(stopped.status).toBe("cancelled")
        expect(await Session.get(session.id)).toMatchObject({ id: session.id })
      },
    })
  })
})
