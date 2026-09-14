import { beforeEach, describe, expect, test } from "vitest"
import { closeAll, openAll } from "@ax-code/ax-code-intel/client-notify"
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

  test.each([false, true])("closeAll waits for every client, with strict deadline reporting=%s", async (strict) => {
    const closed: string[] = []

    const result = closeAll(
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
      { path: "/repo/demo.ts", deleted: true, ...(strict ? { deadline: Date.now() + 2000 } : {}) },
    )
    if (strict) await expect(result).rejects.toThrow("incomplete")
    else await result

    expect(closed).toEqual(["a", "c"])
  })
})
