import { describe, expect, test } from "bun:test"
import { DesktopBackendManager } from "../src/lifecycle/backend-manager"
import { createAttachBackendPlan, createStartBackendPlan } from "../src/lifecycle/sidecar-plan"

describe("desktop backend manager", () => {
  test("starts a sidecar through injected headless lifecycle and records diagnostics", async () => {
    let closed = false
    let startEnv: Record<string, string> | undefined
    const manager = new DesktopBackendManager({
      now: fixedClock([1, 2, 3, 4, 5, 6]),
      sidecarEnv: () => ({
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        OPENAI_API_KEY: "shell-key",
        SHELL_ONLY: "shell-value",
      }),
      startBackend: async (options) => {
        startEnv = options.env
        options.onStdout?.("ready")
        return {
          url: "http://127.0.0.1:4444",
          headers: { Authorization: "Basic secret" },
          close: async () => {
            closed = true
          },
        }
      },
    })

    const connection = await manager.connect(
      createStartBackendPlan({
        directory: "/workspace/ax-code",
        env: {
          OPENAI_API_KEY: "explicit-key",
          AX_CODE_DESKTOP: "1",
        },
      }),
    )

    expect(connection).toMatchObject({
      url: "http://127.0.0.1:4444",
      mode: "start",
      loopbackOnly: true,
      generatedAuth: true,
    })
    expect(manager.diagnostics()).toMatchObject({
      status: "running",
      mode: "start",
      url: "http://127.0.0.1:4444",
    })
    expect(startEnv).toMatchObject({
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      OPENAI_API_KEY: "explicit-key",
      SHELL_ONLY: "shell-value",
      AX_CODE_DESKTOP: "1",
    })
    expect(manager.exportLogs()).toContain("[stdout] ready")

    await manager.close()
    expect(closed).toBe(true)
    expect(manager.diagnostics().status).toBe("closed")
  })

  test("attaches without owning a backend process", async () => {
    const requested: Array<{ url: string; headers: HeadersInit | undefined }> = []
    const manager = new DesktopBackendManager({
      startBackend: async () => {
        throw new Error("should not start")
      },
      fetch: async (url, init) => {
        requested.push({ url: String(url), headers: init?.headers })
        return new Response("ok", { status: 200 })
      },
    })

    const connection = await manager.connect(
      createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic token" }),
    )

    expect(connection).toMatchObject({
      mode: "attach",
      url: "http://127.0.0.1:4096",
      headers: { authorization: "Basic token" },
    })
    expect(requested).toEqual([
      {
        url: "http://127.0.0.1:4096/global/health",
        headers: { authorization: "Basic token" },
      },
    ])

    await manager.close()
    expect(manager.exportLogs()).toContain("detached from backend")
  })

  test("reconnects by opening the new project before closing the current backend", async () => {
    const closed: string[] = []
    const startedDirectories: Array<string | undefined> = []
    const manager = new DesktopBackendManager({
      startBackend: async (options) => {
        startedDirectories.push(options.directory)
        const directory = options.directory ?? "unknown"
        return {
          url: `http://127.0.0.1:${startedDirectories.length === 1 ? 4555 : 4556}`,
          headers: {},
          close: async () => {
            closed.push(directory)
          },
        }
      },
    })

    await manager.connect(createStartBackendPlan({ directory: "/workspace/first" }))
    const connection = await manager.reconnect(createStartBackendPlan({ directory: "/workspace/second" }))

    expect(startedDirectories).toEqual(["/workspace/first", "/workspace/second"])
    expect(closed).toEqual(["/workspace/first"])
    expect(connection).toMatchObject({
      url: "http://127.0.0.1:4556",
      directory: "/workspace/second",
      mode: "start",
    })
    expect(manager.getConnection()).toMatchObject({
      url: "http://127.0.0.1:4556",
      directory: "/workspace/second",
    })
  })

  test("keeps the current backend running when reconnect attach health fails", async () => {
    const closed: string[] = []
    const manager = new DesktopBackendManager({
      startBackend: async (options) => {
        const directory = options.directory ?? "unknown"
        return {
          url: "http://127.0.0.1:4555",
          headers: { authorization: "Basic current" },
          close: async () => {
            closed.push(directory)
          },
        }
      },
      fetch: async () => new Response("unauthorized", { status: 401 }),
    })

    await manager.connect(createStartBackendPlan({ directory: "/workspace/first" }))

    await expect(
      manager.reconnect(
        createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic wrong" }),
      ),
    ).rejects.toThrow("Check attach authentication")

    expect(closed).toEqual([])
    expect(manager.getConnection()).toMatchObject({
      url: "http://127.0.0.1:4555",
      directory: "/workspace/first",
      mode: "start",
    })
    expect(manager.diagnostics()).toMatchObject({
      status: "running",
      mode: "start",
      url: "http://127.0.0.1:4555",
      error: "Attached AX Code backend health check failed (401). Check attach authentication.",
    })
    expect(JSON.stringify(manager.diagnostics())).not.toContain("Basic wrong")
  })

  test("keeps the current backend running when reconnect startup fails", async () => {
    const closed: string[] = []
    const manager = new DesktopBackendManager({
      startBackend: async (options) => {
        if (options.directory === "/workspace/second") throw new Error("startup failed")
        const directory = options.directory ?? "unknown"
        return {
          url: "http://127.0.0.1:4555",
          headers: {},
          close: async () => {
            closed.push(directory)
          },
        }
      },
    })

    await manager.connect(createStartBackendPlan({ directory: "/workspace/first" }))

    await expect(manager.reconnect(createStartBackendPlan({ directory: "/workspace/second" }))).rejects.toThrow(
      "startup failed",
    )

    expect(closed).toEqual([])
    expect(manager.getConnection()).toMatchObject({
      url: "http://127.0.0.1:4555",
      directory: "/workspace/first",
      mode: "start",
    })
    expect(manager.diagnostics()).toMatchObject({
      status: "running",
      mode: "start",
      url: "http://127.0.0.1:4555",
      error: "startup failed",
    })
  })

  test("reconnects from a sidecar to an attached backend", async () => {
    const closed: string[] = []
    const healthChecks: string[] = []
    const manager = new DesktopBackendManager({
      startBackend: async (options) => {
        const directory = options.directory ?? "unknown"
        return {
          url: "http://127.0.0.1:4555",
          headers: {},
          close: async () => {
            closed.push(directory)
          },
        }
      },
      fetch: async (url) => {
        healthChecks.push(String(url))
        return new Response("ok", { status: 200 })
      },
    })

    await manager.connect(createStartBackendPlan({ directory: "/workspace/first" }))
    const connection = await manager.reconnect(
      createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic attached" }),
    )

    expect(closed).toEqual(["/workspace/first"])
    expect(healthChecks).toEqual(["http://127.0.0.1:4096/global/health"])
    expect(connection).toMatchObject({
      url: "http://127.0.0.1:4096",
      headers: { authorization: "Basic attached" },
      mode: "attach",
    })
    expect(manager.getConnection()).toMatchObject({
      url: "http://127.0.0.1:4096",
      mode: "attach",
    })
  })

  test("records close failure without leaving stale running diagnostics", async () => {
    const manager = new DesktopBackendManager({
      startBackend: async () => ({
        url: "http://127.0.0.1:4555",
        headers: {},
        close: async () => {
          throw new Error("close failed")
        },
      }),
    })

    await manager.connect(createStartBackendPlan({ directory: "/workspace/ax-code" }))
    await expect(manager.close()).rejects.toThrow("close failed")

    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      error: "close failed",
    })
    expect(manager.exportLogs()).toContain("backend close failed: close failed")
  })

  test("fails attach mode on health or auth failure without leaking a running connection", async () => {
    const manager = new DesktopBackendManager({
      fetch: async () => new Response("unauthorized", { status: 401 }),
    })

    await expect(
      manager.connect(createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic secret" })),
    ).rejects.toThrow("Check attach authentication")

    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      mode: "attach",
      error: "Attached AX Code backend health check failed (401). Check attach authentication.",
    })
    expect(JSON.stringify(manager.diagnostics())).not.toContain("Basic secret")
  })

  test("times out stalled attach health checks without leaking a running connection", async () => {
    const manager = new DesktopBackendManager({
      attachHealthTimeoutMs: 1,
      fetch: async () => new Promise<Response>(() => {}),
    })

    await expect(
      manager.connect(createAttachBackendPlan({ baseUrl: "http://127.0.0.1:4096/", authHeader: "Basic secret" })),
    ).rejects.toThrow("Attached AX Code backend health check timed out after 1ms.")

    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      mode: "attach",
      error: "Unable to reach attached AX Code backend: Attached AX Code backend health check timed out after 1ms.",
    })
    expect(JSON.stringify(manager.diagnostics())).not.toContain("Basic secret")
  })

  test("records startup failure without leaking a running connection", async () => {
    const manager = new DesktopBackendManager({
      startBackend: async () => {
        throw new Error("boom")
      },
    })

    await expect(manager.connect(createStartBackendPlan({ directory: "/workspace/ax-code" }))).rejects.toThrow("boom")

    expect(manager.getConnection()).toBeUndefined()
    expect(manager.diagnostics()).toMatchObject({
      status: "failed",
      error: "boom",
    })
  })
})

function fixedClock(values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}
