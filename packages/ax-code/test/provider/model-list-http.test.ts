import { expect, test, vi } from "vitest"
import { requestModelList } from "../../src/provider/model-list-http"

const options = {
  url: "https://catalog.example.invalid/v1/models",
  label: "Model list",
  timeoutMs: 5_000,
}

test("uses the caller's cancellation and rejects redirects for authenticated discovery", async () => {
  const caller = new AbortController()
  const headers = { Authorization: "Bearer fixture" }
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [] }))
  await expect(requestModelList({ ...options, fetcher, headers, signal: caller.signal })).resolves.toEqual({ data: [] })
  expect(fetcher).toHaveBeenCalledOnce()
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe(options.url)
  expect(init).toMatchObject({ method: "GET", redirect: "error", headers })
  caller.abort()
  expect(init?.signal?.aborted).toBe(true)
})

test("cancels the error response body and reports its status", async () => {
  const cancel = vi.fn()
  const fetcher = async () => new Response(new ReadableStream({ cancel }), { status: 429 })
  await expect(requestModelList({ ...options, fetcher })).rejects.toThrow("Model list returned HTTP 429")
  expect(cancel).toHaveBeenCalledOnce()
})

test("cancels a model list that crosses the byte limit", async () => {
  const cancel = vi.fn()
  const fetcher = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1))
        },
        cancel,
      }),
    )
  await expect(requestModelList({ ...options, fetcher })).rejects.toThrow(
    "Model list exceeded the model list size limit",
  )
  expect(cancel).toHaveBeenCalledOnce()
})

test("reports a malformed response without including the body in its message", async () => {
  const fetcher = async () => new Response("Invalid response fixture")
  await expect(requestModelList({ ...options, fetcher })).rejects.toThrow("Model list returned invalid JSON")
})
