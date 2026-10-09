import { describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { createTuiMcpController } from "../../src/tuimcp/controller"
import type { LiveState } from "../../src/tuimcp/controller"
import { MAX_RECEIPTS } from "../../src/tuimcp/protocol"
import { SessionID } from "../../src/session/schema"
import { tuiMcpBlocked } from "../../src/cli/tui/component/tui-mcp-guards"

const target = SessionID.ascending()
function fixture(validate?: (signal: AbortSignal) => Promise<void>, timeoutMs?: number) {
  const state: LiveState = { workspace: "/private/workspace", route: "home", ready: true, blocked: false }
  let time = 1_000
  let navigations = 0
  const controller = createTuiMcpController({
    state: () => state,
    validateSession: async (_, signal) => {
      await validate?.(signal)
    },
    navigate: (sessionId) => {
      navigations++
      state.route = "session"
      state.sessionId = sessionId
    },
    now: () => time,
    timeoutMs,
  })
  return {
    state,
    controller,
    input() {
      const view = controller.context()
      return {
        operation: "select_session" as const,
        requestId: randomUUID(),
        instanceId: view.instanceId,
        generation: view.generation,
        expectedRevision: view.revision,
        sessionId: target,
      }
    },
    signal: new AbortController().signal,
    navigations: () => navigations,
    advance: () => {
      time += 2_000
    },
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("TUIMCP live UI controller", () => {
  test("bounds context and acknowledges route state only", async () => {
    const f = fixture()
    const read = await f.controller.dispatch({ operation: "get_view_context" }, f.signal)
    expect(read).toMatchObject({ status: "context", context: { route: "home", ready: true, blocked: false } })
    expect(JSON.stringify(read)).not.toContain("workspace")
    expect(
      Object.entries(f.controller.context())
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .sort(),
    ).toEqual(["blocked", "generation", "instanceId", "ready", "revision", "route"])
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({
      status: "applied",
      context: { route: "session", sessionId: target },
    })
    expect(f.navigations()).toBe(1)
  })
  test("rejects malformed input, wrong instance/generation and stale revision", async () => {
    const f = fixture()
    expect(
      await f.controller.dispatch({ operation: "get_view_context", extra: "secret" } as never, f.signal),
    ).toMatchObject({ code: "invalid_request" })
    expect(await f.controller.dispatch({ ...f.input(), instanceId: randomUUID() }, f.signal)).toMatchObject({
      code: "stale_target",
    })
    expect(await f.controller.dispatch({ ...f.input(), generation: randomUUID() }, f.signal)).toMatchObject({
      code: "stale_target",
    })
    const input = f.input()
    f.state.workspace = "/different/workspace"
    expect(await f.controller.dispatch(input, f.signal)).toMatchObject({ code: "stale_revision" })
    expect(f.navigations()).toBe(0)
  })
  test.each(["route", "workspace", "readiness", "modal", "human"])(
    "fences %s changes during async lookup",
    async (change) => {
      const lookup = deferred()
      const f = fixture(() => lookup.promise)
      const pending = f.controller.dispatch(f.input(), f.signal)
      if (change === "route") {
        f.state.route = "session"
        f.state.sessionId = SessionID.ascending()
      }
      if (change === "workspace") f.state.workspace = "/another"
      if (change === "readiness") f.state.ready = false
      if (change === "modal") f.state.blocked = true
      if (change === "human") f.controller.humanInput()
      lookup.resolve()
      expect(await pending).toMatchObject({ code: "stale_revision" })
      expect(f.navigations()).toBe(0)
    },
  )
  test("records transient state changes even when state returns before lookup settles", async () => {
    const lookup = deferred()
    const f = fixture(() => lookup.promise)
    const pending = f.controller.dispatch(f.input(), f.signal)
    f.state.blocked = true
    f.controller.observe()
    f.state.blocked = false
    f.controller.observe()
    lookup.resolve()
    expect(await pending).toMatchObject({ code: "stale_revision" })
  })
  test("rejects current blocked/not-ready state and recent input", async () => {
    const f = fixture()
    f.state.blocked = true
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "user_active" })
    f.state.blocked = false
    f.state.ready = false
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "not_ready" })
    f.state.ready = true
    f.controller.humanInput()
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "user_active" })
    f.advance()
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ status: "applied" })
  })
  test("deduplicates pending and completed calls and rejects argument conflicts", async () => {
    const lookup = deferred()
    const f = fixture(() => lookup.promise)
    const input = f.input()
    const first = f.controller.dispatch(input, f.signal)
    const second = f.controller.dispatch(input, f.signal)
    expect(await f.controller.dispatch({ ...input, sessionId: SessionID.ascending() }, f.signal)).toMatchObject({
      code: "request_conflict",
    })
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "busy" })
    lookup.resolve()
    expect(await first).toEqual(await second)
    expect(await f.controller.dispatch(input, f.signal)).toEqual(await first)
    expect(f.navigations()).toBe(1)
  })
  test.each(["revoke", "cancel", "timeout"])("%s fences even a lookup ignoring AbortSignal", async (reason) => {
    const lookup = deferred()
    const f = fixture(() => lookup.promise, 30)
    const abort = new AbortController()
    const pending = f.controller.dispatch(f.input(), abort.signal)
    if (reason === "revoke") f.controller.dispose()
    if (reason === "cancel") abort.abort()
    expect(await pending).toMatchObject({
      code: reason === "revoke" ? "revoked" : reason === "cancel" ? "cancelled" : "deadline_exceeded",
    })
    lookup.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.navigations()).toBe(0)
  })
  test("keeps a hung validator single-flight after returning its deadline", async () => {
    const lookup = deferred()
    const f = fixture(() => lookup.promise, 20)
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "deadline_exceeded" })
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "busy" })
    lookup.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.navigations()).toBe(0)
  })
  test("reports uncertainty when a commit throws after changing route state", async () => {
    const state: LiveState = { workspace: "/w", route: "home", ready: true, blocked: false }
    const controller = createTuiMcpController({
      state: () => state,
      validateSession: async () => {},
      navigate: (sessionId) => {
        state.route = "session"
        state.sessionId = sessionId
        throw new Error("post-commit failure")
      },
    })
    const view = controller.context()
    expect(
      await controller.dispatch(
        {
          operation: "select_session",
          requestId: randomUUID(),
          instanceId: view.instanceId,
          generation: view.generation,
          expectedRevision: view.revision,
          sessionId: target,
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ code: "outcome_unknown" })
    expect(controller.context().sessionId).toBe(target)
  })
  test("lookup failure rejects without navigation", async () => {
    const f = fixture(async () => {
      throw new Error("foreign or missing session")
    })
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "target_unavailable" })
    expect(f.navigations()).toBe(0)
  })
  test("does not evict receipts into unsafe replay", async () => {
    const f = fixture()
    const first = f.input()
    await f.controller.dispatch(first, f.signal)
    for (let i = 1; i < MAX_RECEIPTS; i++) await f.controller.dispatch(f.input(), f.signal)
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "request_limit" })
    expect(await f.controller.dispatch(first, f.signal)).toMatchObject({ status: "applied" })
    expect(f.navigations()).toBe(MAX_RECEIPTS)
    expect(await f.controller.dispatch({ operation: "get_view_context" }, f.signal)).toMatchObject({
      status: "context",
    })
  })
})

describe("TUIMCP navigation protection", () => {
  const clear = { promptMounted: true, draft: "", parts: 0, modal: false, busy: false, pending: false }
  test("allows idle mounted prompt", () => expect(tuiMcpBlocked(clear)).toBe(false))
  test.each([
    { promptMounted: false },
    { draft: " " },
    { draft: "private draft" },
    { parts: 1 },
    { modal: true },
    { busy: true },
    { pending: true },
  ])("blocks user-owned state %j", (state) => expect(tuiMcpBlocked({ ...clear, ...state })).toBe(true))
})
