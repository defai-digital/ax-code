import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { GlobalBus } from "../../src/bus/global"

Log.init({ print: false })

type ParsedSseFrame = {
  id?: string
  data: { directory?: string; payload?: { type?: string; properties?: Record<string, unknown> } }
}

async function readSseFrames(response: Response, count: number): Promise<ParsedSseFrame[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const frames: ParsedSseFrame[] = []
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

describe("GET /global/event", () => {
  test("delivers the connected frame with no ambient Instance context", async () => {
    // This route is mounted in server.ts ahead of the per-request
    // directory-scoping middleware (so /global/health and
    // /global/capabilities stay reachable without bootstrapping a project
    // instance), so a real deployment (app.fetch(request) called directly
    // by @hono/node-server / Bun.serve / the IPC bridge, per
    // runtime-adapter.ts and ipc-transport.ts) reaches this handler with no
    // AsyncLocalStorage instance context at all. Deliberately do NOT wrap
    // this call in Instance.provide() — that reflects the real dispatch
    // path, not the accidental context inheritance every other test in
    // this file gets from wrapping app.request() inside Instance.provide().
    const response = await Server.Default().request("/global/event")
    expect(response.status).toBe(200)
    const [connected] = await readSseFrames(response, 1)
    expect(connected?.data.payload?.type).toBe("server.connected")
    expect(connected?.data.directory).toBe("global")
  })

  test("control frames carry the GlobalEvent shape (directory + payload)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const response = await app.request("/global/event")
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("text/event-stream")

        const body = response.body!
        const reader = body.getReader()
        const decoder = new TextDecoder()
        try {
          let frame: { directory?: string; payload?: { type?: string } } | undefined
          let buffered = ""
          for (let i = 0; i < 10 && frame === undefined; i++) {
            const { value, done } = await reader.read()
            if (done) break
            buffered += decoder.decode(value, { stream: true })
            const dataLine = buffered
              .split("\n")
              .find((line) => line.startsWith("data: ") && line.length > "data: ".length)
            if (dataLine) {
              frame = JSON.parse(dataLine.slice("data: ".length))
            }
          }

          // The first frame is the server.connected control frame. It must
          // validate against the declared GlobalEvent schema, which requires
          // `directory` — exactly like every real data frame on this stream.
          // Unlike real events (which each carry their publisher's own
          // Instance.directory), this route is mounted ahead of the
          // directory-scoping middleware in server.ts, so there is no
          // ambient project directory for a control frame to report here —
          // it uses the same "global" sentinel as the dispose/upgrade
          // events below instead of Instance.directory (which would throw
          // Context.NotFound outside a wrapping Instance.provide()).
          expect(frame).toBeDefined()
          expect(frame!.payload?.type).toBe("server.connected")
          expect(frame!.directory).toBe("global")
        } finally {
          await reader.cancel().catch(() => {})
        }
      },
    })
  })

  test("replays missed events from Last-Event-ID before acknowledging the new subscription", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const first = await app.request("/global/event")
        const [connected] = await readSseFrames(first, 1)
        expect(connected?.data.payload?.type).toBe("server.connected")
        expect(connected?.id).toBeTruthy()

        GlobalBus.emit("event", {
          directory: tmp.path,
          payload: { type: "reconnect.test", properties: { value: 1 } },
        })

        const resumed = await app.request("/global/event", {
          headers: { "Last-Event-ID": connected!.id! },
        })
        const frames = await readSseFrames(resumed, 2)

        expect(frames.map((frame) => frame.data.payload?.type)).toEqual(["reconnect.test", "server.connected"])
        expect(frames[0]?.id).toBeTruthy()
        expect(frames[1]?.id).toBe(frames[0]?.id)
      },
    })
  })

  test("signals an authoritative resync when a cursor belongs to an older server epoch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request("/global/event", {
          headers: { "Last-Event-ID": "retired-server:1" },
        })
        const frames = await readSseFrames(response, 2)

        expect(frames.map((frame) => frame.data.payload?.type)).toEqual(["server.resync_required", "server.connected"])
        expect(frames[0]?.data.payload?.properties).toMatchObject({ reason: "server_restarted" })
        expect(frames[0]?.id).toBe(frames[1]?.id)
      },
    })
  })
})
