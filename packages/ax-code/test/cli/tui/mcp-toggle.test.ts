import { describe, expect, test } from "vitest"
import { toggleMcpServer } from "../../../src/cli/tui/context/mcp-toggle"

function harness(input: { connected: boolean; fail?: "connect" | "refresh" }) {
  const calls: string[] = []
  return {
    calls,
    run: () =>
      toggleMcpServer({
        connected: input.connected,
        connect: async () => {
          calls.push("connect")
          if (input.fail === "connect") throw new Error("boom")
        },
        disconnect: async () => {
          calls.push("disconnect")
        },
        refresh: async () => {
          calls.push("refresh")
          if (input.fail === "refresh") throw new Error("status down")
        },
      }),
  }
}

describe("toggleMcpServer", () => {
  test("connects when disconnected and refreshes status", async () => {
    const h = harness({ connected: false })
    await h.run()
    expect(h.calls).toEqual(["connect", "refresh"])
  })

  test("disconnects when connected and refreshes status", async () => {
    const h = harness({ connected: true })
    await h.run()
    expect(h.calls).toEqual(["disconnect", "refresh"])
  })

  test("refreshes even when connect fails, and still surfaces the error", async () => {
    const h = harness({ connected: false, fail: "connect" })
    await expect(h.run()).rejects.toThrow("boom")
    expect(h.calls).toEqual(["connect", "refresh"])
  })

  test("a failing refresh does not fail the toggle", async () => {
    const h = harness({ connected: false, fail: "refresh" })
    await h.run()
    expect(h.calls).toEqual(["connect", "refresh"])
  })
})
