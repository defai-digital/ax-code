import { beforeEach, describe, expect, test } from "bun:test"
import { closeAll, openAll } from "../../src/lsp/client-notify"
import { Log } from "../../src/util/log"

beforeEach(async () => {
  await Log.init({ print: false })
})

function client(input: { serverID: string; open?: () => Promise<boolean>; close?: () => Promise<boolean> }) {
  return {
    serverID: input.serverID,
    notify: {
      open: input.open ?? (async () => true),
      close: input.close ?? (async () => true),
    },
  }
}

describe("LSP client notify fan-out", () => {
  test("openAll counts fulfilled clients and reports rejected clients as not ok", async () => {
    const result = await openAll(
      [
        client({ serverID: "a", open: async () => true }),
        client({ serverID: "b", open: async () => false }),
        client({
          serverID: "c",
          open: async () => {
            throw new Error("boom")
          },
        }),
      ],
      { path: "/repo/demo.ts", waitForDiagnostics: true },
    )

    expect(result).toEqual({ count: 2, ok: false })
  })

  test("closeAll waits for every client even when one fails", async () => {
    const closed: string[] = []

    await closeAll(
      [
        client({
          serverID: "a",
          close: async () => {
            closed.push("a")
            return true
          },
        }),
        client({
          serverID: "b",
          close: async () => {
            throw new Error("boom")
          },
        }),
        client({
          serverID: "c",
          close: async () => {
            closed.push("c")
            return true
          },
        }),
      ],
      { path: "/repo/demo.ts", deleted: true },
    )

    expect(closed).toEqual(["a", "c"])
  })
})
