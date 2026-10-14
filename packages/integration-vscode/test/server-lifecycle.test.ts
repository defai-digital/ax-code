import { beforeEach, describe, expect, vi, test } from "vitest"

const backendStarts: any[] = []
let closeBackend: (() => void) | undefined
let closeCalls = 0
// When set, the mocked start blocks until released, so a test can dispose()
// while a start is in flight.
let startGate: Promise<void> | undefined

vi.doMock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace/project" } }],
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => {
        if (key === "serverTimeoutMs") return 12345
        if (key === "binaryPath") return ""
        return fallback
      },
    }),
  },
}))

vi.doMock("@ax-code/sdk/headless", () => ({
  startHeadlessBackend: async (options: any) => {
    backendStarts.push(options)
    if (startGate) await startGate
    const closed = new Promise<void>((resolve) => {
      closeBackend = resolve
    })
    return {
      url: "http://127.0.0.1:18456",
      headers: { Authorization: "Basic sdk-auth" },
      closed,
      close: async () => {
        closeCalls += 1
        closeBackend?.()
      },
    }
  },
}))

const { AxCodeServer } = await import("../src/server-lifecycle")

beforeEach(() => {
  backendStarts.length = 0
  closeBackend = undefined
  closeCalls = 0
  startGate = undefined
})

describe("AxCodeServer SDK lifecycle", () => {
  test("uses headless SDK for the installed ax-code path and clears stale state on exit", async () => {
    const server = new AxCodeServer({ extensionPath: "/not/a/monorepo/packages/integration-vscode" } as any)
    let exited = false
    server.setOnExit(() => {
      exited = true
    })

    await server.ensureStarted()

    expect(server.url).toBe("http://127.0.0.1:18456")
    expect(server.headers).toEqual({ Authorization: "Basic sdk-auth" })
    expect(backendStarts).toHaveLength(1)
    expect(backendStarts[0].directory).toBe("/workspace/project")
    expect(backendStarts[0].timeout).toBe(12345)
    expect(backendStarts[0].env.AX_CODE_CALLER).toBe("vscode")
    expect(backendStarts[0].env.AX_CODE_ORIGINAL_CWD).toBe("/workspace/project")

    closeBackend?.()
    await Promise.resolve()

    expect(server.url).toBeNull()
    expect(server.headers).toEqual({})
    expect(exited).toBe(true)
  })

  test("dispose during an in-flight SDK start closes the backend instead of adopting it", async () => {
    let release!: () => void
    startGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = new AxCodeServer({ extensionPath: "/not/a/monorepo/packages/integration-vscode" } as any)

    const started = server.ensureStarted()
    // The backend handle is only assigned after the await, so dispose() at this
    // point sees null and cannot close it — the start must do it.
    server.dispose()
    release()
    startGate = undefined
    await started

    expect(server.url).toBeNull()
    expect(closeCalls).toBe(1)
  })
})
