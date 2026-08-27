import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Log } from "../../src/util/log"
import { WorkspaceServer } from "../../src/control-plane/workspace-server/server"
import { parseSSE } from "../../src/control-plane/sse"
import { GlobalBus } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { AX_CODE_WORKSPACE_HEADER, LEGACY_OPENCODE_WORKSPACE_HEADER } from "../../src/util/workspace-headers"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

async function readWorkspaceSseFrames(response: Response, count: number) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const frames: Array<{ id?: string; data: { type?: string; properties?: Record<string, unknown> } }> = []
  let buffered = ""
  try {
    while (frames.length < count) {
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n")
      const blocks = buffered.split("\n\n")
      buffered = blocks.pop() ?? ""
      for (const block of blocks) {
        const lines = block.split("\n")
        const id = lines
          .find((line) => line.startsWith("id:"))
          ?.slice(3)
          .trim()
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data) continue
        frames.push({ id, data: JSON.parse(data) })
        if (frames.length === count) break
      }
    }
    return frames
  } finally {
    await reader.cancel().catch(() => {})
  }
}

describe("control-plane/workspace-server SSE", () => {
  test("rejects non-loopback listen", () => {
    expect(() => WorkspaceServer.Listen({ hostname: "0.0.0.0", port: 0 })).toThrow(/local-only/)
  })

  test("rejects missing workspace header", async () => {
    const app = WorkspaceServer.App()
    const response = await app.request("/event")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: `Missing or invalid ${AX_CODE_WORKSPACE_HEADER} or ${LEGACY_OPENCODE_WORKSPACE_HEADER} header`,
    })
  })

  test("accepts the current workspace header", async () => {
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          [AX_CODE_WORKSPACE_HEADER]: "wrk_test_workspace",
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()
    } finally {
      stop.abort()
    }
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
          [LEGACY_OPENCODE_WORKSPACE_HEADER]: "wrk_test_workspace",
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
          [LEGACY_OPENCODE_WORKSPACE_HEADER]: "wrk_test_workspace",
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

  test("replays workspace events missed while the client is disconnected", async () => {
    const app = WorkspaceServer.App()
    const headers = { [AX_CODE_WORKSPACE_HEADER]: "wrk_resume_workspace" }
    const first = await app.request("/event", { headers })
    const [connected] = await readWorkspaceSseFrames(first, 1)
    expect(connected?.data.type).toBe("server.connected")
    expect(connected?.id).toBeTruthy()

    GlobalBus.emit("event", {
      directory: "wrk_resume_workspace",
      payload: { type: "workspace.resume.test", properties: { ok: true } },
    })

    const resumed = await app.request("/event", {
      headers: { ...headers, "Last-Event-ID": connected!.id! },
    })
    const frames = await readWorkspaceSseFrames(resumed, 2)

    expect(frames.map((frame) => frame.data.type)).toEqual(["workspace.resume.test", "server.connected"])
    expect(frames[1]?.id).toBe(frames[0]?.id)
  })

  test("heartbeat respects the workspace SSE queue cap", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dirname, "../../src/control-plane/workspace-server/server.ts"),
      "utf-8",
    )
    const start = src.indexOf("const heartbeat = setInterval")
    const end = src.indexOf("}, 10_000)", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)

    expect(block).toContain("if (q.size >= SSE_MAX_QUEUE) return")
  })

  test("backpressure disconnects for replay instead of silently dropping events", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dirname, "../../src/control-plane/workspace-server/server.ts"),
      "utf-8",
    )

    expect(src).toContain("workspace SSE queue full; disconnecting client for resync")
    expect(src).not.toContain("workspace SSE queue full; dropping events")
  })
})
