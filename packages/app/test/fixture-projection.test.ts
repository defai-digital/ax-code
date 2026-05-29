import { describe, expect, test } from "bun:test"
import { fixtureHeadlessEvents } from "../src/fixtures/headless"
import { createFixtureCommandCenterState, queueSummary, replayAppProjection } from "../src/projection/replay"
import { createCommandCenterViewModel } from "../src/projection/view-model"

describe("fixture command center projection", () => {
  test("replays headless runtime events into deterministic command-center state", () => {
    const projection = replayAppProjection(fixtureHeadlessEvents)

    expect(projection.session.map((session) => session.id)).toEqual(["ses_architecture", "ses_queue"])
    expect(projection.message["ses_architecture"]).toHaveLength(2)
    expect(projection.part["msg_assistant_architecture"]?.[0]?.text).toContain("fixture-driven command center")
    expect(projection.permission["ses_queue"]?.[0]?.id).toBe("perm_queue_storage")
    expect(projection.question["ses_architecture"]?.[0]?.id).toBe("q_protocol")
    expect(projection.vcs?.branch).toBe("feature/codex-like-app")
  })

  test("builds queue summary from server-owned queue fixture shape", () => {
    const state = createFixtureCommandCenterState()

    expect(queueSummary(state.queue)).toEqual({
      total: 3,
      running: 1,
      blocked: 1,
      queued: 1,
    })
  })

  test("creates a view model without requiring a live backend", () => {
    const view = createCommandCenterViewModel(createFixtureCommandCenterState())

    expect(view.selectedSession?.id).toBe("ses_architecture")
    expect(view.messages.map((message) => message.text).join("\n")).toContain("OpenChamber")
    expect(view.todos.some((todo) => todo.status === "in_progress")).toBe(true)
    expect(view.diffs.map((diff) => diff.path)).toContain("packages/app/src/App.tsx")
    expect(view.evidence?.risk?.level).toBe("MEDIUM")
    expect(view.evidence?.semantic?.headline).toContain("desktop app shell")
    expect(view.evidence?.rollbackPoints).toHaveLength(1)
    expect(view.multiRunGroups[0]).toMatchObject({
      id: "multirun_fixture_app",
      attention: "blocked",
      total: 2,
      running: 1,
      blocked: 1,
      sessions: ["ses_architecture", "ses_queue"],
      worktrees: ["wt-app-shell", "wt-queue-contract"],
      conflictPaths: ["packages/app/src/App.tsx"],
    })
    expect(view.multiRunGroups[0]?.sessionDiffs).toEqual([
      {
        sessionID: "ses_architecture",
        files: ["packages/app/src/App.tsx", "packages/desktop/src/bridge/schema.ts"],
        additions: 300,
        removals: 0,
      },
      {
        sessionID: "ses_queue",
        files: ["packages/app/src/App.tsx", "packages/ax-code/src/session/task-queue-executor.ts"],
        additions: 204,
        removals: 28,
      },
    ])
    expect(view.catalog.providers.map((provider) => provider.id)).toContain("openai")
    expect(view.catalog.agents.map((agent) => agent.id)).toContain("build")
    expect(view.catalog.models.map((model) => model.modelID)).toContain("gpt-5-codex")
    expect(view.worktrees.map((worktree) => worktree.name)).toContain("wt-app-shell")
    expect(view.terminals.map((terminal) => terminal.id)).toContain("pty_fixture_dev")
    expect(view.scheduledTasks.map((task) => task.id)).toContain("sch_fixture_review")
  })

  test("flags multi-run conflict attention when completed variants touch the same file", () => {
    const state = createFixtureCommandCenterState()
    state.queue = state.queue.map((item) =>
      item.payload?.multiRunID === "multirun_fixture_app" ? { ...item, status: "completed" } : item,
    )

    const view = createCommandCenterViewModel(state)

    expect(view.multiRunGroups[0]).toMatchObject({
      id: "multirun_fixture_app",
      attention: "conflict",
      completed: 2,
      conflictPaths: ["packages/app/src/App.tsx"],
    })
  })

  test("windows long sessions and large queues for command-center rendering", () => {
    const state = createFixtureCommandCenterState()
    const sessionID = "ses_architecture"
    state.projection.message[sessionID] = Array.from({ length: 250 }, (_, index) => ({
      id: `msg_${index}`,
      sessionID,
      role: index % 2 === 0 ? "user" : "assistant",
      createdAt: index,
    }))
    state.projection.part = Object.fromEntries(
      state.projection.message[sessionID].map((message, index) => [
        message.id,
        [{ id: `part_${index}`, messageID: message.id, type: "text", text: `message ${index}` }],
      ]),
    )
    state.queue = Array.from({ length: 250 }, (_, index) => ({
      id: `queue_${index}`,
      project: "ax-code",
      title: `Queue item ${index}`,
      kind: "prompt",
      status: "queued",
      priority: index,
      createdAt: index,
    }))

    const view = createCommandCenterViewModel(state)

    expect(view.messages).toHaveLength(200)
    expect(view.messageHiddenCount).toBe(50)
    expect(view.messages[0]?.id).toBe("msg_50")
    expect(view.queue).toHaveLength(200)
    expect(view.queueHiddenCount).toBe(50)
    expect(view.queueSummary.total).toBe(250)
  })
})
