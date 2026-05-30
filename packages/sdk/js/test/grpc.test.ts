import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  AX_CODE_GRPC_METHOD,
  AX_CODE_GRPC_PROTO_PATH,
  createAxCodeGrpcClient,
  createAxCodeGrpcClientFromHttp,
  createAxCodeGrpcClientFromNativeBridge,
  createAxCodeGrpcHttpBridge,
  type AxCodeGrpcTransport,
} from "../src/grpc"

describe("gRPC SDK facade", () => {
  test("exposes a stable headless service and proto path", () => {
    expect(AX_CODE_GRPC_METHOD.SendRuntimeCommand).toBe("/axcode.v1.AxCodeHeadless/SendRuntimeCommand")
    expect(AX_CODE_GRPC_METHOD.LoadBootstrap).toBe("/axcode.v1.AxCodeHeadless/LoadBootstrap")
    expect(AX_CODE_GRPC_METHOD.SubscribeEvents).toBe("/axcode.v1.AxCodeHeadless/SubscribeEvents")
    expect(AX_CODE_GRPC_PROTO_PATH).toBe("ax_code/v1/headless.proto")
  })

  test("high-level client unwraps unary value envelopes", async () => {
    const calls: Array<{ method: string; request: unknown }> = []
    const transport: AxCodeGrpcTransport = {
      async unary(method, request) {
        calls.push({ method, request })
        if (method === AX_CODE_GRPC_METHOD.Health) return { status: "SERVING", transport: "grpc" }
        if (method === AX_CODE_GRPC_METHOD.CreateSession) return { value: { id: "sess-1" } }
        if (method === AX_CODE_GRPC_METHOD.SendRuntimeCommand) return { accepted: true, status: 202 }
        if (method === AX_CODE_GRPC_METHOD.LoadBootstrap) return { value: { path: { root: "/repo" }, errors: [] } }
        if (method === AX_CODE_GRPC_METHOD.GetSession) return { value: { id: "sess-1", title: "GUI" } }
        if (method === AX_CODE_GRPC_METHOD.ListSessionMessages) return { value: [{ id: "msg-1" }] }
        if (method === AX_CODE_GRPC_METHOD.ListSkills) return { value: [{ id: "security-harden" }] }
        if (method === AX_CODE_GRPC_METHOD.ReadFile) return { value: { content: "hello" } }
        if (method === AX_CODE_GRPC_METHOD.CreatePty) return { value: { id: "pty_1", title: "Terminal" } }
        if (method === AX_CODE_GRPC_METHOD.TaskQueueCommand) return { value: { id: "task-1", status: "paused" } }
        throw new Error(`unexpected method ${method}`)
      },
      async *serverStream() {
        yield { type: "server.connected", properties: {} }
      },
    }
    const client = createAxCodeGrpcClient({ transport })
    const { pause } = client.taskQueue

    expect(await client.health()).toEqual({ status: "SERVING", transport: "grpc" })
    expect(await client.createSession({ title: "GUI" })).toEqual({ id: "sess-1" })
    expect(await client.sendPrompt("sess-1", { parts: [{ type: "text", text: "hello" }] })).toEqual({
      accepted: true,
      status: 202,
    })
    expect(await client.bootstrap.load({ include: { path: true } })).toEqual({ path: { root: "/repo" }, errors: [] })
    expect(await client.session.get("sess-1")).toEqual({ id: "sess-1", title: "GUI" })
    expect(await client.session.messages("sess-1", { limit: 10 })).toEqual([{ id: "msg-1" }])
    expect(await client.app.skills()).toEqual([{ id: "security-harden" }])
    expect(await client.file.read("README.md")).toEqual({ content: "hello" })
    expect(await client.pty.create({ title: "Terminal" })).toEqual({ id: "pty_1", title: "Terminal" })
    expect(await pause("task-1")).toEqual({ id: "task-1", status: "paused" })
    expect(calls.map((call) => call.method)).toEqual([
      AX_CODE_GRPC_METHOD.Health,
      AX_CODE_GRPC_METHOD.CreateSession,
      AX_CODE_GRPC_METHOD.SendRuntimeCommand,
      AX_CODE_GRPC_METHOD.LoadBootstrap,
      AX_CODE_GRPC_METHOD.GetSession,
      AX_CODE_GRPC_METHOD.ListSessionMessages,
      AX_CODE_GRPC_METHOD.ListSkills,
      AX_CODE_GRPC_METHOD.ReadFile,
      AX_CODE_GRPC_METHOD.CreatePty,
      AX_CODE_GRPC_METHOD.TaskQueueCommand,
    ])
  })

  test("high-level client exposes PTY bidirectional streaming", async () => {
    const seen: unknown[] = []
    const transport: AxCodeGrpcTransport = {
      async unary() {
        throw new Error("unary should not be called")
      },
      async *serverStream() {},
      async *bidiStream(method, request, input) {
        seen.push({ method, request })
        for await (const frame of input) seen.push(frame)
        yield { type: "output", data: "ready" }
      },
    }
    const client = createAxCodeGrpcClient({ transport })
    const frames = async function* () {
      yield { type: "input" as const, data: "pwd\n" }
      yield { type: "resize" as const, cols: 120, rows: 30 }
    }
    const events = []

    for await (const event of client.pty.connect("pty_1", frames(), { cursor: 42 })) events.push(event)

    expect(events).toEqual([{ type: "output", data: "ready" }])
    expect(seen).toEqual([
      { method: AX_CODE_GRPC_METHOD.ConnectPty, request: { id: "pty_1", cursor: 42 } },
      { type: "input", data: "pwd\n" },
      { type: "resize", cols: 120, rows: 30 },
    ])
  })

  test("native bridge adapter carries metadata and streaming calls without HTTP", async () => {
    const calls: unknown[] = []
    const client = createAxCodeGrpcClientFromNativeBridge({
      async unary(call) {
        calls.push(call)
        return { value: { id: "sess-1" } }
      },
      async *serverStream(call) {
        calls.push(call)
        yield { type: "server.connected", properties: {} }
      },
      async *bidiStream(call) {
        calls.push({ ...call, input: "captured" })
        for await (const frame of call.input) calls.push(frame)
        yield { type: "output", data: "ready" }
      },
    })
    const abort = new AbortController()

    await expect(
      client.session.get("sess-1", {
        metadata: { "x-native-host": "tauri" },
        signal: abort.signal,
        timeoutMs: 250,
      }),
    ).resolves.toEqual({ id: "sess-1" })

    const events = []
    for await (const event of client.subscribeEvents({ metadata: { "x-native-host": "tauri" } })) events.push(event)
    for await (const event of client.pty.connect("pty_1", asyncFrames("pwd\n"), { cursor: 4 })) events.push(event)

    expect(events).toEqual([
      { type: "server.connected", properties: {} },
      { type: "output", data: "ready" },
    ])
    expect(calls).toEqual([
      {
        method: AX_CODE_GRPC_METHOD.GetSession,
        request: { sessionID: "sess-1" },
        metadata: { "x-native-host": "tauri" },
        signal: abort.signal,
        timeoutMs: 250,
      },
      {
        method: AX_CODE_GRPC_METHOD.SubscribeEvents,
        request: {},
        metadata: { "x-native-host": "tauri" },
        signal: undefined,
        timeoutMs: undefined,
      },
      {
        method: AX_CODE_GRPC_METHOD.ConnectPty,
        request: { id: "pty_1", cursor: 4 },
        input: "captured",
        metadata: undefined,
        signal: undefined,
        timeoutMs: undefined,
      },
      "pwd\n",
    ])
  })

  test("HTTP bridge maps gRPC-style session commands to the headless backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      headers: { Authorization: "Basic base" },
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        calls.push({ url: request.url, init: request })
        const pathname = new URL(request.url).pathname
        if (pathname === "/session") return Response.json({ id: "sess-1" })
        if (pathname === "/session/sess-1/prompt_async") return new Response("", { status: 202 })
        return Response.json(true)
      }) as typeof fetch,
    })

    await client.createSession({ title: "GUI" }, { metadata: { "x-ax-code-gui": "desktop" } })
    await client.sendPrompt("sess-1", { parts: [{ type: "text", text: "hello" }] })

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/session", "/session/sess-1/prompt_async"])
    expect(headerValue(calls[0].init.headers, "authorization")).toBe("Basic base")
    expect(headerValue(calls[0].init.headers, "x-ax-code-gui")).toBe("desktop")
    expect(await new Response(calls[1].init.body).text()).toBe(
      JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    )
  })

  test("HTTP bridge maps session history calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push({
          path: `${parsed.pathname}${parsed.search}`,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        if (parsed.pathname === "/session") return Response.json([{ id: "sess-1" }])
        if (parsed.pathname === "/session/status") return Response.json({ "sess-1": { type: "idle" } })
        if (parsed.pathname === "/session/sess-1") return Response.json({ id: "sess-1", title: "GUI" })
        if (parsed.pathname === "/session/sess-1/message") return Response.json([{ id: "msg-1" }])
        if (parsed.pathname === "/session/sess-1/message/msg-1") return Response.json({ id: "msg-1" })
        if (parsed.pathname === "/session/sess-1/children") return Response.json([{ id: "child-1" }])
        if (parsed.pathname === "/session/sess-1/diff") return Response.json({ files: [] })
        if (parsed.pathname === "/session/sess-1/todo") return Response.json([])
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.session.list({ limit: 5 })).resolves.toEqual([{ id: "sess-1" }])
    await expect(client.session.status()).resolves.toEqual({ "sess-1": { type: "idle" } })
    await expect(client.session.get("sess-1")).resolves.toEqual({ id: "sess-1", title: "GUI" })
    await expect(client.session.messages("sess-1", { limit: 20 })).resolves.toEqual([{ id: "msg-1" }])
    await expect(client.session.message("sess-1", "msg-1")).resolves.toEqual({ id: "msg-1" })
    await expect(client.session.children("sess-1")).resolves.toEqual([{ id: "child-1" }])
    await expect(client.session.diff("sess-1", { messageID: "msg-1" })).resolves.toEqual({ files: [] })
    await expect(client.session.todo("sess-1")).resolves.toEqual([])

    expect(calls).toEqual([
      { path: "/session?limit=5", method: "GET", body: "" },
      { path: "/session/status", method: "GET", body: "" },
      { path: "/session/sess-1", method: "GET", body: "" },
      { path: "/session/sess-1/message?limit=20", method: "GET", body: "" },
      { path: "/session/sess-1/message/msg-1", method: "GET", body: "" },
      { path: "/session/sess-1/children", method: "GET", body: "" },
      { path: "/session/sess-1/diff?messageID=msg-1", method: "GET", body: "" },
      { path: "/session/sess-1/todo", method: "GET", body: "" },
    ])
  })

  test("HTTP bridge maps GUI discovery and file search calls to the headless backend", async () => {
    const calls: string[] = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        calls.push(`${request.method} ${parsed.pathname}${parsed.search}`)
        if (parsed.pathname === "/skill") return Response.json([{ id: "security-harden" }])
        if (parsed.pathname === "/agent") return Response.json([{ id: "general" }])
        if (parsed.pathname === "/project/current") return Response.json({ id: "proj-1" })
        if (parsed.pathname === "/project") return Response.json([{ id: "proj-1" }])
        if (parsed.pathname === "/file") return Response.json([{ path: "src/index.ts" }])
        if (parsed.pathname === "/file/content") return Response.json({ content: "hello" })
        if (parsed.pathname === "/file/status") return Response.json([{ path: "README.md", status: "modified" }])
        if (parsed.pathname === "/find") return Response.json([{ path: "README.md" }])
        if (parsed.pathname === "/find/file") return Response.json(["README.md"])
        if (parsed.pathname === "/find/symbol") return Response.json([{ name: "main" }])
        if (parsed.pathname === "/experimental/tool/ids") return Response.json(["bash"])
        if (parsed.pathname === "/experimental/tool") return Response.json([{ id: "bash" }])
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.app.skills()).resolves.toEqual([{ id: "security-harden" }])
    await expect(client.app.agents()).resolves.toEqual([{ id: "general" }])
    await expect(client.project.current()).resolves.toEqual({ id: "proj-1" })
    await expect(client.project.list()).resolves.toEqual([{ id: "proj-1" }])
    await expect(client.file.list("src")).resolves.toEqual([{ path: "src/index.ts" }])
    await expect(client.file.read("README.md")).resolves.toEqual({ content: "hello" })
    await expect(client.file.status()).resolves.toEqual([{ path: "README.md", status: "modified" }])
    await expect(client.find.text("hello")).resolves.toEqual([{ path: "README.md" }])
    await expect(client.find.files("README", { limit: 5 })).resolves.toEqual(["README.md"])
    await expect(client.find.symbols("main")).resolves.toEqual([{ name: "main" }])
    await expect(client.tool.ids()).resolves.toEqual(["bash"])
    await expect(client.tool.list("anthropic", "claude")).resolves.toEqual([{ id: "bash" }])

    expect(calls).toEqual([
      "GET /skill",
      "GET /agent",
      "GET /project/current",
      "GET /project",
      "GET /file?path=src",
      "GET /file/content?path=README.md",
      "GET /file/status",
      "GET /find?pattern=hello",
      "GET /find/file?query=README&limit=5",
      "GET /find/symbol?query=main",
      "GET /experimental/tool/ids",
      "GET /experimental/tool?provider=anthropic&model=claude",
    ])
  })

  test("HTTP bridge maps PTY management calls to the headless backend", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        calls.push({
          path: new URL(request.url).pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        const pathname = new URL(request.url).pathname
        if (pathname === "/pty" && request.method === "GET") return Response.json([{ id: "pty_1" }])
        if (pathname === "/pty" && request.method === "POST") return Response.json({ id: "pty_2" })
        if (pathname === "/pty/pty_2" && request.method === "PUT") return Response.json({ id: "pty_2", title: "Shell" })
        if (pathname === "/pty/pty_2" && request.method === "DELETE") return Response.json(true)
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(client.pty.list()).resolves.toEqual([{ id: "pty_1" }])
    await expect(client.pty.create({ title: "Shell" })).resolves.toEqual({ id: "pty_2" })
    await expect(client.pty.update("pty_2", { title: "Shell" })).resolves.toEqual({ id: "pty_2", title: "Shell" })
    await expect(client.pty.remove("pty_2")).resolves.toBe(true)

    expect(calls).toEqual([
      { path: "/pty", method: "GET", body: "" },
      { path: "/pty", method: "POST", body: JSON.stringify({ title: "Shell" }) },
      { path: "/pty/pty_2", method: "PUT", body: JSON.stringify({ title: "Shell" }) },
      { path: "/pty/pty_2", method: "DELETE", body: "" },
    ])
  })

  test("HTTP bridge adapts PTY streams to the WebSocket route", async () => {
    class FakeSocket {
      readyState = 1
      binaryType?: BinaryType
      sent: Array<string | Uint8Array | ArrayBuffer> = []
      onopen?: (event: unknown) => void
      onmessage?: (event: { data: unknown }) => void
      onerror?: (event: unknown) => void
      onclose?: (event: { code?: number; reason?: string }) => void

      constructor(readonly url: string) {}

      send(data: string | Uint8Array | ArrayBuffer) {
        this.sent.push(data)
      }

      close(code?: number, reason?: string) {
        this.onclose?.({ code, reason })
      }
    }

    let socket: FakeSocket | undefined
    const calls: Array<{ path: string; method: string; body: string }> = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      headers: { Authorization: "Basic " + btoa("ax-code:secret") },
      webSocketFactory(url) {
        socket = new FakeSocket(url)
        queueMicrotask(() => socket?.onopen?.({}))
        return socket
      },
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        calls.push({
          path: new URL(request.url).pathname,
          method: request.method,
          body: request.body ? await new Response(request.body).text() : "",
        })
        return Response.json({ id: "pty_1" })
      }) as typeof fetch,
    })
    const frames = async function* () {
      yield "ls\n"
      yield { type: "resize" as const, cols: 120, rows: 30 }
    }
    const eventsPromise = (async () => {
      const events = []
      for await (const event of client.pty.connect("pty_1", frames(), { cursor: 8 })) events.push(event)
      return events
    })()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(socket?.url).toBe("ws://ax-code:secret@127.0.0.1:4096/pty/pty_1/connect?cursor=8")
    socket?.onmessage?.({ data: "ready" })
    socket?.onmessage?.({ data: ptyMetaFrame({ cursor: 12 }) })
    socket?.close(1000, "done")

    await expect(eventsPromise).resolves.toEqual([
      { type: "output", data: "ready" },
      { type: "replay", cursor: 12 },
      { type: "closed", code: 1000, reason: "done" },
    ])
    expect(socket?.sent).toEqual(["ls\n"])
    expect(calls).toEqual([
      { path: "/pty/pty_1", method: "PUT", body: JSON.stringify({ size: { cols: 120, rows: 30 } }) },
    ])
  })

  test("HTTP bridge can load a GUI bootstrap snapshot from selected routes", async () => {
    const paths: string[] = []
    const client = createAxCodeGrpcClientFromHttp({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const request = url instanceof Request ? url : new Request(url, init)
        const parsed = new URL(request.url)
        paths.push(`${parsed.pathname}${parsed.search}`)
        if (parsed.pathname === "/path") return Response.json({ root: "/repo", config: "/repo/ax-code.json" })
        if (parsed.pathname === "/vcs") return Response.json({ branch: "main" })
        if (parsed.pathname === "/command") return Response.json([{ name: "init" }])
        return new Response("not found", { status: 404 })
      }) as typeof fetch,
    })

    await expect(
      client.bootstrap.load({ include: { path: true, vcs: true, commands: true } }),
    ).resolves.toEqual({
      path: { root: "/repo", config: "/repo/ax-code.json" },
      vcs: { branch: "main" },
      commands: [{ name: "init" }],
      errors: [],
    })
    expect(paths.toSorted()).toEqual(["/command", "/path", "/vcs"])
  })

  test("HTTP bridge exposes health without requiring an HTTP round trip", async () => {
    const bridge = createAxCodeGrpcHttpBridge({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async () => {
        throw new Error("fetch should not be called")
      }) as typeof fetch,
    })

    await expect(bridge.unary(AX_CODE_GRPC_METHOD.Health, {})).resolves.toEqual({
      status: "SERVING",
      transport: "http-bridge",
    })
  })

  test("proto declares the headless service used by the SDK facade", () => {
    const proto = readFileSync(resolve(import.meta.dir, "../../proto/ax_code/v1/headless.proto"), "utf8")

    expect(proto).toContain("service AxCodeHeadless")
    expect(proto).toContain("rpc SendRuntimeCommand")
    expect(proto).toContain("rpc LoadBootstrap")
    expect(proto).toContain("rpc ListSessionMessages")
    expect(proto).toContain("rpc ListSkills")
    expect(proto).toContain("rpc FindFiles")
    expect(proto).toContain("rpc ConnectPty")
    expect(proto).toContain("rpc SubscribeEvents")
  })
})

function ptyMetaFrame(payload: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const bytes = new Uint8Array(encoded.length + 1)
  bytes[0] = 0
  bytes.set(encoded, 1)
  return bytes
}

async function* asyncFrames<T>(...frames: T[]) {
  yield* frames
}

function headerValue(headers: RequestInit["headers"], name: string) {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found?.[1] ?? null
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? null
}
