import { describe, test, expect } from "bun:test"
import {
  createHeadlessClient,
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
  isHeadlessRuntimeEvent,
  runtimeProbeKeysForEvent,
  HEADLESS_RUNTIME_EVENT_TYPES,
  HEADLESS_RUNTIME_SCHEMA_VERSION,
  parseHeadlessRuntimeResponseBody,
} from "../src/headless.js"

describe("headless SDK types", () => {
  test("HEADLESS_RUNTIME_EVENT_TYPES includes session.error", () => {
    expect(HEADLESS_RUNTIME_EVENT_TYPES.has("session.error")).toBe(true)
    expect(HEADLESS_RUNTIME_EVENT_TYPES.has("scheduled.task.created")).toBe(true)
    expect(HEADLESS_RUNTIME_EVENT_TYPES.has("workflow.verification.attached")).toBe(true)
  })

  test("exports a headless runtime schema version", () => {
    expect(HEADLESS_RUNTIME_SCHEMA_VERSION).toBe(1)
  })

  test("isHeadlessRuntimeEvent recognizes known types", () => {
    expect(isHeadlessRuntimeEvent({ type: "session.created", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "session.error", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "workflow.budget.exceeded", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "unknown.event" })).toBe(false)
    expect(isHeadlessRuntimeEvent(null)).toBe(false)
  })

  test("createHeadlessProjectionState has session_error and stream health", () => {
    const state = createHeadlessProjectionState()
    expect(state.session_error).toEqual({})
    expect(state.stream_health).toBe("connecting")
  })

  test("applyHeadlessProjectionEvent tracks stream health", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >({ streamHealth: "fixture" })
    expect(state.stream_health).toBe("fixture")

    applyHeadlessProjectionEvent(state, { type: "server.connected", properties: {} })
    expect(state.stream_health).toBe("connected")

    applyHeadlessProjectionEvent(state, { type: "server.instance.disposed" })
    expect(state.stream_health).toBe("unavailable")
  })

  test("applyHeadlessProjectionEvent handles session.error", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const result = applyHeadlessProjectionEvent(state, {
      type: "session.error",
      properties: { sessionID: "sess-1", error: { message: "Provider failed" } },
    })
    expect(result.handled).toBe(true)
    expect(state.session_error["sess-1"]).toEqual({ message: "Provider failed" })
  })

  test("projection fixtures cover app-visible session, queue, and blocked states", () => {
    type TestSession = { id: string; title?: string; metadata?: Record<string, unknown> }
    type TestStatus = { type: "idle" | "busy" | "failed"; waitState?: "llm" | "tool"; error?: string }
    type TestMessage = { id: string; sessionID: string; role: "user" | "assistant" }
    type TestPart = { id: string; messageID: string; type?: string; text?: string }
    type TestTaskQueueItem = { id: string; sessionID?: string; status: "queued" | "running" | "completed" }

    const state = createHeadlessProjectionState<
      TestSession,
      { id: string; content: string },
      { path: string },
      TestStatus,
      TestMessage,
      TestPart,
      unknown,
      unknown,
      TestTaskQueueItem
    >({ streamHealth: "fixture" })

    const events = [
      { type: "server.connected", properties: {} },
      { type: "session.created", properties: { info: { id: "ses_1", title: "Fixture" } } },
      { type: "session.status", properties: { sessionID: "ses_1", status: { type: "idle" } } },
      {
        type: "message.updated",
        properties: { info: { id: "msg_1", sessionID: "ses_1", role: "user" } },
      },
      {
        type: "message.part.updated",
        properties: { part: { id: "part_1", messageID: "msg_1", type: "text", text: "hel" } },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "msg_1", partID: "part_1", field: "text", delta: "lo" },
      },
      {
        type: "permission.asked",
        properties: { id: "perm_1", sessionID: "ses_1", permission: "shell", patterns: [], metadata: {}, always: [] },
      },
      {
        type: "question.asked",
        properties: { id: "question_1", sessionID: "ses_1", questions: [], metadata: {} },
      },
      {
        type: "task.queue.created",
        properties: { item: { id: "task_1", sessionID: "ses_1", status: "queued" } },
      },
      {
        type: "task.queue.updated",
        properties: { item: { id: "task_1", sessionID: "ses_1", status: "running" } },
      },
      {
        type: "session.updated",
        properties: { info: { id: "ses_1", title: "Fixture", metadata: { app: { pinned: true } } } },
      },
      {
        type: "session.status",
        properties: { sessionID: "ses_1", status: { type: "failed", error: "tool failed" } },
      },
    ] as const

    for (const event of events) applyHeadlessProjectionEvent(state, event)

    expect(state.stream_health).toBe("connected")
    expect(state.session).toEqual([{ id: "ses_1", title: "Fixture", metadata: { app: { pinned: true } } }])
    expect(state.session_status.ses_1).toEqual({ type: "failed", error: "tool failed" })
    expect(state.message.ses_1).toEqual([{ id: "msg_1", sessionID: "ses_1", role: "user" }])
    expect(state.part.msg_1).toEqual([{ id: "part_1", messageID: "msg_1", type: "text", text: "hello" }])
    expect(state.permission.ses_1).toHaveLength(1)
    expect(state.question.ses_1).toHaveLength(1)
    expect(state.task_queue).toEqual([{ id: "task_1", sessionID: "ses_1", status: "running" }])
  })

  test("session.deleted clears session_error", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    applyHeadlessProjectionEvent(state, {
      type: "session.error",
      properties: { sessionID: "sess-1", error: "oops" },
    })
    applyHeadlessProjectionEvent(state, {
      type: "session.deleted",
      properties: { info: { id: "sess-1" } },
    })
    expect(state.session_error["sess-1"]).toBeUndefined()
  })

  test("permission.asked goes to supervised queue when autonomous is false", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const perm = {
      id: "req-1",
      sessionID: "sess-1",
      type: "bash",
      title: "Run command",
      description: "",
      command: "ls",
    } as any
    applyHeadlessProjectionEvent(state, { type: "permission.asked", properties: perm })
    expect(state.permission["sess-1"]).toHaveLength(1)
  })

  test("permission.asked auto-replies when autonomous is true", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const perm = { id: "req-1", sessionID: "sess-1", type: "bash", title: "Run", description: "", command: "ls" } as any
    const result = applyHeadlessProjectionEvent(
      state,
      { type: "permission.asked", properties: perm },
      { autonomous: true },
    )
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0].type).toBe("permission.auto_reply")
    expect(state.permission["sess-1"] ?? []).toHaveLength(0)
  })

  test("workflow runtime events request workflow probe refreshes", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const event = {
      type: "workflow.artifact.written",
      properties: { artifact: { id: "wfa-1", runID: "wfr-1" } },
    } as const

    const result = applyHeadlessProjectionEvent(state, event)

    expect(result).toEqual({ handled: true, effects: [{ type: "runtime.probe", key: "workflow" }] })
    expect(runtimeProbeKeysForEvent(event)).toEqual(["workflow"])
  })

  test("createHeadlessClient sends async prompt commands through the headless route", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      headers: { Authorization: "Basic token" },
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: url.toString(), init: init ?? {} })
        return new Response("", { status: 202 })
      }) as typeof fetch,
    })

    await client.sendPrompt("sess-1", { parts: [{ type: "text", text: "hello" }] })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://127.0.0.1:4096/session/sess-1/prompt_async")
    expect(calls[0].init.method).toBe("POST")
    expect(calls[0].init.headers).toEqual({
      Authorization: "Basic token",
      "Content-Type": "application/json",
    })
    expect(calls[0].init.body).toBe(JSON.stringify({ parts: [{ type: "text", text: "hello" }] }))
  })

  test("createHeadlessClient sends sync shell and abort commands through explicit routes", async () => {
    const calls: string[] = []
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo) => {
        calls.push(url.toString())
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }) as typeof fetch,
    })

    await client.sendShell("sess-1", { command: "pwd" }, { mode: "sync" })
    await client.abort("sess-1")

    expect(calls).toEqual(["http://127.0.0.1:4096/session/sess-1/shell", "http://127.0.0.1:4096/session/sess-1/abort"])
  })

  test("createHeadlessClient command helpers are safe to destructure", async () => {
    const calls: string[] = []
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo) => {
        calls.push(url.toString())
        return new Response("", { status: 202 })
      }) as typeof fetch,
    })
    const { sendCommand } = client

    await sendCommand("sess-1", { command: "init" })

    expect(calls).toEqual(["http://127.0.0.1:4096/session/sess-1/command_async"])
  })

  test("createHeadlessClient loads session evidence through review routes", async () => {
    const calls: string[] = []
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo) => {
        const href = url.toString()
        calls.push(href)
        if (href.includes("/rollback")) return new Response(JSON.stringify([{ step: 2 }]), { status: 200 })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }) as typeof fetch,
    })

    const evidence = await client.sessionEvidence.load("sess-1", { includeBranchRank: true })

    expect(calls.map((url) => new URL(url).pathname).sort()).toEqual([
      "/session/sess-1/branch/rank",
      "/session/sess-1/diff/semantic",
      "/session/sess-1/dre",
      "/session/sess-1/risk",
      "/session/sess-1/rollback",
    ])
    expect(new URL(calls.find((url) => url.includes("/risk"))!).searchParams.get("reviewResults")).toBe("true")
    expect(evidence.rollback).toEqual([{ step: 2 }])
    expect(evidence.errors).toEqual([])
  })

  test("createHeadlessClient exposes scheduled task commands", async () => {
    const calls: Array<{ pathname: string; method?: string; body?: BodyInit | null }> = []
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const parsed = new URL(url.toString())
        calls.push({ pathname: parsed.pathname, method: init?.method, body: init?.body })
        if (parsed.pathname.endsWith("/run-now")) {
          return new Response(
            JSON.stringify({
              task: {
                id: "sch_live",
                projectID: "project_live",
                directory: "/workspace/ax-code",
                title: "Daily review",
                prompt: "Review branch",
                schedule: { type: "daily", time: "09:00" },
                status: "active",
                time: { created: 1 },
              },
              queueItem: {
                id: "tsk_live",
                projectID: "project_live",
                directory: "/workspace/ax-code",
                kind: "automation",
                status: "queued",
                priority: 0,
                position: 0,
                title: "Daily review",
                payload: {},
                time: { created: 1 },
              },
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            id: "sch_live",
            projectID: "project_live",
            directory: "/workspace/ax-code",
            title: "Daily review",
            prompt: "Review branch",
            schedule: { type: "daily", time: "09:00" },
            status: "active",
            time: { created: 1 },
          }),
          { status: 200 },
        )
      }) as typeof fetch,
    })

    await client.scheduledTask.create({
      title: "Daily review",
      prompt: "Review branch",
      schedule: { type: "daily", time: "09:00" },
      workflowTemplateID: "builtin:noop-dry-run",
      workflowStartOptions: { enqueueChildren: true },
    })
    await client.scheduledTask.runNow("sch_live")

    expect(calls.map((call) => [call.method, call.pathname])).toEqual([
      ["POST", "/scheduled-task"],
      ["POST", "/scheduled-task/sch_live/run-now"],
    ])
    expect(calls[0].body).toBe(
      JSON.stringify({
        title: "Daily review",
        prompt: "Review branch",
        schedule: { type: "daily", time: "09:00" },
        workflowTemplateID: "builtin:noop-dry-run",
        workflowStartOptions: { enqueueChildren: true },
      }),
    )
  })

  test("createHeadlessClient exposes workflow commands", async () => {
    const calls: Array<{ pathname: string; search: string; method?: string; body?: BodyInit | null }> = []
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const parsed = new URL(url.toString())
        calls.push({ pathname: parsed.pathname, search: parsed.search, method: init?.method, body: init?.body })
        if (parsed.pathname === "/workflow-templates" && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "project:route-noop", trust: "candidate" }), { status: 200 })
        }
        if (parsed.pathname === "/workflow-templates") return new Response(JSON.stringify([]), { status: 200 })
        if (parsed.pathname.endsWith("/promote")) {
          return new Response(JSON.stringify({ id: "project:route-noop", trust: "trusted" }), { status: 200 })
        }
        if (parsed.pathname.startsWith("/workflow-templates/")) {
          return new Response(JSON.stringify({ id: "builtin:noop-dry-run" }), { status: 200 })
        }
        if (parsed.pathname === "/workflow-runs" && init?.method === "GET") {
          return new Response(JSON.stringify([{ id: "wfr_live", status: "running" }]), { status: 200 })
        }
        if (parsed.pathname === "/workflow-runs" && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "wfr_live", status: "queued" }), { status: 200 })
        }
        if (parsed.pathname === "/workflow-runs/dashboard") {
          return new Response(JSON.stringify([{ runID: "wfr_live", status: "running" }]), { status: 200 })
        }
        if (parsed.pathname === "/workflow-runs/eval-cases") {
          return new Response(
            JSON.stringify([{ id: "verified-bug-sweep-seeded", templateID: "builtin:verified-bug-sweep" }]),
            { status: 200 },
          )
        }
        if (parsed.pathname === "/workflow-routines" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ route: "workflow/route-noop", templateID: "project:route-noop", trust: "trusted" }),
            { status: 200 },
          )
        }
        if (parsed.pathname === "/workflow-routines") {
          return new Response(JSON.stringify([{ route: "workflow/route-noop", templateID: "project:route-noop" }]), {
            status: 200,
          })
        }
        if (parsed.pathname === "/workflow-routines/run") {
          return new Response(JSON.stringify({ run: { id: "wfr_routine", status: "completed" } }), { status: 200 })
        }
        if (parsed.pathname.endsWith("/artifacts")) return new Response(JSON.stringify([]), { status: 200 })
        if (parsed.pathname.endsWith("/eval-summary")) {
          return new Response(JSON.stringify({ runID: "wfr_live", decision: "promote" }), { status: 200 })
        }
        if (parsed.pathname.endsWith("/eval-case")) {
          return new Response(JSON.stringify({ caseID: "verified-bug-sweep-seeded", decision: "promote" }), {
            status: 200,
          })
        }
        if (parsed.pathname.endsWith("/save-template")) {
          return new Response(JSON.stringify({ id: "project:noop-dry-run", trust: "candidate" }), { status: 200 })
        }
        return new Response(JSON.stringify({ id: "wfr_live", status: "running" }), { status: 200 })
      }) as typeof fetch,
    })

    const templateSpec = {
      schemaVersion: 1,
      id: "route-noop",
      name: "Route Noop",
      description: "Minimal route fixture.",
      phases: [{ id: "noop", name: "Noop", kind: "noop" }],
    } as const

    await client.workflowTemplate.list()
    await client.workflowTemplate.get("builtin:noop-dry-run")
    await client.workflowTemplate.save({ scope: "project", spec: templateSpec })
    await client.workflowTemplate.promote("project:route-noop")
    await client.workflowRoutine.create({
      templateID: "builtin:noop-dry-run",
      scope: "project",
      route: "workflow/route-noop",
      enabled: true,
      trust: "trusted",
    })
    await client.workflowRoutine.list()
    await client.workflowRoutine.run({ route: "workflow/route-noop", inputValues: { target: "src/index.ts" } })
    await client.workflowRun.list({ status: "running", limit: 10 })
    await client.workflowRun.create({
      templateID: "builtin:noop-dry-run",
      modelPolicy: { effort: "workflow", workerModel: "cheap-headless" },
      inputValues: { target: "src/index.ts" },
    })
    await client.workflowRun.get("wfr_live")
    await client.workflowRun.dashboard({ status: "running", limit: 10 })
    await client.workflowRun.evalCases()
    await client.workflowRun.artifacts("wfr_live", {
      artifactID: "wfa_live",
      kind: "summary",
      includePayload: "false",
    })
    await client.workflowRun.evalSummary("wfr_live", {
      baseline: { label: "single-agent", metrics: { confirmedFindings: 0, falsePositiveFindings: 0 } },
    })
    await client.workflowRun.evalCase("wfr_live", { caseID: "verified-bug-sweep-seeded" })
    await client.workflowRun.saveTemplate("wfr_live", { scope: "project" })
    await client.workflowRun.start("wfr_live", { enqueueChildren: false })
    await client.workflowRun.pause("wfr_live")
    await client.workflowRun.resume("wfr_live")
    await client.workflowRun.cancel("wfr_live")
    await client.workflowRun.retry("wfr_live", { phaseID: "wfp_live" })

    expect(calls.map((call) => [call.method, call.pathname])).toEqual([
      ["GET", "/workflow-templates"],
      ["GET", "/workflow-templates/builtin%3Anoop-dry-run"],
      ["POST", "/workflow-templates"],
      ["POST", "/workflow-templates/project%3Aroute-noop/promote"],
      ["POST", "/workflow-routines"],
      ["GET", "/workflow-routines"],
      ["POST", "/workflow-routines/run"],
      ["GET", "/workflow-runs"],
      ["POST", "/workflow-runs"],
      ["GET", "/workflow-runs/wfr_live"],
      ["GET", "/workflow-runs/dashboard"],
      ["GET", "/workflow-runs/eval-cases"],
      ["GET", "/workflow-runs/wfr_live/artifacts"],
      ["POST", "/workflow-runs/wfr_live/eval-summary"],
      ["POST", "/workflow-runs/wfr_live/eval-case"],
      ["POST", "/workflow-runs/wfr_live/save-template"],
      ["POST", "/workflow-runs/wfr_live/start"],
      ["POST", "/workflow-runs/wfr_live/pause"],
      ["POST", "/workflow-runs/wfr_live/resume"],
      ["POST", "/workflow-runs/wfr_live/cancel"],
      ["POST", "/workflow-runs/wfr_live/retry"],
    ])
    expect(calls[7].search).toBe("?status=running&limit=10")
    expect(calls[12].search).toBe("?artifactID=wfa_live&kind=summary&includePayload=false")
    expect(calls.at(-1)?.search).toBe("?phaseID=wfp_live")
    expect(calls[2].body).toBe(JSON.stringify({ scope: "project", spec: templateSpec }))
    expect(calls[4].body).toBe(
      JSON.stringify({
        templateID: "builtin:noop-dry-run",
        scope: "project",
        route: "workflow/route-noop",
        enabled: true,
        trust: "trusted",
      }),
    )
    expect(calls[6].body).toBe(
      JSON.stringify({ route: "workflow/route-noop", inputValues: { target: "src/index.ts" } }),
    )
    expect(calls[8].body).toBe(
      JSON.stringify({
        templateID: "builtin:noop-dry-run",
        modelPolicy: { effort: "workflow", workerModel: "cheap-headless" },
        inputValues: { target: "src/index.ts" },
      }),
    )
    expect(calls[13].body).toBe(
      JSON.stringify({
        baseline: { label: "single-agent", metrics: { confirmedFindings: 0, falsePositiveFindings: 0 } },
      }),
    )
    expect(calls[14].body).toBe(JSON.stringify({ caseID: "verified-bug-sweep-seeded" }))
    expect(calls[15].body).toBe(JSON.stringify({ scope: "project" }))
    expect(calls[16].body).toBe(JSON.stringify({ enqueueChildren: false }))
  })

  test("parseHeadlessRuntimeResponseBody handles empty and invalid bodies", () => {
    expect(parseHeadlessRuntimeResponseBody("")).toBe(true)
    expect(parseHeadlessRuntimeResponseBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
    expect(() => parseHeadlessRuntimeResponseBody("{")).toThrow("Headless runtime returned invalid JSON")
  })
})
