import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  AX_CODE_GRPC_METHOD,
  AX_CODE_GRPC_PROTO_PATH,
  createAxCodeGrpcClient,
  createAxCodeGrpcClientFromHttp,
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
    expect(await pause("task-1")).toEqual({ id: "task-1", status: "paused" })
    expect(calls.map((call) => call.method)).toEqual([
      AX_CODE_GRPC_METHOD.Health,
      AX_CODE_GRPC_METHOD.CreateSession,
      AX_CODE_GRPC_METHOD.SendRuntimeCommand,
      AX_CODE_GRPC_METHOD.LoadBootstrap,
      AX_CODE_GRPC_METHOD.TaskQueueCommand,
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
    expect(proto).toContain("rpc SubscribeEvents")
  })
})

function headerValue(headers: RequestInit["headers"], name: string) {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found?.[1] ?? null
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? null
}
