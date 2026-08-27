import { describe, expect, test } from "vitest"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ReconnectTestEvent = BusEvent.define("reconnect.local.test", z.object({ value: z.number() }))

type ParsedSseFrame = {
  id?: string
  data: { type?: string; properties?: Record<string, unknown> }
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

describe("GET /event resume", () => {
  test("replays project events missed during a transient disconnect", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const eventUrl = `/event?directory=${encodeURIComponent(tmp.path)}`
        const first = await app.request(eventUrl)
        const [connected] = await readSseFrames(first, 1)
        expect(connected?.data.type).toBe("server.connected")
        expect(connected?.id).toBeTruthy()

        await Bus.publish(ReconnectTestEvent, { value: 42 })

        const resumed = await app.request(eventUrl, {
          headers: { "Last-Event-ID": connected!.id! },
        })
        const frames = await readSseFrames(resumed, 2)

        expect(frames.map((frame) => frame.data.type)).toEqual(["reconnect.local.test", "server.connected"])
        expect(frames[0]?.data.properties).toEqual({ value: 42 })
        expect(frames[1]?.id).toBe(frames[0]?.id)
      },
    })
  })
})
