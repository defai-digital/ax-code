import { runInNewContext } from "node:vm"
import http from "node:http"
import { describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { createTuiDebugClient } from "@ax-code/sdk/tui-debug"
import type { TuiDebugAction, TuiDebugScreen } from "@ax-code/sdk/tui-debug"
import { createTuiMcpController } from "../../src/tuimcp/controller"
import { callTuiMcpEndpoint, readTuiMcpEndpoint, startTuiMcpEndpoint } from "../../src/tuimcp/endpoint"
import { createTuiMcpServer } from "../../src/tuimcp/mcp-server"
import { startTuiInspector } from "../../src/tuimcp/inspector"
import { parseJsonStrict } from "../../src/util/json-value"

function fixture(debug = true, { deferPaint = false } = {}) {
  let blocked = false
  let clock = 1000
  let fence = "focus:prompt"
  const actions: TuiDebugAction[] = []
  const screen: TuiDebugScreen = {
    frameId: 1,
    width: 80,
    height: 24,
    text: "AX Code",
    focusedId: "prompt",
    modalDepth: 0,
    cursor: { x: 0, y: 0, visible: true },
  }
  const controller = createTuiMcpController({
    state: () => ({ workspace: "/project", route: "home", ready: true, blocked: true }),
    validateSession: async () => {},
    navigate: () => {},
    now: () => clock,
    debug: debug
      ? {
          blocked: () => blocked,
          fence: () => fence,
          snapshot: () => screen,
          input: (action) => {
            actions.push(action)
            if (deferPaint) return
            screen.frameId++
            screen.text = action.kind === "paste" ? action.text : "Changed"
          },
        }
      : undefined,
  })
  const target = () => ({ instanceId: controller.instanceId, generation: controller.generation })
  const input = (action: TuiDebugAction = { kind: "key", key: "tab" }) => ({
    operation: "tui_input" as const,
    ...target(),
    requestId: randomUUID(),
    expectedRevision: controller.context().revision,
    action,
  })
  const signal = new AbortController().signal
  return {
    controller,
    screen,
    actions,
    paint() {
      const action = actions.at(-1)
      screen.frameId++
      screen.text = action?.kind === "paste" ? action.text : "Changed"
    },
    target,
    input,
    signal,
    block: () => {
      blocked = true
    },
    changeFocus: () => {
      fence = "focus:other"
    },
    advance: () => {
      clock += 2000
    },
  }
}

type BrowserElement = {
  textContent: string
  value: string
  checked: boolean
  disabled: boolean
  onsubmit?: (event: { preventDefault: () => void }) => void
  onclick?: () => void
}
type BrowserTool = {
  name: string
  annotations: { readOnlyHint: boolean; consequentialHint: boolean; untrustedContentHint: boolean }
  execute: (args: unknown, options?: { signal?: AbortSignal }) => Promise<string>
}
async function browserFixture(
  f: ReturnType<typeof fixture>,
  intercept?: (name: string, next: () => Promise<Response>, init: RequestInit) => Promise<Response>,
  deadline?: (ms: number) => AbortSignal,
) {
  const endpoint = await startTuiMcpEndpoint(f.controller)
  const inspector = await startTuiInspector(endpoint.filename)
  const html = await (await fetch(inspector.url)).text()
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]
  const elements = new Map<string, BrowserElement>()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", value: "", checked: false, disabled: false })
    return elements.get(id)!
  }
  const registered: BrowserTool[] = []
  let tick = () => {}
  runInNewContext(script, {
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      modelContext: {
        registerTool: async (tool: BrowserTool) => {
          registered.push(tool)
        },
      },
    },
    navigator: {},
    crypto: { randomUUID },
    AbortSignal: {
      timeout: deadline ?? AbortSignal.timeout,
      any: AbortSignal.any.bind(AbortSignal),
    },
    setInterval: (callback: () => void) => {
      tick = callback
      return 0
    },
    fetch: (url: string, init: RequestInit) => {
      const next = () =>
        fetch(new URL(url, inspector.url), {
          ...init,
          headers: { ...init.headers, Origin: new URL(inspector.url).origin },
        })
      const body = parseJsonStrict(String(init.body)) as { name: string }
      return intercept ? intercept(body.name, next, init) : next()
    },
  })
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 2000
    while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(condition()).toBe(true)
  }
  await until(() => element("screen").textContent === "AX Code")
  return {
    element,
    registered,
    until,
    tick: () => tick(),
    [Symbol.asyncDispose]: async () => {
      await inspector.close()
      await endpoint.close()
    },
  }
}

describe("native TUI debugging fences", () => {
  test.each(["request", "body"])("a stalled inspector %s times out without replaying input", async (phase) => {
    const f = fixture()
    let blocked = false
    let latestDeadline: AbortController | undefined
    await using h = await browserFixture(
      f,
      async (name, next, init) => {
        if (name !== "tui_input" || blocked) return next()
        if (phase === "body") await next()
        blocked = true
        const signal = init.signal!
        if (phase === "request")
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          })
        return new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener("abort", () => controller.error(signal.reason), { once: true })
            },
          }),
        )
      },
      (ms) => {
        expect(ms).toBe(15_000)
        latestDeadline = new AbortController()
        return latestDeadline.signal
      },
    )
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    const { operation: _, ...args } = f.input({ kind: "paste", text: "Uncertain input" })
    const pending = mutate.execute(args)
    const failed = expect(pending).rejects.toThrow("Input outcome unknown; reconcile before retrying")
    await h.until(() => blocked)
    expect(latestDeadline).toBeDefined()
    latestDeadline!.abort(new DOMException("Inspector request timed out", "TimeoutError"))
    await failed
    expect(h.element("status").textContent).toContain("Inspector request timed out")
    expect(h.element("receipts").textContent).toContain("outcome_unknown")
    expect(h.element("click-submit").disabled).toBe(true)
    expect(f.actions).toHaveLength(phase === "body" ? 1 : 0)
    f.paint()
    await read.execute(f.target())
    expect(h.element("click-submit").disabled).toBe(false)
    const { operation: __, ...retry } = f.input({ kind: "paste", text: "New explicit input" })
    expect(parseJsonStrict(await mutate.execute(retry))).toMatchObject({ status: "applied" })
    expect(f.actions).toHaveLength(phase === "body" ? 2 : 1)
  })

  test("debug remains opt-in even for a valid shared capability", async () => {
    const f = fixture(false)
    expect(await f.controller.dispatch({ operation: "get_tui_snapshot", ...f.target() }, f.signal)).toMatchObject({
      code: "debug_disabled",
    })
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "debug_disabled" })
    expect(f.actions).toEqual([])
  })
  test("real input bypasses draft/navigation blocking but not human activity, approvals, focus changes or revocation", async () => {
    const f = fixture()
    const first = f.input({ kind: "paste", text: "test draft" })
    expect(await f.controller.dispatch(first, f.signal)).toMatchObject({ status: "applied" })
    expect(await f.controller.dispatch(first, f.signal)).toMatchObject({ status: "applied" })
    expect(f.actions).toHaveLength(1)
    expect(await f.controller.dispatch({ ...first, action: { kind: "key", key: "enter" } }, f.signal)).toMatchObject({
      code: "request_conflict",
    })
    const stale = f.input()
    f.changeFocus()
    expect(await f.controller.dispatch(stale, f.signal)).toMatchObject({ code: "stale_revision" })
    f.controller.humanInput()
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "user_active" })
    f.advance()
    f.block()
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "user_active" })
    expect(await f.controller.dispatch({ operation: "get_tui_snapshot", ...f.target() }, f.signal)).toMatchObject({
      code: "user_active",
    })
    f.controller.dispose()
    expect(await f.controller.dispatch(f.input(), f.signal)).toMatchObject({ code: "revoked" })
    expect(f.actions).toHaveLength(1)
  })
  test("clicks bind to a rendered frame and its bounds; inputs bind to the exact process", async () => {
    const f = fixture()
    expect(await f.controller.dispatch({ ...f.input(), generation: randomUUID() }, f.signal)).toMatchObject({
      code: "stale_target",
    })
    expect(
      await f.controller.dispatch(f.input({ kind: "click", x: 0, y: 0, expectedFrameId: 0 }), f.signal),
    ).toMatchObject({ code: "stale_frame" })
    expect(
      await f.controller.dispatch(f.input({ kind: "click", x: 80, y: 0, expectedFrameId: 1 }), f.signal),
    ).toMatchObject({ code: "invalid_request" })
    expect(
      await f.controller.dispatch(f.input({ kind: "click", x: 79, y: 23, expectedFrameId: 1 }), f.signal),
    ).toMatchObject({ status: "applied" })
  })
  test("wait observes actual frames, requires a condition, and is bounded and revocable", async () => {
    const f = fixture()
    const request = {
      operation: "wait_for_tui" as const,
      ...f.target(),
      text: "Ready",
      afterFrameId: 1,
      timeoutMs: 200,
    }
    const result = f.controller.dispatch(request, f.signal)
    f.screen.text = "Ready"
    f.screen.frameId = 2
    expect(await result).toMatchObject({ status: "snapshot", screen: { text: "Ready", frameId: 2 } })
    expect(
      await f.controller.dispatch({ operation: "wait_for_tui", ...f.target(), timeoutMs: 5 }, f.signal),
    ).toMatchObject({ code: "invalid_request" })
    expect(await f.controller.dispatch({ ...request, text: "missing", timeoutMs: 5 }, f.signal)).toMatchObject({
      code: "condition_timeout",
    })
    const waiting = f.controller.dispatch({ ...request, text: "missing" }, f.signal)
    f.controller.dispose()
    expect(await waiting).toMatchObject({ code: "revoked" })
  })
  test("raw terminal controls and oversized snapshots fail closed", async () => {
    const f = fixture()
    expect(await f.controller.dispatch(f.input({ kind: "paste", text: "\x1b[201~\r" }), f.signal)).toMatchObject({
      code: "invalid_request",
    })
    f.screen.text = "x".repeat(48_001)
    expect(await f.controller.dispatch({ operation: "get_tui_snapshot", ...f.target() }, f.signal)).toMatchObject({
      code: "snapshot_too_large",
    })
    expect(f.actions).toHaveLength(0)
  })
})

describe.skipIf(process.platform === "win32")("native TUI developer transports", () => {
  test("socket, standard MCP and typed SDK share the same screen and deduplication", async () => {
    const f = fixture()
    const endpoint = await startTuiMcpEndpoint(f.controller)
    const server = createTuiMcpServer(endpoint.filename)
    const client = new Client({ name: "tui-debug-test", version: "1" })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(st)
      await client.connect(ct)
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "get_view_context",
        "select_session",
        "get_tui_snapshot",
        "tui_input",
        "wait_for_tui",
      ])
      const sdk = createTuiDebugClient(client)
      expect(await sdk.snapshot(f.target())).toMatchObject({ status: "snapshot", screen: { text: "AX Code" } })
      const input = f.input({ kind: "paste", text: "Observed" })
      const { operation: _, ...sdkInput } = input
      expect(await sdk.input(sdkInput)).toMatchObject({ status: "applied" })
      expect(await callTuiMcpEndpoint(endpoint.filename, input)).toMatchObject({ status: "applied" })
      expect(f.actions).toHaveLength(1)
      expect(await sdk.wait({ ...f.target(), text: "Observed", afterFrameId: 1 })).toMatchObject({ status: "snapshot" })
    } finally {
      await client.close()
      await server.close()
      await endpoint.close()
    }
  })
  test("socket returns complete large screens and refuses oversized escaped envelopes", async () => {
    const f = fixture()
    const endpoint = await startTuiMcpEndpoint(f.controller)
    try {
      f.screen.width = 200
      f.screen.height = 200
      f.screen.text = "x".repeat(40_000)
      const snapshot = await callTuiMcpEndpoint(endpoint.filename, { operation: "get_tui_snapshot", ...f.target() })
      expect(snapshot.status).toBe("snapshot")
      if (snapshot.status === "snapshot") expect(snapshot.screen.text).toHaveLength(40_000)
      f.screen.text = "\u0000".repeat(48_000)
      expect(
        await callTuiMcpEndpoint(endpoint.filename, { operation: "get_tui_snapshot", ...f.target() }),
      ).toMatchObject({ code: "snapshot_too_large" })
    } finally {
      await endpoint.close()
    }
  })
  test("loopback inspector enforces host, origin, capability and protocol validation", async () => {
    const f = fixture()
    const endpoint = await startTuiMcpEndpoint(f.controller)
    const inspector = await startTuiInspector(endpoint.filename)
    try {
      const origin = new URL(inspector.url).origin
      const page = await fetch(inspector.url)
      expect(page.headers.get("cache-control")).toBe("no-store")
      expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
      const html = await page.text()
      expect(html).toContain("registerTool")
      expect(html).not.toContain(endpoint.filename)
      expect(html).not.toContain((await readTuiMcpEndpoint(endpoint.filename)).token)
      const bootstrap = /const boot=(.*);/.exec(html)![1]
      const { capability } = parseJsonStrict(bootstrap) as { capability: string }
      const post = (body: unknown, extra: Record<string, string> = {}) =>
        fetch(inspector.url + "rpc", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json", "X-AX-TUI-Debug": capability, ...extra },
          body: JSON.stringify(body),
        })
      expect((await post({ name: "get_tui_snapshot", args: f.target() })).status).toBe(200)
      expect(await (await post({ name: "get_tui_snapshot", args: f.target() })).json()).toMatchObject({
        status: "snapshot",
      })
      expect((await post({ name: "get_view_context", args: {} }, { Origin: "https://example.com" })).status).toBe(403)
      expect((await post({ name: "get_view_context", args: {} }, { "X-AX-TUI-Debug": "wrong" })).status).toBe(403)
      const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const req = http.get(inspector.url, { headers: { Host: "attacker.invalid" } }, (res) => {
          res.resume()
          resolve(res.statusCode)
        })
        req.on("error", reject)
      })
      expect(wrongHostStatus).toBe(403)
      expect((await fetch(inspector.url, { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403)
      expect((await post({ name: "execute_command", args: { command: "prompt.submit" } })).status).toBe(400)
      f.controller.dispose()
      expect(await (await post({ name: "get_tui_snapshot", args: f.target() })).json()).toMatchObject({
        code: "revoked",
      })
    } finally {
      await inspector.close()
      await endpoint.close()
    }
  })
  test("inspector script registers WebMCP tools and manual controls use the same fenced native input", async () => {
    const f = fixture()
    await using h = await browserFixture(f)
    expect(h.registered).toHaveLength(5)
    expect(h.element("webmcp").textContent).toContain("WebMCP ready")
    expect(h.registered.find((tool) => tool.name === "tui_input")?.annotations).toMatchObject({
      readOnlyHint: false,
      consequentialHint: true,
    })
    expect(h.registered.find((tool) => tool.name === "select_session")?.annotations).toMatchObject({
      consequentialHint: true,
    })
    for (const name of ["get_tui_snapshot", "wait_for_tui"]) {
      expect(h.registered.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: true,
        untrustedContentHint: true,
      })
    }
    const tool = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    expect(parseJsonStrict(await tool.execute(f.target()))).toMatchObject({ status: "snapshot" })
    h.element("key").value = "tab"
    h.element("keys").onsubmit!({ preventDefault() {} })
    await h.until(() => h.element("screen").textContent === "Changed")
    expect(f.actions).toEqual([{ kind: "key", key: "tab", ctrl: false, shift: false, meta: false }])
  })
  test("manual input waits for a painted frame and retains its applied receipt", async () => {
    const f = fixture(true, { deferPaint: true })
    await using h = await browserFixture(f)
    h.element("key").value = "tab"
    h.element("keys").onsubmit!({ preventDefault() {} })
    await h.until(() => f.actions.length === 1 && h.element("receipts").textContent.includes("applied"))
    expect(h.element("meta").textContent).toContain("Stale preview")
    expect(h.element("click-submit").disabled).toBe(true)
    expect(h.element("screen").textContent).toBe("AX Code")
    f.paint()
    await h.until(() => h.element("screen").textContent === "Changed" && !h.element("click-submit").disabled)
    expect(h.element("receipts").textContent).toContain("applied")
    expect(h.element("status").textContent).toContain("applied")
  })
  test("WebMCP mutation invalidates the visible frame and late old reads cannot repaint it", async () => {
    const f = fixture(true, { deferPaint: true })
    let delay = false
    let release: (() => void) | undefined
    await using h = await browserFixture(f, async (name, next) => {
      const response = await next()
      if (delay && name === "get_tui_snapshot") {
        delay = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return response
    })
    const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    delay = true
    const old = read.execute(f.target())
    await h.until(() => !!release)
    const { operation: _, ...args } = f.input({ kind: "paste", text: "New frame" })
    const action = mutate.execute(args)
    await h.until(() => f.actions.length === 1)
    release!()
    await old
    expect(h.element("meta").textContent).toContain("Stale preview")
    expect(h.element("click-submit").disabled).toBe(true)
    f.paint()
    expect(parseJsonStrict(await action)).toMatchObject({ status: "applied" })
    expect(h.element("screen").textContent).toBe("New frame")
    expect(h.element("click-submit").disabled).toBe(false)
  })
  test("WebMCP cancellation before dispatch does not send native input", async () => {
    const f = fixture()
    let delay = false
    let release: (() => void) | undefined
    await using h = await browserFixture(f, async (name, next) => {
      const response = await next()
      if (delay && name === "get_tui_snapshot") {
        delay = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return response
    })
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    delay = true
    const controller = new AbortController()
    const { operation: _, ...args } = f.input({ kind: "key", key: "enter" })
    const pending = mutate.execute(args, { signal: controller.signal })
    await h.until(() => !!release)
    controller.abort()
    release!()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(f.actions).toEqual([])
  })
  test("an older transport failure cannot invalidate a newer successful screen read", async () => {
    const f = fixture()
    let delay = false
    let release: (() => void) | undefined
    await using h = await browserFixture(f, async (name, next) => {
      const response = await next()
      if (delay && name === "get_tui_snapshot") {
        delay = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
        throw new Error("Delayed disconnected read")
      }
      return response
    })
    const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    delay = true
    const old = read.execute(f.target())
    await h.until(() => !!release)
    f.screen.frameId = 2
    f.screen.text = "Fresh screen"
    await read.execute(f.target())
    release!()
    await expect(old).rejects.toThrow("Delayed disconnected read")
    expect(h.element("meta").textContent).toContain("frame 2")
    expect(h.element("click-submit").disabled).toBe(false)
    delay = true
    release = undefined
    const newest = read.execute(f.target())
    await h.until(() => !!release)
    release!()
    await expect(newest).rejects.toThrow("Delayed disconnected read")
    expect(h.element("meta").textContent).toContain("Stale preview")
    expect(h.element("click-submit").disabled).toBe(true)
  })
  test("a native revocation observed by an older request still invalidates the preview", async () => {
    const f = fixture()
    let delay = false
    let release: (() => void) | undefined
    await using h = await browserFixture(f, async (name, next) => {
      if (delay && name === "get_tui_snapshot") {
        delay = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return next()
    })
    const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    delay = true
    const old = read.execute(f.target())
    await h.until(() => !!release)
    f.screen.frameId = 2
    await read.execute(f.target())
    f.controller.dispose()
    release!()
    expect(parseJsonStrict(await old)).toMatchObject({ code: "revoked" })
    expect(h.element("meta").textContent).toContain("Stale preview")
    expect(h.element("click-submit").disabled).toBe(true)
  })
  test("failed post-input observation preserves known success and structured HTTP errors", async () => {
    const f = fixture()
    await using h = await browserFixture(f, async (name, next) =>
      name === "wait_for_tui" ? Response.json({ status: "rejected", code: "unauthorized" }, { status: 403 }) : next(),
    )
    const { operation: _, ...args } = f.input({ kind: "paste", text: "Applied once" })
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "applied" })
    expect(h.element("status").textContent).toContain("Input applied; preview unavailable")
    expect(h.element("status").textContent).toContain("unauthorized")
    expect(h.element("receipts").textContent).toContain(args.requestId)
    expect(h.element("receipts").textContent).toContain("applied")
    expect(h.element("click-submit").disabled).toBe(true)
    expect(f.actions).toHaveLength(1)
  })
  test("live observations do not erase a mutation rejection", async () => {
    const f = fixture()
    await using h = await browserFixture(f)
    const { operation: _, ...args } = f.input()
    f.changeFocus()
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ code: "stale_revision" })
    h.element("live").checked = true
    f.screen.frameId++
    h.tick()
    await h.until(() => h.element("meta").textContent.includes("frame 2"))
    expect(h.element("status").textContent).toContain("stale_revision")
    expect(h.element("receipts").textContent).toContain("stale_revision")
  })
  test("a refused input does not require a nonexistent new frame before refreshing", async () => {
    const f = fixture()
    await using h = await browserFixture(f)
    const { operation: _, ...args } = f.input()
    f.changeFocus()
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ code: "stale_revision" })
    const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    await read.execute(f.target())
    expect(h.element("meta").textContent).toContain("frame 1")
    expect(h.element("click-submit").disabled).toBe(false)
    expect(f.actions).toHaveLength(0)
  })
  test("an inspector refusal before dispatch is a definite rejection, not an unknown outcome", async () => {
    const f = fixture()
    await using h = await browserFixture(f, async (name, next) =>
      name === "tui_input" ? Response.json({ status: "rejected", code: "busy" }, { status: 429 }) : next(),
    )
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    const { operation: _, ...args } = f.input()
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "rejected", code: "busy" })
    expect(h.element("receipts").textContent).not.toContain("outcome_unknown")
    expect(f.actions).toHaveLength(0)
  })

  test("manual transport failure retains the explicit unknown-outcome warning", async () => {
    const f = fixture()
    await using h = await browserFixture(f, async (name, next) => {
      if (name === "tui_input") throw new Error("Simulated disconnected transport")
      return next()
    })
    h.element("key").value = "tab"
    h.element("keys").onsubmit!({ preventDefault() {} })
    await h.until(() => h.element("receipts").textContent.includes("outcome_unknown"))
    expect(h.element("status").textContent).toContain("Input outcome unknown; reconcile before retrying")
    expect(h.element("click-submit").disabled).toBe(true)
    expect(f.actions).toHaveLength(0)
  })
  test.each(["timeout_unknown", "outcome_unknown", "internal_error"])(
    "structured %s retains the reconciliation warning without hiding the receipt",
    async (code) => {
      const f = fixture(true, { deferPaint: true })
      await using h = await browserFixture(f, async (name, next) => {
        const response = await next()
        return name === "tui_input" ? Response.json({ status: "rejected", code }) : response
      })
      const { operation: _, ...args } = f.input()
      const mutate = h.registered.find((tool) => tool.name === "tui_input")!
      expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "rejected", code })
      expect(h.element("status").textContent).toContain("Input outcome unknown; reconcile before retrying")
      expect(h.element("receipts").textContent).toContain(code)
      const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
      await read.execute(f.target())
      expect(h.element("click-submit").disabled).toBe(true)
      expect(f.actions).toHaveLength(1)
    },
  )
  test("an uncertain receipt reconciles with the same request id without repeating native input", async () => {
    const f = fixture(true, { deferPaint: true })
    let loseReply = true
    await using h = await browserFixture(f, async (name, next) => {
      const response = await next()
      if (name === "tui_input" && loseReply) {
        loseReply = false
        return Response.json({ status: "rejected", code: "timeout_unknown" })
      }
      return response
    })
    const { operation: _, ...args } = f.input({ kind: "paste", text: "Applied once" })
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ code: "timeout_unknown" })
    f.paint()
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "applied" })
    expect(f.actions).toHaveLength(1)
    expect(h.element("screen").textContent).toBe("Applied once")
    expect(h.element("click-submit").disabled).toBe(false)
    expect(h.element("receipts").textContent).toContain('"status": "applied"')
  })
  test("overlapping browser mutations are fenced while identical in-flight calls share a receipt", async () => {
    const f = fixture(true, { deferPaint: true })
    await using h = await browserFixture(f)
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    const { operation: _, ...args } = f.input()
    const first = mutate.execute(args)
    await h.until(() => f.actions.length === 1)
    const duplicate = mutate.execute(args)
    const second = await mutate.execute({
      ...args,
      requestId: randomUUID(),
      expectedRevision: f.controller.context().revision,
    })
    expect(parseJsonStrict(second)).toMatchObject({ code: "busy" })
    expect(f.actions).toHaveLength(1)
    f.paint()
    expect(parseJsonStrict(await first)).toMatchObject({ status: "applied" })
    expect(parseJsonStrict(await duplicate)).toMatchObject({ status: "applied" })
    expect(h.element("receipts").textContent).toContain('"status": "applied"')
    expect(h.element("receipts").textContent).toContain('"code": "busy"')
    expect(h.element("screen").textContent).toBe("Changed")
  })
  test("same-frame observation cannot claim post-input visual confirmation", async () => {
    const f = fixture()
    await using h = await browserFixture(f, async (name, next) =>
      name === "wait_for_tui"
        ? Response.json({ status: "snapshot", context: f.controller.context(), screen: { ...f.screen, frameId: 1 } })
        : next(),
    )
    const { operation: _, ...args } = f.input()
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "applied" })
    expect(h.element("status").textContent).toContain("A newer frame was not observed")
    expect(h.element("click-submit").disabled).toBe(true)
  })
  test("a stale displayed baseline cannot mistake an unrelated frame for input completion", async () => {
    const f = fixture(true, { deferPaint: true })
    await using h = await browserFixture(f)
    f.screen.frameId = 2
    f.screen.text = "Unrelated native update"
    const { operation: _, ...args } = f.input()
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    const promise = mutate.execute(args)
    await h.until(() => f.actions.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(h.element("meta").textContent).toContain("Stale preview")
    expect(h.element("click-submit").disabled).toBe(true)
    f.paint()
    expect(parseJsonStrict(await promise)).toMatchObject({ status: "applied" })
    expect(h.element("screen").textContent).toBe("Changed")
  })
  test("a completed duplicate receipt does not wait for a nonexistent second input frame", async () => {
    const f = fixture()
    await using h = await browserFixture(f)
    const { operation: _, ...args } = f.input()
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "applied" })
    expect(parseJsonStrict(await mutate.execute(args))).toMatchObject({ status: "applied" })
    expect(f.actions).toHaveLength(1)
    expect(h.element("click-submit").disabled).toBe(false)
    expect(h.element("status").textContent).not.toContain("preview unavailable")
  })
  test("in-flight deduplication ignores JSON key order and a conflict preserves known success", async () => {
    const f = fixture(true, { deferPaint: true })
    await using h = await browserFixture(f)
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    const { operation: _, ...args } = f.input()
    const first = mutate.execute(args)
    await h.until(() => h.element("receipts").textContent.includes("applied"))
    const reordered = {
      action: { key: "tab", kind: "key" },
      expectedRevision: args.expectedRevision,
      requestId: args.requestId,
      generation: args.generation,
      instanceId: args.instanceId,
    }
    const duplicate = mutate.execute(reordered)
    const conflict = await mutate.execute({ ...args, action: { kind: "key", key: "enter" } })
    expect(parseJsonStrict(conflict)).toMatchObject({ code: "request_conflict" })
    expect(h.element("receipts").textContent).toContain('"status": "applied"')
    expect(h.element("receipts").textContent).toContain('"lastAttemptCode": "request_conflict"')
    f.paint()
    expect(parseJsonStrict(await first)).toMatchObject({ status: "applied" })
    expect(parseJsonStrict(await duplicate)).toMatchObject({ status: "applied" })
    expect(f.actions).toHaveLength(1)
  })
  test("a failed baseline and rejected input cannot erase an unresolved frame fence", async () => {
    const f = fixture(true, { deferPaint: true })
    let rejectBaseline = false
    await using h = await browserFixture(f, async (name, next) => {
      if (name === "wait_for_tui") return Response.json({ status: "rejected", code: "condition_timeout" })
      if (rejectBaseline && name === "get_tui_snapshot") {
        rejectBaseline = false
        return Response.json({ status: "rejected", code: "internal_error" })
      }
      if (name === "tui_input" && f.actions.length > 0) return Response.json({ status: "rejected", code: "not_ready" })
      return next()
    })
    const mutate = h.registered.find((tool) => tool.name === "tui_input")!
    const { operation: _, ...first } = f.input()
    expect(parseJsonStrict(await mutate.execute(first))).toMatchObject({ status: "applied" })
    rejectBaseline = true
    const { operation: __, ...second } = f.input()
    expect(parseJsonStrict(await mutate.execute(second))).toMatchObject({ code: "not_ready" })
    const read = h.registered.find((tool) => tool.name === "get_tui_snapshot")!
    await read.execute(f.target())
    expect(h.element("meta").textContent).toContain("Stale preview")
    expect(h.element("click-submit").disabled).toBe(true)
    expect(f.actions).toHaveLength(1)
  })
})
