import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

let calls = 0

mock.module("@/server/server", () => ({
  Server: {
    listen() {
      calls += 1
      return {
        hostname: "127.0.0.1",
        port: 4310,
        stop: async () => undefined,
      }
    },
  },
}))

const { DreGraphServer } = await import("../../src/cli/cmd/dre-graph-server")

describe("DreGraphServer", () => {
  beforeEach(() => {
    calls = 0
    DreGraphServer.clear()
  })

  afterEach(() => {
    DreGraphServer.clear()
  })

  test("reuses an existing 127.0.0.1 server url", async () => {
    const url = await DreGraphServer.page({
      base: "http://127.0.0.1:4096",
      sessionID: "ses_demo",
      directory: "/tmp/demo",
    })

    expect(url.toString()).toBe("http://127.0.0.1:4096/dre-graph/session/ses_demo?directory=%2Ftmp%2Fdemo")
    expect(calls).toBe(0)
  })

  test("starts and reuses a loopback server when the base url is internal", async () => {
    const a = await DreGraphServer.page({
      base: "http://opencode.internal",
      sessionID: "ses_a",
      directory: "/tmp/a",
    })
    const b = await DreGraphServer.page({
      base: "http://opencode.internal",
      sessionID: "ses_b",
      directory: "/tmp/b",
    })

    expect(a.toString()).toBe("http://127.0.0.1:4310/dre-graph/session/ses_a?directory=%2Ftmp%2Fa")
    expect(b.toString()).toBe("http://127.0.0.1:4310/dre-graph/session/ses_b?directory=%2Ftmp%2Fb")
    expect(calls).toBe(1)
  })
})
