import { describe, expect, test, vi } from "vitest"
import { createWorkerFetch } from "../../../src/cli/cmd/tui/thread"

function setup(status = 200, body = "ok") {
  const call = vi.fn(async (..._args: unknown[]) => ({ status, body, headers: { "x-test": "preserved" } }))
  const fetcher = createWorkerFetch({ call } as unknown as Parameters<typeof createWorkerFetch>[0])
  return { fetcher, call }
}

describe("worker fetch bridge", () => {
  test.each([204, 205, 304])("reconstructs a null body for HTTP %i", async (status) => {
    const { fetcher } = setup(status, "")

    const response = await fetcher("http://internal.test/empty")

    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
    expect(response.headers.get("x-test")).toBe("preserved")
    expect(await response.text()).toBe("")
  })

  test("preserves ordinary request and response data", async () => {
    const { fetcher, call } = setup(201, '{"ok":true}')
    const response = await fetcher("http://internal.test/resource", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"input":true}',
    })

    expect(call.mock.calls[0]?.slice(0, 2)).toEqual([
      "fetch",
      {
        url: "http://internal.test/resource",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"input":true}',
      },
    ])
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true })
  })

  test("keeps HEAD responses bodyless", async () => {
    const { fetcher } = setup(200, "")

    const response = await fetcher("http://internal.test/resource", { method: "HEAD" })

    expect(response.body).toBeNull()
  })

  test("does not dispatch an already-aborted request", async () => {
    const { fetcher, call } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(fetcher("http://internal.test/resource", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(call).not.toHaveBeenCalled()
  })

  test("forwards cancellation while the RPC is pending", async () => {
    const { fetcher, call } = setup()
    const controller = new AbortController()
    const pending = fetcher("http://internal.test/resource", { signal: controller.signal })
    const options = call.mock.calls[0]?.[2] as { signal?: AbortSignal } | undefined
    controller.abort()

    await pending.catch(() => undefined)
    expect(options?.signal?.aborted).toBe(true)
  })

  test("ignores a response arriving after cancellation", async () => {
    const { fetcher, call } = setup()
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof call>>>()
    call.mockReturnValue(gate.promise)
    const controller = new AbortController()
    const pending = fetcher("http://internal.test/resource", { signal: controller.signal })
    controller.abort()
    gate.resolve({ status: 200, body: "late success", headers: { "x-test": "preserved" } })

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })
})
