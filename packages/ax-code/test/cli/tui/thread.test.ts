import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import {
  createEventSource,
  createTuiThreadTransport,
  createWorkerFetch,
  launchTuiThreadRenderer,
  resolveTuiThreadDirectory,
  validateTuiThreadArgs,
  type TuiThreadInput,
} from "../../../src/cli/cmd/tui/thread"
import type { Args } from "../../../src/cli/cmd/tui/context/args"

type RpcCall = {
  method: string
  args: unknown
}

function createRpcClient(log: RpcCall[] = []) {
  const listeners: Array<(event: unknown) => void> = []

  return {
    listeners,
    client: {
      call: async (method: string, args: unknown) => {
        log.push({ method, args })
        if (method === "server") return { url: "http://127.0.0.1:31337" }
        if (method === "fetch") {
          return {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: "ok",
          }
        }
        return undefined
      },
      on: (_event: string, handler: (event: unknown) => void) => {
        listeners.push(handler)
      },
    },
  }
}

function createTuiInput(overrides: Partial<TuiThreadInput> = {}): TuiThreadInput {
  return {
    url: "http://opencode.internal",
    directory: "/repo/main",
    config: {},
    onSnapshot: async () => [],
    args: {} as Args,
    ...overrides,
  }
}

describe("tui thread helpers", () => {
  test("resolves the real cwd when PWD points at a symlink", async () => {
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const origCwd = process.env.AX_CODE_ORIGINAL_CWD
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    await fs.symlink(tmp.path, link, type)

    try {
      process.chdir(tmp.path)
      process.env.PWD = link
      delete process.env.AX_CODE_ORIGINAL_CWD

      expect(resolveTuiThreadDirectory()).toBe(tmp.path)
      expect(resolveTuiThreadDirectory(".")).toBe(tmp.path)
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (origCwd === undefined) delete process.env.AX_CODE_ORIGINAL_CWD
      else process.env.AX_CODE_ORIGINAL_CWD = origCwd
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("rejects invalid fork usage before starting the TUI", () => {
    expect(validateTuiThreadArgs({ fork: true, continue: false, session: undefined })).toBe(
      "--fork requires --continue or --session",
    )
    expect(validateTuiThreadArgs({ fork: true, continue: true, session: undefined })).toBeUndefined()
    expect(validateTuiThreadArgs({ fork: true, continue: false, session: "ses_123" })).toBeUndefined()
  })

  test("forwards worker fetch calls through RPC with method, headers, and body intact", async () => {
    const calls: RpcCall[] = []
    const rpc = createRpcClient(calls)
    const workerFetch = createWorkerFetch(rpc.client as never)

    const response = await workerFetch("http://opencode.internal/test", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "payload",
    })

    expect(await response.text()).toBe("ok")
    expect(calls).toContainEqual({
      method: "fetch",
      args: {
        url: "http://opencode.internal/test",
        method: "POST",
        headers: { "x-test": "1" },
        body: "payload",
      },
    })
  })

  test("proxies event subscriptions and workspace changes through the RPC client", () => {
    const calls: RpcCall[] = []
    const rpc = createRpcClient(calls)
    const events = createEventSource(rpc.client as never)
    let received: unknown

    events.on((event) => {
      received = event
    })
    const setWorkspace = events.setWorkspace
    if (!setWorkspace) throw new Error("expected workspace setter")
    setWorkspace("ws_internal")
    const listener = rpc.listeners[0]
    if (!listener) throw new Error("expected event listener")
    listener({ type: "session.updated" })

    expect(received).toEqual({ type: "session.updated" })
    expect(calls).toContainEqual({
      method: "setWorkspace",
      args: { workspaceID: "ws_internal" },
    })
  })

  test("uses internal worker transport by default and external transport when network options are exposed", async () => {
    const internalCalls: RpcCall[] = []
    const internalRpc = createRpcClient(internalCalls)
    const internal = await createTuiThreadTransport({
      args: {
        port: 0,
        hostname: "127.0.0.1",
        mdns: false,
      } as never,
      client: internalRpc.client as never,
      argv: ["bun", "run", "src/index.ts"],
      resolveNetwork: async () => ({
        mdns: false,
        port: 0,
        hostname: "127.0.0.1",
      }),
    })

    expect(internal.url).toBe("http://opencode.internal")
    expect(typeof internal.fetch).toBe("function")
    expect(internal.events).toBeTruthy()
    expect(internalCalls).toHaveLength(0)

    const externalCalls: RpcCall[] = []
    const externalRpc = createRpcClient(externalCalls)
    const external = await createTuiThreadTransport({
      args: {
        port: 31337,
        hostname: "127.0.0.1",
        mdns: false,
      } as never,
      client: externalRpc.client as never,
      argv: ["bun", "run", "src/index.ts"],
      resolveNetwork: async () => ({
        mdns: false,
        port: 31337,
        hostname: "127.0.0.1",
      }),
    })

    expect(external).toEqual({
      url: "http://127.0.0.1:31337",
      fetch: undefined,
      events: undefined,
    })
    expect(externalCalls).toContainEqual({
      method: "server",
      args: {
        mdns: false,
        port: 31337,
        hostname: "127.0.0.1",
      },
    })
  })

  test("launches OpenTUI and native renderers with the expected diagnostics events", async () => {
    const events: Array<{ eventType: string; data?: Record<string, unknown> }> = []
    const openInput = createTuiInput({ directory: "/repo/opentui" })
    const nativeInput = createTuiInput({ directory: "/repo/native" })
    let openCalledWith: TuiThreadInput | undefined
    let nativeCalledWith: TuiThreadInput | undefined

    await launchTuiThreadRenderer(openInput, {
      rendererName: "opentui",
      runOpentui: async (input) => {
        openCalledWith = input
      },
      recordProcess: (eventType, data) => {
        events.push({ eventType, data })
      },
    })

    await launchTuiThreadRenderer(nativeInput, {
      rendererName: "native",
      runNativeTuiSlice: async (input) => {
        nativeCalledWith = input
      },
      recordProcess: (eventType, data) => {
        events.push({ eventType, data })
      },
    })

    expect(openCalledWith).toBe(openInput)
    expect(nativeCalledWith).toBe(nativeInput)
    expect(events).toEqual([
      {
        eventType: "tui.threadLaunchOpentui",
        data: { directory: "/repo/opentui" },
      },
      {
        eventType: "tui.threadLaunchNative",
        data: { directory: "/repo/native" },
      },
    ])
  })
})
