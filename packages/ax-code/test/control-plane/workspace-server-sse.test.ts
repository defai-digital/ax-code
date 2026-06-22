import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import { Log } from "../../src/util/log"
import { WorkspaceServer } from "../../src/control-plane/workspace-server/server"
import { parseSSE } from "../../src/control-plane/sse"
import { GlobalBus } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

describe("control-plane/workspace-server SSE", () => {
  test("requires server password for non-loopback listen", () => {
    expect(() => WorkspaceServer.Listen({ hostname: "0.0.0.0", port: 0 })).toThrow(
      /AX_CODE_SERVER_PASSWORD is required/,
    )
  })

  test("rejects missing workspace header", async () => {
    const app = WorkspaceServer.App()
    const response = await app.request("/event")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Missing or invalid x-opencode-workspace header",
    })
  })

  test("streams GlobalBus events and parseSSE reads them", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    const seen: unknown[] = []
    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-opencode-workspace": "wrk_test_workspace",
          "x-opencode-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for workspace.test event"))
        }, 3000)

        void parseSSE(response.body!, stop.signal, (event) => {
          seen.push(event)
          const next = event as { type?: string }
          if (next.type === "server.connected") {
            GlobalBus.emit("event", {
              directory: "wrk_test_workspace",
              payload: {
                type: "workspace.test",
                properties: { ok: true },
              },
            })
            return
          }
          if (next.type !== "workspace.test") return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      await done

      expect(seen.some((event) => (event as { type?: string }).type === "server.connected")).toBe(true)
      expect(seen).toContainEqual({
        type: "workspace.test",
        properties: { ok: true },
      })
    } finally {
      stop.abort()
    }
  })

  test("streams GlobalBus events with non-JSON-native payload values", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    const seen: unknown[] = []
    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-opencode-workspace": "wrk_test_workspace",
          "x-opencode-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      const payload: Record<string, unknown> = {
        type: "workspace.test",
        properties: { sequence: 1n },
      }
      payload.self = payload

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for serializable workspace.test event"))
        }, 3000)

        void parseSSE(response.body!, stop.signal, (event) => {
          seen.push(event)
          const next = event as { type?: string }
          if (next.type === "server.connected") {
            GlobalBus.emit("event", {
              directory: "wrk_test_workspace",
              payload,
            })
            return
          }
          if (next.type !== "workspace.test") return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      await done

      expect(seen).toContainEqual({
        type: "workspace.test",
        properties: { sequence: "1" },
        self: "[Circular]",
      })
    } finally {
      stop.abort()
    }
  })

  test("heartbeat respects the workspace SSE queue cap", async () => {
    const src = await Bun.file(
      path.join(import.meta.dirname, "../../src/control-plane/workspace-server/server.ts"),
    ).text()
    const start = src.indexOf("const heartbeat = setInterval")
    const end = src.indexOf("}, 10_000)", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)

    expect(block).toContain("if (q.size >= SSE_MAX_QUEUE) return")
  })
})
