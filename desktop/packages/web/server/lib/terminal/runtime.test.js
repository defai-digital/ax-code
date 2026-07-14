import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  TERMINAL_SHELL_STARTUP_GRACE_MS,
  createTerminalRuntime,
  observeTerminalShellStartup,
} from "./runtime.js"
import { createMockResponse, createRouteRegistry } from "../../test-helpers/route-harness.js"

function createRuntime(server, overrides = {}) {
  const app = overrides.app ?? {
    post() {},
    get() {},
    delete() {},
  }

  return createTerminalRuntime({
    app,
    server,
    express: { text: () => (_req, _res, next) => next?.() },
    fs,
    path,
    uiAuthController: null,
    buildAugmentedPath: () => process.env.PATH || "",
    searchPathFor: () => null,
    isExecutable: () => false,
    isRequestOriginAllowed: async () => true,
    rejectWebSocketUpgrade() {},
    TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 30_000,
    TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1_000,
    TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW: 3,
    ...overrides,
  })
}

describe("terminal runtime", () => {
  it("rejects a shell that emits output and then exits during startup", async () => {
    let onData = null
    let onExit = null
    const ptyProcess = {
      onData(callback) {
        onData = callback
        return { dispose() {} }
      },
      onExit(callback) {
        onExit = callback
        return { dispose() {} }
      },
    }

    const outcomePromise = observeTerminalShellStartup(ptyProcess, 50)
    onData("startup banner\\r\\n")
    setTimeout(() => onExit({ exitCode: 139, signal: 11 }), 1)

    await expect(outcomePromise).resolves.toEqual({
      crashed: true,
      exitCode: 139,
      signal: 11,
      earlyOutput: "startup banner\\r\\n",
    })
  })

  it("keeps a shell under observation long enough to catch delayed startup exits", async () => {
    let onExit = null
    const ptyProcess = {
      onData() {
        return { dispose() {} }
      },
      onExit(callback) {
        onExit = callback
        return { dispose() {} }
      },
    }

    const outcomePromise = observeTerminalShellStartup(ptyProcess, TERMINAL_SHELL_STARTUP_GRACE_MS)
    setTimeout(() => onExit({ exitCode: 0, signal: 11 }), 550)

    await expect(outcomePromise).resolves.toMatchObject({
      crashed: true,
      exitCode: 0,
      signal: 11,
    })
  })

  it("keeps collecting startup output until release() after a healthy start", async () => {
    let onData = null
    let disposed = false
    const ptyProcess = {
      onData(callback) {
        onData = callback
        return {
          dispose() {
            disposed = true
          },
        }
      },
      onExit() {
        return { dispose() {} }
      },
    }

    const outcomePromise = observeTerminalShellStartup(ptyProcess, 20)
    onData("prompt> ")
    const outcome = await outcomePromise

    expect(outcome.crashed).toBe(false)
    expect(outcome.earlyOutput).toBe("prompt> ")
    expect(disposed).toBe(false)
    expect(typeof outcome.release).toBe("function")

    onData("more")
    expect(outcome.release()).toBe("prompt> more")
    expect(disposed).toBe(true)
  })

  it("rejects terminal working directories that are not approved", async () => {
    const { app, getRoute } = createRouteRegistry()
    const server = new EventEmitter()
    const runtime = createRuntime(server, {
      app,
      fs: {
        promises: {
          stat: async () => {
            throw new Error("stat should not run before cwd authorization")
          },
        },
      },
      validateCwd: async () => ({ ok: false, error: "Path is outside of approved directories" }),
      uiAuthController: { enabled: false },
      buildAugmentedPath: () => "",
      TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 1000,
      TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1000,
    })

    try {
      const createRoute = getRoute("POST", "/api/terminal/create")
      const res = createMockResponse()

      await createRoute({ body: { cwd: "/tmp/not-approved" } }, res)

      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ error: "Path is outside of approved directories" })
    } finally {
      await runtime.shutdown()
    }
  })

  it("rejects regular files as terminal working directories", async () => {
    const { app, getRoute } = createRouteRegistry()
    const server = new EventEmitter()
    const runtime = createRuntime(server, {
      app,
      fs: {
        promises: {
          stat: async () => ({ isDirectory: () => false }),
        },
      },
      uiAuthController: { enabled: false },
      buildAugmentedPath: () => "",
      TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 1000,
      TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1000,
    })

    try {
      const createRoute = getRoute("POST", "/api/terminal/create")
      const res = createMockResponse()

      await createRoute({ body: { cwd: "/tmp/not-a-directory" } }, res)

      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error: "Invalid working directory" })
    } finally {
      await runtime.shutdown()
    }
  })

  it("removes its websocket upgrade listener on shutdown", async () => {
    const server = new EventEmitter()
    const runtime = createRuntime(server)

    expect(server.listenerCount("upgrade")).toBe(1)

    await runtime.shutdown()

    expect(server.listenerCount("upgrade")).toBe(0)
  })
})
