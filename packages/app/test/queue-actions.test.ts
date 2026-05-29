import { describe, expect, test } from "bun:test"
import {
  abortSessionTask,
  attachToBackendUrl,
  chooseAndStartProjectDirectory,
  compareReviewSessions,
  createComposerAttachmentDraft,
  createScheduledTask,
  createSessionAction,
  editQueueItem,
  notifyScheduledTaskQueued,
  openBrowserPreviewUrl,
  openFileInEditor,
  permissionAutoAcceptAllowed,
  queueItemCommandAvailable,
  queueBrowserVerificationTask,
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
  updateProjectSettings,
} from "../src/runtime/actions"

describe("queue draft task action", () => {
  test("allows permission auto-accept only when backend exposes always patterns", () => {
    expect(permissionAutoAcceptAllowed({ always: ["pnpm test"] })).toBe(true)
    expect(permissionAutoAcceptAllowed({ always: ["  "] })).toBe(false)
    expect(permissionAutoAcceptAllowed({ always: [] })).toBe(false)
    expect(permissionAutoAcceptAllowed({})).toBe(false)
  })

  test("creates fixture sessions as renderer-reconstructable local state", async () => {
    const session = await createSessionAction({
      config: { mode: "fixture" },
      title: "  ",
      targetDirectory: "/workspace/.ax-code/worktrees/wt-session",
    })

    expect(session).toMatchObject({
      title: "New session",
      project: "fixture",
      worktree: "/workspace/.ax-code/worktrees/wt-session",
    })
    expect(session.id).toStartWith("ses_fixture_new_")
    expect(session.updatedAt).toBeGreaterThan(0)
  })

  test("creates live sessions through the headless session contract", async () => {
    const requests: unknown[] = []
    const session = await createSessionAction({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096", directory: "/workspace/ax-code" },
      title: "  Investigate queue pressure  ",
      targetDirectory: "/workspace/.ax-code/worktrees/wt-session",
      client: {
        createSession: async (input) => {
          requests.push(input)
          return {
            id: "ses_created",
            title: input?.title,
            project: "ax-code",
            updatedAt: 1_000,
          }
        },
      },
    })

    expect(requests).toEqual([{ title: "Investigate queue pressure" }])
    expect(session).toEqual({
      id: "ses_created",
      title: "Investigate queue pressure",
      project: "ax-code",
      worktree: "/workspace/.ax-code/worktrees/wt-session",
      updatedAt: 1_000,
    })
  })

  test("chooses a desktop project directory and reloads live app config", async () => {
    const calls: unknown[] = []
    const result = await chooseAndStartProjectDirectory({
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            if (name === "dialog.chooseDirectory") return { canceled: false, path: "/workspace/new-project" }
            if (name === "backend.start") return { url: "http://127.0.0.1:4555" }
            if (name === "app.config") {
              return {
                mode: "live",
                baseUrl: "http://127.0.0.1:4555",
                headers: { Authorization: "Basic generated" },
                directory: "/workspace/new-project",
                features: { terminalPane: true, browserPane: false, filePane: true },
                scheduledTaskExecution: { owner: "desktop-sidecar", stopsOnAppQuit: true },
              }
            }
            throw new Error(`unexpected command ${name}`)
          },
        },
      },
    })

    expect(calls).toEqual([
      { name: "dialog.chooseDirectory", payload: { title: "Open AX Code project" } },
      { name: "backend.start", payload: { directory: "/workspace/new-project" } },
      { name: "app.config", payload: {} },
    ])
    expect(result).toEqual({
      changed: true,
      directory: "/workspace/new-project",
      config: {
        mode: "live",
        baseUrl: "http://127.0.0.1:4555",
        headers: { Authorization: "Basic generated" },
        directory: "/workspace/new-project",
        features: { terminalPane: true, browserPane: false, filePane: true },
        scheduledTaskExecution: { owner: "desktop-sidecar", stopsOnAppQuit: true },
      },
    })
  })

  test("does not start a backend when desktop project selection is cancelled", async () => {
    const calls: unknown[] = []
    const result = await chooseAndStartProjectDirectory({
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            return { canceled: true }
          },
        },
      },
    })

    expect(result).toEqual({ changed: false, canceled: true })
    expect(calls).toEqual([{ name: "dialog.chooseDirectory", payload: { title: "Open AX Code project" } }])
  })

  test("attaches to an existing loopback desktop backend and reloads live app config", async () => {
    const calls: unknown[] = []
    const result = await attachToBackendUrl({
      baseUrl: " http://localhost:4555 ",
      authHeader: " Bearer local-token ",
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            if (name === "backend.attach") return { connected: true }
            if (name === "app.config") {
              return {
                mode: "live",
                baseUrl: "http://localhost:4555/",
                headers: { Authorization: "Bearer local-token" },
                directory: "/workspace/attached-project",
                features: { terminalPane: true, browserPane: true, filePane: true },
                scheduledTaskExecution: { owner: "attached-backend", stopsOnAppQuit: false },
              }
            }
            throw new Error(`unexpected command ${name}`)
          },
        },
      },
    })

    expect(calls).toEqual([
      { name: "backend.attach", payload: { baseUrl: "http://localhost:4555/", authHeader: "Bearer local-token" } },
      { name: "app.config", payload: {} },
    ])
    expect(result).toEqual({
      changed: true,
      baseUrl: "http://localhost:4555/",
      config: {
        mode: "live",
        baseUrl: "http://localhost:4555/",
        headers: { Authorization: "Bearer local-token" },
        directory: "/workspace/attached-project",
        features: { terminalPane: true, browserPane: true, filePane: true },
        scheduledTaskExecution: { owner: "attached-backend", stopsOnAppQuit: false },
      },
    })
  })

  test("rejects non-loopback backend attach URLs before invoking desktop bridge", async () => {
    const calls: unknown[] = []
    await expect(
      attachToBackendUrl({
        baseUrl: "https://example.com",
        client: {
          desktopBridge: {
            async invoke(name, payload) {
              calls.push({ name, payload })
              return {}
            },
          },
        },
      }),
    ).rejects.toThrow("Attach backend URL must use http(s) loopback")
    expect(calls).toEqual([])
  })

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
      worktree: "/workspace/.ax-code/worktrees/wt-gui",
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

  test("preserves composer attachments in live prompt queue payloads", async () => {
    const requests: unknown[] = []
    const attachment = createComposerAttachmentDraft({
      kind: "context",
      path: "packages/app/src/App.tsx",
      startLine: 10,
      endLine: 20,
    })

    await queueDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096", directory: "/workspace/ax-code" },
      mode: "prompt",
      text: "Review this component",
      sessionID: "ses_live",
      attachments: [attachment],
      client: {
        taskQueue: {
          enqueue: async (input) => {
            requests.push(input)
            return {
              id: "tsk_live_attachment",
              projectID: "project_live",
              directory: "/workspace/ax-code",
              sessionID: input.sessionID,
              kind: input.kind,
              status: "queued",
              priority: input.priority ?? 0,
              position: 0,
              title: input.title,
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
        kind: "prompt",
        title: "Review this component",
        agent: undefined,
        model: undefined,
        payload: {
          source: "app.composer",
          mode: "prompt",
          text: "Review this component",
          attachments: [attachment],
          body: {
            parts: [
              { type: "text", text: "Review this component" },
              {
                type: "file",
                url: "file:///workspace/ax-code/packages/app/src/App.tsx?start=9&end=19",
                mime: "text/plain",
                filename: "App.tsx",
              },
            ],
            agent: undefined,
            model: undefined,
          },
        },
      },
    ])
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
      expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
        worktree: "/workspace/.ax-code/worktrees/wt-target",
      })
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
              worktree: input.worktree,
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
      worktree: "variant-1",
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
      worktree: "variant-2",
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
    expect(result.queue.map((item) => item.worktree)).toEqual(["variant-1", "variant-2"])
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

  test("runs live prompt and command drafts with supported attachments", async () => {
    const calls: unknown[] = []
    const textAttachment = createComposerAttachmentDraft({
      kind: "file",
      path: "README.md",
    })
    const imageAttachment = createComposerAttachmentDraft({
      kind: "image",
      path: "/workspace/ax-code/screenshot.png",
    })

    await runDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096", directory: "/workspace/ax-code" },
      mode: "prompt",
      text: "Explain the attached files",
      sessionID: "ses_live",
      attachments: [textAttachment, imageAttachment],
      client: {
        sendPrompt: async (sessionID, body, options) => {
          calls.push({ type: "prompt", sessionID, body, options })
        },
      },
    })
    await runDraftTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096", directory: "/workspace/ax-code" },
      mode: "command",
      text: "review",
      sessionID: "ses_live",
      attachments: [textAttachment],
      client: {
        sendCommand: async (sessionID, body, options) => {
          calls.push({ type: "command", sessionID, body, options })
        },
      },
    })

    expect(calls).toEqual([
      {
        type: "prompt",
        sessionID: "ses_live",
        body: {
          parts: [
            { type: "text", text: "Explain the attached files" },
            {
              type: "file",
              url: "file:///workspace/ax-code/README.md",
              mime: "text/plain",
              filename: "README.md",
            },
            {
              type: "file",
              url: "file:///workspace/ax-code/screenshot.png",
              mime: "image/png",
              filename: "screenshot.png",
            },
          ],
          agent: undefined,
          model: undefined,
        },
        options: { mode: "async" },
      },
      {
        type: "command",
        sessionID: "ses_live",
        body: {
          command: "review",
          arguments: "",
          agent: undefined,
          model: undefined,
          parts: [
            {
              type: "file",
              url: "file:///workspace/ax-code/README.md",
              mime: "text/plain",
              filename: "README.md",
            },
          ],
        },
        options: { mode: "async" },
      },
    ])
    await expect(
      runDraftTask({
        config: { mode: "live", baseUrl: "http://127.0.0.1:4096", directory: "/workspace/ax-code" },
        mode: "shell",
        text: "pnpm test",
        sessionID: "ses_live",
        attachments: [textAttachment],
        client: {
          sendShell: async () => {},
        },
      }),
    ).rejects.toThrow("Shell drafts do not support attachments")
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
    await replyPermissionRequest({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      requestID: "per_live_always",
      reply: "always",
      client: {
        replyPermission: async (body) => {
          calls.push({ type: "permission", body })
        },
      },
    })
    await replyQuestionRequest({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      requestID: "que_live",
      answers: [["main"]],
      client: {
        replyQuestion: async (body) => {
          calls.push({ type: "question", body })
        },
      },
    })

    expect(calls).toEqual([
      { type: "permission", body: { requestID: "per_live", reply: "once" } },
      { type: "permission", body: { requestID: "per_live_always", reply: "always" } },
      { type: "question", body: { requestID: "que_live", answers: [["main"]] } },
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

  test("guards queue item commands by lifecycle state before calling the backend", async () => {
    const runningItem = {
      id: "tsk_running",
      project: "project_live",
      title: "running work",
      kind: "prompt" as const,
      status: "running" as const,
      priority: 0,
      createdAt: 1_000,
    }
    let calls = 0

    expect(queueItemCommandAvailable(runningItem, "pause")).toBe(false)
    expect(queueItemCommandAvailable(runningItem, "cancel")).toBe(false)
    expect(queueItemCommandAvailable({ ...runningItem, status: "failed" }, "retry")).toBe(true)

    await expect(
      runQueueItemCommand({
        config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
        command: "pause",
        item: runningItem,
        client: {
          taskQueue: {
            pause: async () => {
              calls++
              return runningItem
            },
          },
        },
      }),
    ).rejects.toThrow("not available")
    expect(calls).toBe(0)
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

  test("removes live queue items through the headless queue client", async () => {
    const removed: string[] = []
    const result = await runQueueItemCommand({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      command: "remove",
      item: {
        id: "tsk_remove",
        project: "project_live",
        title: "remove queued work",
        kind: "prompt",
        status: "queued",
        priority: 0,
        createdAt: 1_000,
      },
      client: {
        taskQueue: {
          remove: async (id) => {
            removed.push(id)
            return true
          },
        },
      },
    })

    expect(removed).toEqual(["tsk_remove"])
    expect(result).toEqual({ removed: true, id: "tsk_remove" })
  })

  test("edits live queue items through the headless queue client", async () => {
    const calls: unknown[] = []
    const item = await editQueueItem({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      item: {
        id: "tsk_edit",
        project: "project_live",
        title: "old queued work",
        kind: "prompt",
        status: "queued",
        priority: 0,
        payload: {
          source: "app.composer",
          mode: "prompt",
          text: "old text",
          body: {
            parts: [{ type: "text", text: "old text" }],
          },
        },
        createdAt: 1_000,
      },
      title: "Edited queued work",
      text: "edited text",
      client: {
        taskQueue: {
          edit: async (id, input) => {
            calls.push({ id, input })
            return {
              id,
              projectID: "project_live",
              directory: "/workspace/ax-code",
              kind: "prompt",
              status: "queued",
              priority: 0,
              position: 0,
              title: input.title,
              payload: input.payload,
              time: { created: 1_000 },
            }
          },
        },
      },
    })

    expect(calls).toEqual([
      {
        id: "tsk_edit",
        input: {
          title: "Edited queued work",
          payload: {
            source: "app.composer",
            mode: "prompt",
            text: "edited text",
            body: {
              parts: [{ type: "text", text: "edited text" }],
            },
          },
        },
      },
    ])
    expect(item).toMatchObject({
      id: "tsk_edit",
      title: "Edited queued work",
      payload: { text: "edited text" },
    })
  })

  test("edits fixture queue items without leaving renderer-only state", async () => {
    const item = await editQueueItem({
      config: { mode: "fixture" },
      item: {
        id: "tsk_fixture_edit",
        project: "fixture",
        title: "old fixture work",
        kind: "command",
        status: "paused",
        priority: 0,
        payload: {
          mode: "command",
          text: "old command",
          body: { command: "old command", arguments: "" },
        },
        createdAt: 1_000,
      },
      title: "Edited fixture work",
      text: "edited command",
    })

    expect(item).toMatchObject({
      id: "tsk_fixture_edit",
      title: "Edited fixture work",
      payload: {
        text: "edited command",
        body: { command: "edited command", arguments: "" },
      },
    })
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

  test("removes fixture queue items for local preview mode", async () => {
    const result = await runQueueItemCommand({
      config: { mode: "fixture" },
      command: "remove",
      item: {
        id: "tsk_fixture_remove",
        project: "fixture",
        title: "remove fixture work",
        kind: "prompt",
        status: "queued",
        priority: 0,
        createdAt: 1_000,
      },
    })

    expect(result).toEqual({ removed: true, id: "tsk_fixture_remove" })
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
      cwd: "/workspace/ax-code/.worktrees/frontend",
      sessionID: "ses_live",
      sessionTitle: "Frontend fix",
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
    expect(terminal).toMatchObject({
      id: "pty_live",
      title: "pnpm dev",
      status: "running",
      sessionID: "ses_live",
      sessionTitle: "Frontend fix",
    })

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
      {
        type: "terminal.create",
        input: { command: "pnpm dev", title: "pnpm dev", cwd: "/workspace/ax-code/.worktrees/frontend" },
      },
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

  test("opens file paths through the desktop editor bridge", async () => {
    const calls: unknown[] = []
    const result = await openFileInEditor({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      path: " packages/app/src/App.tsx ",
      line: 12,
      column: 3,
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            return true
          },
        },
      },
    })

    expect(result).toEqual({ opened: true, path: "packages/app/src/App.tsx", line: 12, column: 3 })
    expect(calls).toEqual([
      {
        name: "editor.open",
        payload: { path: "packages/app/src/App.tsx", line: 12, column: 3 },
      },
    ])
    await expect(
      openFileInEditor({
        config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
        path: "packages/app/src/App.tsx",
        line: 0,
        client: { desktopBridge: { async invoke() {} } },
      }),
    ).rejects.toThrow("Editor line must be a positive integer")
  })

  test("opens browser preview URLs through the desktop bridge", async () => {
    const calls: unknown[] = []
    const result = await openBrowserPreviewUrl({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      url: " http://127.0.0.1:3000/dashboard ",
      client: {
        desktopBridge: {
          async invoke(name, payload) {
            calls.push({ name, payload })
            return true
          },
        },
      },
    })

    expect(result).toEqual({ opened: true, url: "http://127.0.0.1:3000/dashboard" })
    expect(calls).toEqual([
      {
        name: "external.open",
        payload: { url: "http://127.0.0.1:3000/dashboard" },
      },
    ])
    await expect(
      openBrowserPreviewUrl({
        config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
        url: "file:///tmp/index.html",
        client: { desktopBridge: { async invoke() {} } },
      }),
    ).rejects.toThrow("Browser preview URL must use http or https")
  })

  test("queues browser preview verification through the server-owned task queue", async () => {
    const requests: unknown[] = []
    const item = await queueBrowserVerificationTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096", directory: "/workspace/ax-code" },
      url: " http://127.0.0.1:5173/dashboard ",
      sessionID: "ses_live",
      targetDirectory: "/workspace/ax-code/.worktrees/frontend",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5-codex" },
      client: {
        taskQueue: {
          async enqueue(input) {
            requests.push(input)
            return {
              id: "tsk_browser_verify",
              projectID: "project_live",
              sessionID: input.sessionID,
              title: input.title,
              kind: input.kind,
              status: "queued",
              worktree: input.worktree,
              agent: input.agent,
              model: input.model,
              payload: input.payload,
              createdAt: 1_000,
            }
          },
        },
      },
    })

    expect(requests).toEqual([
      {
        sessionID: "ses_live",
        kind: "prompt",
        title: "Verify browser preview",
        worktree: "/workspace/ax-code/.worktrees/frontend",
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5-codex" },
        payload: {
          source: "app.browser-preview",
          mode: "prompt",
          text: expect.stringContaining("http://127.0.0.1:5173/dashboard"),
          browserPreviewUrl: "http://127.0.0.1:5173/dashboard",
          verification: "playwright-mcp",
        },
      },
    ])
    expect(item).toMatchObject({
      id: "tsk_browser_verify",
      sessionID: "ses_live",
      title: "Verify browser preview",
      kind: "prompt",
      status: "queued",
      worktree: "/workspace/ax-code/.worktrees/frontend",
      payload: {
        source: "app.browser-preview",
        browserPreviewUrl: "http://127.0.0.1:5173/dashboard",
        verification: "playwright-mcp",
      },
    })
  })

  test("rejects browser preview verification for non-http URLs", async () => {
    await expect(
      queueBrowserVerificationTask({
        config: { mode: "fixture" },
        url: "file:///tmp/index.html",
      }),
    ).rejects.toThrow("Browser verification URL must use http or https")
  })

  test("updates project settings through the live config client", async () => {
    const calls: unknown[] = []
    const result = await updateProjectSettings({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      model: { providerID: "openai", modelID: "gpt-5-codex" },
      client: {
        config: {
          update: async (input) => {
            calls.push(input)
            return { model: input.model }
          },
        },
      },
    })

    expect(result).toEqual({ updated: true, reloadRequired: true, model: "openai/gpt-5-codex" })
    expect(calls).toEqual([{ model: "openai/gpt-5-codex" }])
    await expect(
      updateProjectSettings({
        config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
        client: { config: { async update() {} } },
      }),
    ).rejects.toThrow("Select at least one setting to apply")
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

  test("creates weekly, once, and cron scheduled prompts through the headless client", async () => {
    const calls: unknown[] = []
    const client = {
      scheduledTask: {
        create: async (input: {
          title: string
          prompt: string
          schedule: unknown
          agent?: string
          model?: unknown
        }) => {
          calls.push(input)
          return {
            id: `sch_${calls.length}`,
            projectID: "project_live",
            directory: "/workspace/ax-code",
            title: input.title,
            prompt: input.prompt,
            schedule: input.schedule,
            status: "active",
            time: { created: 1_000 },
          }
        },
      },
    }

    await createScheduledTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      title: "Weekly review",
      prompt: "Review branch",
      schedule: { type: "weekly", day: 1, time: "10:30" },
      client,
    })
    await createScheduledTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      title: "One-off review",
      prompt: "Review branch",
      schedule: { type: "once", runAt: 1_800_000_000_000 },
      client,
    })
    await createScheduledTask({
      config: { mode: "live", baseUrl: "http://127.0.0.1:4096" },
      title: "Cron review",
      prompt: "Review branch",
      schedule: { type: "cron", expression: "0 9 * * 1-5" },
      client,
    })

    expect(calls.map((call) => (call as { schedule: unknown }).schedule)).toEqual([
      { type: "weekly", day: 1, time: "10:30" },
      { type: "once", runAt: 1_800_000_000_000 },
      { type: "cron", expression: "0 9 * * 1-5" },
    ])
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
