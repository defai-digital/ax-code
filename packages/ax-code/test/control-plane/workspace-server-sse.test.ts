import { afterEach, describe, expect, test, vi } from "vitest"
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
  test("failed subscription setup releases its heartbeat timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const error = new Error("subscription unavailable")
    const reported = vi.spyOn(console, "error").mockImplementation(() => {})
    const subscribe = vi.spyOn(GlobalBus, "subscribeFrom").mockImplementation(() => {
      throw error
    })
    try {
      const response = await WorkspaceServer.App().request("/event", {
        headers: { [AX_CODE_WORKSPACE_HEADER]: "wrk_failed_subscription" },
      })
      await response.text()
      expect(reported).toHaveBeenCalledWith(error)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      subscribe.mockRestore()
      reported.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

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

  test.each([1022, 1023])("preserves the workspace replay boundary at %i retained events", async (count) => {
    const app = WorkspaceServer.App()
    const workspaceID = `wrk_replay_capacity_${count}`
    const headers = { [AX_CODE_WORKSPACE_HEADER]: workspaceID }
    const [connected] = await readWorkspaceSseFrames(await app.request("/event", { headers }), 1)
    for (let i = 0; i < count; i++) {
      GlobalBus.emit("event", {
        directory: workspaceID,
        payload: { type: "workspace.capacity.test", properties: { value: i } },
      })
    }
    GlobalBus.emit("event", {
      directory: "wrk_unrelated_capacity",
      payload: { type: "workspace.unrelated.test", properties: {} },
    })
    const resumed = await app.request("/event", {
      headers: { ...headers, "Last-Event-ID": connected!.id! },
    })
    const frames = await readWorkspaceSseFrames(resumed, count === 1022 ? 1023 : 2)
    expect(frames.at(-1)?.data.type).toBe("server.connected")
    if (count === 1022) {
      expect(frames.slice(0, -1).map((frame) => frame.data.properties?.value)).toEqual(
        Array.from({ length: count }, (_, i) => i),
      )
    } else {
      expect(frames[0]?.data).toMatchObject({
        type: "server.resync_required",
        properties: { reason: "buffer_overflow" },
      })
      expect(frames[0]?.id).toBe(frames[1]?.id)
    }
  })
})
