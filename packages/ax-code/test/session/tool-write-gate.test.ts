import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { ToolWriteGate } from "../../src/session/tool-write-gate"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("ToolWriteGate", () => {
  test("shared lanes run together, exclusive lanes run alone in arrival order", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = SessionID.make("ses_gate")
        const releaseA = await ToolWriteGate.acquire(session, "shared")
        const releaseB = await ToolWriteGate.acquire(session, "shared")
        expect(ToolWriteGate.inspect(session)).toEqual({ active: "shared", count: 2, waiting: [] })

        let writerGranted = false
        const writer = ToolWriteGate.acquire(session, "exclusive").then((release) => {
          writerGranted = true
          return release
        })
        let lateReaderGranted = false
        const lateReader = ToolWriteGate.acquire(session, "shared").then((release) => {
          lateReaderGranted = true
          return release
        })
        await settled()
        expect(writerGranted).toBe(false)
        // FIFO: the reader queued behind the writer waits for it.
        expect(lateReaderGranted).toBe(false)
        expect(ToolWriteGate.inspect(session).waiting).toEqual(["exclusive", "shared"])

        releaseA()
        await settled()
        expect(writerGranted).toBe(false)
        releaseB()
        const releaseWriter = await writer
        expect(writerGranted).toBe(true)
        await settled()
        expect(lateReaderGranted).toBe(false)
        expect(ToolWriteGate.inspect(session)).toEqual({ active: "exclusive", count: 1, waiting: ["shared"] })

        releaseWriter()
        const releaseLate = await lateReader
        expect(ToolWriteGate.inspect(session)).toEqual({ active: "shared", count: 1, waiting: [] })
        releaseLate()
        expect(ToolWriteGate.inspect(session)).toEqual({ active: undefined, count: 0, waiting: [] })
      },
    })
  })

  test("releasing twice is harmless and an aborted waiter leaves the queue", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = SessionID.make("ses_gate_abort")
        const release = await ToolWriteGate.acquire(session, "exclusive")
        const controller = new AbortController()
        const waiting = ToolWriteGate.acquire(session, "exclusive", controller.signal)
        await settled()
        expect(ToolWriteGate.inspect(session).waiting).toEqual(["exclusive"])
        controller.abort()
        await expect(waiting).rejects.toThrow()
        expect(ToolWriteGate.inspect(session).waiting).toEqual([])
        release()
        release()
        expect(ToolWriteGate.inspect(session)).toEqual({ active: undefined, count: 0, waiting: [] })
        // Sessions are independent lanes.
        const other = await ToolWriteGate.acquire(SessionID.make("ses_gate_other"), "exclusive")
        other()
      },
    })
  })
})
