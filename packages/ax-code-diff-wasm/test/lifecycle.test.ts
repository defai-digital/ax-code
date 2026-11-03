import { expect, test } from "vitest"
import { createClient } from "../src/client.js"
import type { Request } from "../src/protocol.js"
const empty = JSON.stringify({ version: 1, groups: [] })
test("stale same-worker replies cannot satisfy another operation", async () => {
  let emit!: (value: unknown) => void, request!: Request
  const client = createClient((message) => {
    emit = message
    return {
      post(value) {
        request = value
      },
      async terminate() {},
    }
  })
  try {
    const first = client.compare([], 1)
    emit({ type: "ready", version: 1 })
    const id = request.id
    emit({ type: "result", id, json: empty })
    expect(await first).toEqual([])
    const next = client.compare([], 1)
    const rejected = expect(next).rejects.toThrow("response ID")
    expect(request.id).not.toBe(id)
    emit({ type: "result", id, json: empty })
    await rejected
  } finally {
    await client.close()
  }
})
test("failed termination preserves abort reason, retains ownership and is retried by close", async () => {
  let attempts = 0
  const client = createClient(() => ({
    post() {},
    async terminate() {
      if (++attempts < 3) throw new Error("terminate failed")
    },
  }))
  const controller = new AbortController(),
    reason = new Error("caller abort")
  const pending = client.compare([], 1, { signal: controller.signal })
  const rejected = expect(pending).rejects.toBe(reason)
  controller.abort(reason)
  await rejected
  await expect(client.compare([], 1)).rejects.toThrow("busy")
  await expect(client.close()).rejects.toThrow("terminate failed")
  await client.close()
  expect(attempts).toBe(3)
})
test("hung termination bounds caller latency without permitting a second worker", async () => {
  let finish!: () => void,
    spawned = 0
  const client = createClient(() => {
    spawned++
    return {
      post() {},
      terminate: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    }
  })
  const controller = new AbortController(),
    reason = new Error("cancel stuck worker")
  const pending = client.compare([], 1, { signal: controller.signal })
  const rejected = expect(pending).rejects.toBe(reason)
  controller.abort(reason)
  await rejected
  await expect(client.compare([], 1)).rejects.toThrow("busy")
  await expect(client.close()).rejects.toThrow("termination timed out")
  expect(spawned).toBe(1)
  finish()
  await Promise.resolve()
  await client.close()
})
