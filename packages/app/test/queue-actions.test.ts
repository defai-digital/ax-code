import { describe, expect, test } from "bun:test"
import {
  abortSessionTask,
  compareReviewSessions,
  createScheduledTask,
  notifyScheduledTaskQueued,
  queueReviewComment,
  queueMultiRunTask,
  queueDraftTask,
  readFilePreview,
  revealFilePath,
  replyPermissionRequest,
  replyQuestionRequest,
  runDraftTask,
  runQueueItemCommand,
  runReviewCommand,
  runScheduledTaskCommand,
  runTerminalCommand,
  runWorktreeCommand,
} from "../src/runtime/actions"

describe("queue draft task action", () => {
  test("creates fixture queue items for local preview mode", async () => {
    const item = await queueDraftTask({
      config: { mode: "fixture" },
      mode: "prompt",
      text: "  Continue the desktop implementation  ",
      sessionID: "ses_fixture",
      targetDirectory: "/workspace/.ax-code/worktrees/wt-gui",
    })

    expect(item).toMatchObject({
      sessionID: "ses_fixture",
      directory: "/workspace/.ax-code/worktrees/wt-gui",
      title: "Continue the desktop implementation",
      kind: "prompt",
      status: "queued",
    })
    expect(item.id).toStartWith("tsk_fixture_")
  })

  test("enqueues live tasks through the headless queue client", async () => {
    const requests: unknown[] = []
    const item = await queueDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      mode: "command",
      text: "debug queue lifecycle",
      sessionID: "ses_live",
      agent: "debug",
      model: { providerID: "test", modelID: "test-model" },
      client: {
        taskQueue: {
          enqueue: async (input) => {
            requests.push(input)
            return {
              id: "tsk_live",
              projectID: "project_live",
              directory: "/workspace/ax-code",
              sessionID: input.sessionID,
              kind: input.kind,
              status: "queued",
              priority: input.priority ?? 0,
              position: 0,
              title: input.title,
              agent: input.agent,
              model: input.model,
              payload: input.payload ?? {},
              time: { created: 1_000 },
            }
          },
        },
      },
    })

    expect(requests).toEqual([
      {
        sessionID: "ses_live",
        kind: "command",
        title: "debug queue lifecycle",
        agent: "debug",
        model: { providerID: "test", modelID: "test-model" },
        payload: {
          source: "app.composer",
          mode: "command",
          text: "debug queue lifecycle",
        },
      },
    ])
    expect(item).toMatchObject({
      id: "tsk_live",
      project: "project_live",
      directory: "/workspace/ax-code",
      sessionID: "ses_live",
      title: "debug queue lifecycle",
      agent: "debug",
    })
  })

  test("targets live queue drafts at a selected worktree directory", async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          id: "tsk_target",
          projectID: "project_live",
          directory: "/workspace/.ax-code/worktrees/wt-target",
          kind: "prompt",
          status: "queued",
          priority: 0,
          position: 0,
          title: "target worktree",
          payload: {},
          time: { created: 1_000 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    try {
      const item = await queueDraftTask({
        config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
        mode: "prompt",
        text: "target worktree",
        targetDirectory: "/workspace/.ax-code/worktrees/wt-target",
      })

      expect(item).toMatchObject({
        id: "tsk_target",
        directory: "/workspace/.ax-code/worktrees/wt-target",
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe("http://127.0.0.1:4096/task-queue")
      expect((requests[0]?.init?.headers as Record<string, string>)["x-ax-code-directory"]).toBe(
        "/workspace/.ax-code/worktrees/wt-target",
      )
      expect((requests[0]?.init?.headers as Record<string, string>)["x-opencode-directory"]).toBe(
        "/workspace/.ax-code/worktrees/wt-target",
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fans out multi-run drafts across new worktree targets", async () => {
    const worktreeCreates: unknown[] = []
    const sessionCreates: unknown[] = []
    const queueCreates: unknown[] = []

    const result = await queueMultiRunTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      text: "Compare two approaches",
      count: 2,
      worktreeNamePrefix: "variant",
      agent: "build",
      client: {
        createSession: async (input) => {
          sessionCreates.push(input)
          return { id: `ses_variant_${sessionCreates.length}` }
        },
        worktree: {
          create: async (input) => {
            worktreeCreates.push(input)
            return {
              directory: `/workspace/.ax-code/worktrees/${input?.name}`,
              name: input?.name ?? "variant",
            }
          },
        },
        taskQueue: {
          enqueue: async (input) => {
            queueCreates.push(input)
            const target = queueCreates.length
            return {
              id: `tsk_variant_${target}`,
              projectID: "project_live",
              directory: `/workspace/.ax-code/worktrees/variant-${target}`,
              kind: input.kind,
              status: "queued",
              priority: input.priority ?? 0,
              position: target,
              title: input.title,
              sessionID: input.sessionID,
              agent: input.agent,
              payload: input.payload ?? {},
              time: { created: 1_000 + target },
            }
          },
        },
      },
    })

    expect(worktreeCreates).toEqual([{ name: "variant-1" }, { name: "variant-2" }])
    expect(sessionCreates).toEqual([
      { title: "Compare two approaches (1/2)" },
      { title: "Compare two approaches (2/2)" },
    ])
    expect(queueCreates).toHaveLength(2)
    expect(queueCreates[0]).toMatchObject({
      kind: "prompt",
      title: "Compare two approaches",
      agent: "build",
      sessionID: "ses_variant_1",
      payload: {
        source: "app.composer",
        mode: "prompt",
        text: "Compare two approaches",
        multiRunIndex: 1,
        multiRunCount: 2,
        worktree: "variant-1",
      },
    })
    expect(queueCreates[1]).toMatchObject({
      kind: "prompt",
      title: "Compare two approaches",
      agent: "build",
      sessionID: "ses_variant_2",
      payload: {
        source: "app.composer",
        mode: "prompt",
        text: "Compare two approaches",
        multiRunIndex: 2,
        multiRunCount: 2,
        worktree: "variant-2",
      },
    })
    expect((queueCreates[0] as { payload: Record<string, unknown> }).payload.multiRunID).toBe(
      (queueCreates[1] as { payload: Record<string, unknown> }).payload.multiRunID,
    )
    expect(result.worktrees.map((worktree) => worktree.directory)).toEqual([
      "/workspace/.ax-code/worktrees/variant-1",
      "/workspace/.ax-code/worktrees/variant-2",
    ])
    expect(result.queue.map((item) => item.directory)).toEqual([
      "/workspace/.ax-code/worktrees/variant-1",
      "/workspace/.ax-code/worktrees/variant-2",
    ])
    expect(result.queue.map((item) => item.sessionID)).toEqual(["ses_variant_1", "ses_variant_2"])
  })

  test("runs live drafts through async session routes", async () => {
    const calls: unknown[] = []

    const result = await runDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      mode: "prompt",
      text: "Implement the review panel",
      agent: "build",
      model: { providerID: "test", modelID: "test-model" },
      client: {
        createSession: async (input) => {
          calls.push({ type: "create", input })
          return { id: "ses_created" }
        },
        sendPrompt: async (sessionID, body, options) => {
          calls.push({ type: "prompt", sessionID, body, options })
        },
      },
    })

    expect(result).toEqual({ accepted: true, sessionID: "ses_created" })
    expect(calls).toEqual([
      { type: "create", input: { title: "Implement the review panel" } },
      {
        type: "prompt",
        sessionID: "ses_created",
        body: {
          parts: [{ type: "text", text: "Implement the review panel" }],
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        },
        options: { mode: "async" },
      },
    ])
  })

  test("runs command and shell drafts with route-compatible payloads", async () => {
    const calls: unknown[] = []

    await runDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      mode: "command",
      text: "review",
      sessionID: "ses_live",
      model: { providerID: "openai", modelID: "gpt-5-codex" },
      client: {
        sendCommand: async (sessionID, body, options) => {
          calls.push({ type: "command", sessionID, body, options })
        },
      },
    })
    await runDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      mode: "shell",
      text: "pnpm typecheck",
      sessionID: "ses_live",
      model: { providerID: "openai", modelID: "gpt-5-codex" },
      client: {
        sendShell: async (sessionID, body, options) => {
          calls.push({ type: "shell", sessionID, body, options })
        },
      },
    })

    expect(calls).toEqual([
      {
        type: "command",
        sessionID: "ses_live",
        body: { command: "review", arguments: "", agent: undefined, model: undefined },
        options: { mode: "async" },
      },
      {
        type: "shell",
        sessionID: "ses_live",
        body: {
          command: "pnpm typecheck",
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5-codex" },
        },
        options: { mode: "async" },
      },
    ])
  })

  test("replies to live permission and question requests through the headless client", async () => {
    const calls: unknown[] = []

    await replyPermissionRequest({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      requestID: "per_live",
      reply: "once",
      client: {
        replyPermission: async (body) => {
          calls.push({ type: "permission", body })
        },
      },
    })
    await replyQuestionRequest({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      requestID: "que_live",
      answers: { target: "main" },
      client: {
        replyQuestion: async (body) => {
          calls.push({ type: "question", body })
        },
      },
    })

    expect(calls).toEqual([
      { type: "permission", body: { requestID: "per_live", reply: "once" } },
      { type: "question", body: { requestID: "que_live", answers: { target: "main" } } },
    ])
  })

  test("runs live queue item commands through the headless queue client", async () => {
    const item = await runQueueItemCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "send-now",
      item: {
        id: "tsk_live",
        project: "project_live",
        title: "debug queue lifecycle",
        kind: "command",
        status: "paused",
        priority: 0,
        createdAt: 1_000,
      },
      client: {
        taskQueue: {
          sendNow: async (id) => ({
            id,
            projectID: "project_live",
            directory: "/workspace/ax-code",
            kind: "command",
            status: "queued",
            priority: 0,
            position: 0,
            title: "debug queue lifecycle",
            payload: {},
            time: { created: 1_000 },
          }),
        },
      },
    })

    expect(item).toMatchObject({ id: "tsk_live", status: "queued" })
  })

  test("reorders live queue items through the headless queue client", async () => {
    const queue = [
      {
        id: "tsk_first",
        project: "project_live",
        title: "first item",
        kind: "prompt" as const,
        status: "queued" as const,
        priority: 0,
        position: 0,
        createdAt: 1_000,
      },
      {
        id: "tsk_second",
        project: "project_live",
        title: "second item",
        kind: "prompt" as const,
        status: "queued" as const,
        priority: 0,
        position: 1,
        createdAt: 1_001,
      },
    ]
    const calls: Array<{ id: string; position: number }> = []

    const item = await runQueueItemCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "move-up",
      item: queue[1]!,
      queue,
      client: {
        taskQueue: {
          reorder: async (id, position) => {
            calls.push({ id, position })
            return {
              id,
              projectID: "project_live",
              directory: "/workspace/ax-code",
              kind: "prompt",
              status: "queued",
              priority: 0,
              position,
              title: "second item",
              payload: {},
              time: { created: 1_001 },
            }
          },
        },
      },
    })

    expect(calls).toEqual([{ id: "tsk_second", position: 0 }])
    expect(item).toMatchObject({ id: "tsk_second", position: 0 })
  })

  test("reorders fixture queue items by adjacent visible position", async () => {
    const queue = [
      {
        id: "tsk_first",
        project: "fixture",
        title: "first item",
        kind: "prompt" as const,
        status: "queued" as const,
        priority: 0,
        position: 0,
        createdAt: 1_000,
      },
      {
        id: "tsk_second",
        project: "fixture",
        title: "second item",
        kind: "prompt" as const,
        status: "queued" as const,
        priority: 0,
        position: 1,
        createdAt: 1_001,
      },
    ]

    const moved = await runQueueItemCommand({
      config: { mode: "fixture" },
      command: "move-down",
      item: queue[0]!,
      queue,
    })

    expect(moved).toMatchObject({ id: "tsk_first", position: 1 })
  })

  test("aborts live sessions through the headless client", async () => {
    const aborted: string[] = []

    await abortSessionTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      sessionID: "ses_live",
      client: {
        abort: async (sessionID) => {
          aborted.push(sessionID)
        },
      },
    })

    expect(aborted).toEqual(["ses_live"])
  })

  test("runs live worktree commands through existing backend APIs", async () => {
    const calls: unknown[] = []
    const created = await runWorktreeCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "create",
      name: "wt-gui",
      client: {
        worktree: {
          create: async (input) => {
            calls.push({ type: "create", input })
            return { directory: "/workspace/.ax-code/worktrees/wt-gui", name: input?.name }
          },
          reset: async (input) => {
            calls.push({ type: "reset", input })
            return true
          },
          remove: async (input) => {
            calls.push({ type: "remove", input })
            return true
          },
        },
      },
    })
    expect(created).toEqual({ directory: "/workspace/.ax-code/worktrees/wt-gui", name: "wt-gui" })

    await runWorktreeCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "reset",
      directory: "/workspace/.ax-code/worktrees/wt-gui",
      client: {
        worktree: {
          reset: async (input) => {
            calls.push({ type: "reset", input })
            return true
          },
        },
      },
    })
    await runWorktreeCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "remove",
      directory: "/workspace/.ax-code/worktrees/wt-gui",
      client: {
        worktree: {
          remove: async (input) => {
            calls.push({ type: "remove", input })
            return true
          },
        },
      },
    })

    expect(calls).toEqual([
      { type: "create", input: { name: "wt-gui" } },
      { type: "reset", input: { directory: "/workspace/.ax-code/worktrees/wt-gui" } },
      { type: "remove", input: { directory: "/workspace/.ax-code/worktrees/wt-gui" } },
    ])
  })

  test("runs terminal and file preview actions through existing backend APIs", async () => {
    const calls: unknown[] = []
    const terminal = await runTerminalCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "create",
      shellCommand: "pnpm dev",
      client: {
        pty: {
          create: async (input) => {
            calls.push({ type: "terminal.create", input })
            return {
              id: "pty_live",
              title: input.title,
              command: input.command,
              args: [],
              cwd: "/workspace/ax-code",
              status: "running",
              pid: 123,
            }
          },
          remove: async (id) => {
            calls.push({ type: "terminal.remove", id })
          },
        },
      },
    })
    expect(terminal).toMatchObject({ id: "pty_live", title: "pnpm dev", status: "running" })

    await runTerminalCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "remove",
      terminalID: "pty_live",
      client: {
        pty: {
          remove: async (id) => {
            calls.push({ type: "terminal.remove", id })
          },
        },
      },
    })

    const preview = await readFilePreview({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      path: "packages/app/src/App.tsx",
      client: {
        file: {
          read: async (path) => {
            calls.push({ type: "file.read", path })
            return { type: "text", content: "export function App() {}", mimeType: "text/typescript" }
          },
        },
      },
    })

    expect(preview).toEqual({
      path: "packages/app/src/App.tsx",
      type: "text",
      content: "export function App() {}",
      mimeType: "text/typescript",
    })
    expect(calls).toEqual([
      { type: "terminal.create", input: { command: "pnpm dev", title: "pnpm dev", cwd: undefined } },
      { type: "terminal.remove", id: "pty_live" },
      { type: "file.read", path: "packages/app/src/App.tsx" },
    ])
  })

  test("reveals file paths through the desktop bridge", async () => {
    const calls: unknown[] = []
    const result = await revealFilePath({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      path: " packages/app/src/App.tsx ",
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            return true
          },
        },
      },
    })

    expect(result).toEqual({ revealed: true, path: "packages/app/src/App.tsx" })
    expect(calls).toEqual([
      {
        name: "path.reveal",
        payload: { path: "packages/app/src/App.tsx" },
      },
    ])
  })

  test("sends scheduled task notifications through the desktop bridge", async () => {
    const calls: unknown[] = []
    const result = await notifyScheduledTaskQueued({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      task: {
        id: "sch_live",
        project: "project_live",
        title: "Daily review",
        prompt: "Review branch",
        schedule: { type: "daily", time: "09:00" },
        status: "active",
        lastQueueID: "tsk_live",
      },
      queueItem: {
        id: "tsk_live",
        project: "project_live",
        title: "Review queued branch",
        kind: "automation",
        status: "queued",
        priority: 0,
        sessionID: "ses_live",
        sourceTaskID: "sch_live",
        createdAt: 100,
      },
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            return true
          },
        },
      },
    })

    expect(result).toEqual({
      notified: true,
      title: "Scheduled automation queued",
      body: "Daily review · Review queued branch · session ses_live",
    })
    expect(calls).toEqual([
      {
        name: "notification.show",
        payload: {
          title: "Scheduled automation queued",
          body: "Daily review · Review queued branch · session ses_live",
          source: "scheduled-task",
        },
      },
    ])
  })

  test("runs live scheduled task commands through the headless client", async () => {
    const result = await runScheduledTaskCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "run-now",
      task: {
        id: "sch_live",
        project: "project_live",
        title: "Daily review",
        prompt: "Review the branch",
        schedule: { type: "daily", time: "09:00" },
        status: "active",
      },
      client: {
        scheduledTask: {
          runNow: async (id) => ({
            task: {
              id,
              projectID: "project_live",
              directory: "/workspace/ax-code",
              title: "Daily review",
              prompt: "Review the branch",
              schedule: { type: "daily", time: "09:00" },
              status: "active",
              lastQueueID: "tsk_automation",
              time: { created: 1_000 },
            },
            queueItem: {
              id: "tsk_automation",
              projectID: "project_live",
              directory: "/workspace/ax-code",
              kind: "automation",
              status: "queued",
              priority: 0,
              position: 0,
              title: "Daily review",
              payload: {},
              time: { created: 1_000 },
            },
          }),
        },
      },
    })

    expect(result.task).toMatchObject({ id: "sch_live", lastQueueID: "tsk_automation" })
    expect(result.queueItem).toMatchObject({ id: "tsk_automation", kind: "automation", status: "queued" })
  })

  test("creates live scheduled daily prompts through the headless client", async () => {
    const calls: unknown[] = []
    const task = await createScheduledTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      title: "Daily review",
      prompt: "Review branch",
      time: "09:00",
      agent: "review",
      client: {
        scheduledTask: {
          create: async (input) => {
            calls.push(input)
            return {
              id: "sch_live",
              projectID: "project_live",
              directory: "/workspace/ax-code",
              title: input.title,
              prompt: input.prompt,
              schedule: input.schedule,
              status: "active",
              agent: input.agent,
              time: { created: 1_000 },
            }
          },
        },
      },
    })

    expect(calls).toEqual([
      {
        title: "Daily review",
        prompt: "Review branch",
        schedule: { type: "daily", time: "09:00" },
        agent: "review",
        model: undefined,
      },
    ])
    expect(task).toMatchObject({ id: "sch_live", title: "Daily review", status: "active", agent: "review" })
  })

  test("runs review rollback commands through the headless client", async () => {
    const calls: unknown[] = []

    await runReviewCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "revert",
      sessionID: "ses_live",
      rollbackPoint: {
        step: 4,
        messageID: "msg_assistant",
        partID: "part_step",
        tools: ["apply_patch: packages/app/src/App.tsx"],
        kinds: ["apply_patch"],
      },
      client: {
        review: {
          revert: async (input) => {
            calls.push({ type: "revert", input })
          },
        },
      },
    })

    await runReviewCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "unrevert",
      sessionID: "ses_live",
      client: {
        review: {
          unrevert: async (sessionID) => {
            calls.push({ type: "unrevert", sessionID })
          },
        },
      },
    })

    expect(calls).toEqual([
      {
        type: "revert",
        input: {
          sessionID: "ses_live",
          messageID: "msg_assistant",
          partID: "part_step",
        },
      },
      { type: "unrevert", sessionID: "ses_live" },
    ])
  })

  test("compares sessions and queues review comments through review actions", async () => {
    const calls: unknown[] = []
    const comparison = await compareReviewSessions({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      sessionID: "ses_a",
      otherSessionID: "ses_b",
      deep: true,
      client: {
        review: {
          compare: async (input) => {
            calls.push({ type: "compare", input })
            return {
              session1: {
                id: input.sessionID,
                title: "Approach A",
                risk: { score: 30 },
                decision: { total: 0.8 },
                headline: "Keeps queue narrow",
              },
              session2: {
                id: input.otherSessionID,
                title: "Approach B",
                risk: { score: 55 },
                decision: { total: 0.6 },
                headline: "Touches scheduler",
              },
              advisory: { winner: "A", confidence: 0.72, reasons: ["lower risk"] },
              decision: {
                winner: "A",
                confidence: 0.72,
                recommendation: "Prefer Approach A",
                reasons: ["lower risk"],
                differences: ["risk: 30/100 vs 55/100"],
              },
            }
          },
        },
      },
    })

    expect(comparison).toMatchObject({
      winner: "A",
      confidence: 0.72,
      recommendation: "Prefer Approach A",
      session1: { id: "ses_a", title: "Approach A", riskScore: 30, decisionScore: 0.8 },
      session2: { id: "ses_b", title: "Approach B", riskScore: 55, decisionScore: 0.6 },
      reasons: ["lower risk"],
      differences: ["risk: 30/100 vs 55/100"],
    })

    const item = await queueReviewComment({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      sessionID: "ses_a",
      text: " Ask for targeted verification on the lower-risk branch. ",
      comparison,
      client: {
        taskQueue: {
          enqueue: async (input) => {
            calls.push({ type: "enqueue", input })
            return {
              id: "tsk_review_note",
              projectID: "project_live",
              kind: input.kind,
              status: "queued",
              priority: 0,
              title: input.title,
              sessionID: input.sessionID,
              payload: input.payload,
              time: { created: 1_000 },
            }
          },
        },
      },
    })

    expect(item).toMatchObject({ id: "tsk_review_note", kind: "review", sessionID: "ses_a" })
    expect(calls).toEqual([
      { type: "compare", input: { sessionID: "ses_a", otherSessionID: "ses_b", deep: true } },
      {
        type: "enqueue",
        input: {
          sessionID: "ses_a",
          kind: "review",
          title: "Review note: Ask for targeted verification on the lower-risk branch.",
          payload: {
            source: "app.review",
            mode: "comment",
            text: "Ask for targeted verification on the lower-risk branch.",
            compare: {
              session1: "ses_a",
              session2: "ses_b",
              winner: "A",
            },
          },
        },
      },
    ])
  })
})
