import { describe, test, expect } from "bun:test"
import {
  createHeadlessClient,
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
  isHeadlessRuntimeEvent,
  HEADLESS_RUNTIME_EVENT_TYPES,
  HEADLESS_RUNTIME_SCHEMA_VERSION,
  parseHeadlessRuntimeResponseBody,
} from "../src/headless.js"

describe("headless SDK types", () => {
  test("HEADLESS_RUNTIME_EVENT_TYPES includes session.error", () => {
    expect(HEADLESS_RUNTIME_EVENT_TYPES.has("session.error")).toBe(true)
    expect(HEADLESS_RUNTIME_EVENT_TYPES.has("scheduled.task.created")).toBe(true)
  })

  test("exports a headless runtime schema version", () => {
    expect(HEADLESS_RUNTIME_SCHEMA_VERSION).toBe(1)
  })

  test("isHeadlessRuntimeEvent recognizes known types", () => {
    expect(isHeadlessRuntimeEvent({ type: "session.created", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "session.error", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "unknown.event" })).toBe(false)
    expect(isHeadlessRuntimeEvent(null)).toBe(false)
  })

  test("createHeadlessProjectionState has session_error", () => {
    const state = createHeadlessProjectionState()
    expect(state.session_error).toEqual({})
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
      }),
    )
  })

  test("parseHeadlessRuntimeResponseBody handles empty and invalid bodies", () => {
    expect(parseHeadlessRuntimeResponseBody("")).toBe(true)
    expect(parseHeadlessRuntimeResponseBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
    expect(() => parseHeadlessRuntimeResponseBody("{")).toThrow("Headless runtime returned invalid JSON")
  })
})
