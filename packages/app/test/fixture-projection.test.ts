import { describe, expect, test } from "bun:test"
import { fixtureHeadlessEvents, fixtureScenarios, type AppFixtureScenarioName } from "../src/fixtures/headless"
import {
  createFixtureCommandCenterState,
  createFixtureCommandCenterStateFromScenario,
  queueSummary,
  replayAppProjection,
} from "../src/projection/replay"
import { createCommandCenterViewModel } from "../src/projection/view-model"

describe("fixture command center projection", () => {
  test("replays headless runtime events into deterministic command-center state", () => {
    const projection = replayAppProjection(fixtureHeadlessEvents)

    expect(projection.session.map((session) => session.id)).toEqual(["ses_architecture", "ses_queue"])
    expect(projection.message["ses_architecture"]).toHaveLength(2)
    expect(projection.part["msg_assistant_architecture"]?.[0]?.text).toContain("fixture-driven command center")
    expect(projection.permission["ses_queue"]?.[0]?.id).toBe("perm_queue_storage")
    expect(projection.permission["ses_architecture"]?.[0]?.id).toBe("perm_arch_browser")
    expect(projection.question["ses_architecture"]?.[0]?.id).toBe("q_protocol")
    expect(projection.vcs?.branch).toBe("feature/codex-like-app")
  })

  test("publishes canonical fixture scenarios for every PRD R14 runtime state", () => {
    const required: AppFixtureScenarioName[] = [
      "idle-session",
      "streaming-session",
      "permission-block",
      "question-block",
      "failed-task",
      "queued-followup",
      "worktree-task",
      "review-artifacts",
      "reconnect-recovery",
    ]

    expect(fixtureScenarios.map((scenario) => scenario.name)).toEqual(required)

    for (const scenario of fixtureScenarios) {
      const state = createFixtureCommandCenterStateFromScenario(scenario)
      const selected = state.projection.session.find((session) => session.id === state.selectedSessionID)

      expect(selected?.id).toBe(scenario.selectedSessionID)
      expect(scenario.events.length).toBeGreaterThan(0)
    }
  })

  test("replays canonical fixture scenarios into distinct blocking, queue, and recovery states", () => {
    const streaming = createFixtureCommandCenterStateFromScenario("streaming-session")
    expect(streaming.projection.part["msg_streaming_assistant"]?.[0]?.text).toBe("Streaming response")
    expect(streaming.queue[0]?.status).toBe("running")

    const permission = createFixtureCommandCenterStateFromScenario("permission-block")
    expect(permission.projection.permission["ses_fixture_permission"]?.[0]).toMatchObject({
      id: "perm_fixture_write",
      permission: "write",
    })
    expect(permission.queue[0]?.status).toBe("blocked_permission")

    const question = createFixtureCommandCenterStateFromScenario("question-block")
    expect(question.projection.question["ses_fixture_question"]?.[0]?.questions[0]?.header).toBe("Scope")
    expect(question.queue[0]?.status).toBe("blocked_question")

    const failed = createFixtureCommandCenterStateFromScenario("failed-task")
    expect(failed.projection.session_status["ses_fixture_failed"]).toMatchObject({
      type: "failed",
      message: "Typecheck failed",
    })
    expect(failed.projection.task_queue[0]?.status).toBe("failed")

    const followup = createFixtureCommandCenterStateFromScenario("queued-followup")
    expect(followup.queue[0]).toMatchObject({
      kind: "followup",
      status: "queued",
      sourceTaskID: "queue_fixture_parent",
    })

    const worktree = createFixtureCommandCenterStateFromScenario("worktree-task")
    expect(worktree.projection.vcs?.branch).toBe("ax-code/fixture-worktree")
    expect(worktree.worktrees.find((item) => item.name === "wt-fixture")?.branch).toBe("ax-code/fixture-worktree")

    const review = createFixtureCommandCenterStateFromScenario("review-artifacts")
    expect(review.evidence["ses_fixture_review"]?.artifactCounts).toMatchObject({
      findings: 1,
      verificationEnvelopes: 1,
      reviewResults: 1,
      debugCases: 1,
      decisionHints: 1,
    })

    const reconnect = createFixtureCommandCenterStateFromScenario("reconnect-recovery")
    expect(reconnect.projection.session_status["ses_fixture_reconnect"]).toEqual({ type: "idle" })
    expect(reconnect.projection.part["msg_reconnect_assistant"]?.[0]?.text).toContain("reconnect")
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
    expect(view.evidence?.branchRank?.recommendedTitle).toBe("Desktop app architecture")
    expect(view.evidence?.branchRank?.items.find((item) => item.recommended)?.decisionScore).toBe(84)
    expect(view.evidence?.rollbackPoints).toHaveLength(1)
    expect(view.evidence?.artifactPreviews.findings[0]?.title).toContain("Bridge command")
    expect(view.evidence?.artifactPreviews.verificationEnvelopes).toHaveLength(2)
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
    expect(view.catalog.providers.find((provider) => provider.id === "local")).toMatchObject({
      status: "no_models",
      reason: "No models returned by backend",
    })
    expect(view.catalog.agents.map((agent) => agent.id)).toContain("build")
    expect(view.catalog.skills.map((skill) => skill.name)).toContain("debug-n-fix")
    expect(view.catalog.skills.find((skill) => skill.name === "release-review")).toMatchObject({
      status: "warn",
      issues: ["missing compatibility metadata"],
    })
    expect(view.catalog.models.map((model) => model.modelID)).toContain("gpt-5-codex")
    expect(view.catalog.mcp).toMatchObject({ total: 3, connected: 1, needsAuth: 1 })
    expect(view.catalog.lsp).toMatchObject({ total: 2, connected: 2, error: 0 })
    expect(view.catalog.codeIndex).toMatchObject({ pendingPlans: 1, nodeCount: 420, state: "idle" })
    expect(view.catalog.permission).toMatchObject({ totalRules: 4, allow: 1, ask: 2, deny: 1 })
    expect(view.worktrees.map((worktree) => worktree.name)).toContain("wt-app-shell")
    expect(view.worktrees.find((worktree) => worktree.name === "wt-app-shell")?.branch).toBe("ax-code/wt-app-shell")
    expect(view.terminals.map((terminal) => terminal.id)).toContain("pty_fixture_dev")
    expect(view.scheduledTasks.map((task) => task.id)).toContain("sch_fixture_review")
    expect(view.scheduledTasks[0]).toMatchObject({
      lastQueueID: "queue_fixture_scheduled_review",
      lastSessionID: "ses_architecture",
      lastDurationMs: 92_000,
      error: "Last run requested follow-up review",
    })
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
