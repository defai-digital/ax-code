import { afterEach, describe, expect, test, vi } from "vitest"
import { submitPromptRoute } from "../../../src/cli/cmd/tui/component/prompt/prompt-submit"
import { SUBMIT_ACCEPT_TIMEOUT_MS } from "../../../src/cli/cmd/tui/component/prompt/prompt-config"

afterEach(() => vi.useRealTimers())

function setup(fetch: typeof globalThis.fetch) {
  const abort = new AbortController()
  return {
    abort,
    submit: () =>
      submitPromptRoute({
        sessionID: "ses_test",
        path: "prompt_async",
        body: { parts: [{ type: "text", text: "Review the change" }] },
        action: "Prompt submission",
        signal: abort.signal,
        url: "http://localhost:4096",
        headers: { "Content-Type": "application/json" },
        fetch,
      }),
  }
}

describe("prompt submission acceptance", () => {
  test("bounds the wait for an error response body after headers arrive", async () => {
    vi.useFakeTimers()
    let finishBody!: () => void
    const response = new Response(
      new ReadableStream({
        start(controller) {
          finishBody = () => controller.close()
        },
      }),
      { status: 503 },
    )
    const { submit } = setup(async () => response)
    let failure: unknown
    const pending = submit().catch((error) => {
      failure = error
    })
    try {
      await vi.advanceTimersByTimeAsync(SUBMIT_ACCEPT_TIMEOUT_MS + 1)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toBe(
        `Prompt submission acceptance timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
      )
    } finally {
      finishBody()
      await pending
    }
  })

  test("aborts a request that does not receive headers before the deadline", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let finish!: (response: Response) => void
    const { submit } = setup(async (_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    })
    const pending = submit().catch((error) => error)
    try {
      await vi.advanceTimersByTimeAsync(SUBMIT_ACCEPT_TIMEOUT_MS + 1)
      expect(await pending).toBeInstanceOf(Error)
      expect(signal?.aborted).toBe(true)
    } finally {
      finish(new Response(null, { status: 202 }))
      await pending
    }
  })

  test("preserves a server rejection message", async () => {
    const { submit } = setup(async () =>
      Response.json({ error: { data: { message: "Session is unavailable" } } }, { status: 409 }),
    )
    await expect(submit()).rejects.toThrow("Session is unavailable")
  })

  test("does not dispatch an already-cancelled submission", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { submit, abort } = setup(fetch)
    abort.abort(new Error("Submission cancelled"))

    await expect(submit()).rejects.toThrow("Submission cancelled")
    expect(fetch).not.toHaveBeenCalled()
  })

  test("does not accept a late response after cancellation", async () => {
    let finish!: (response: Response) => void
    const { submit, abort } = setup(() => new Promise<Response>((resolve) => (finish = resolve)))
    const pending = submit()
    abort.abort(new Error("Submission cancelled"))
    finish(new Response(null, { status: 202 }))

    await expect(pending).rejects.toThrow("Submission cancelled")
  })

  test("accepts a prompt without waiting for a success response body", async () => {
    const { submit } = setup(async () => new Response(null, { status: 202 }))
    await expect(submit()).resolves.toBeUndefined()
  })
})
