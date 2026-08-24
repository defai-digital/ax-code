import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("GET /global/event", () => {
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
          expect(frame).toBeDefined()
          expect(frame!.payload?.type).toBe("server.connected")
          expect(frame!.directory).toBe(tmp.path)
        } finally {
          await reader.cancel().catch(() => {})
        }
      },
    })
  })
})
