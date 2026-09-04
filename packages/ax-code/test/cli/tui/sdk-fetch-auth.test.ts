import { describe, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"

// Exercise the real SDK initializer without rendering its context provider.
vi.mock("../../../src/cli/cmd/tui/context/helper", () => ({
  createSimpleContext: (input: { init: (props: unknown) => unknown }) => ({ provider: input.init, use: vi.fn() }),
}))

import { SDKProvider, type useSDK } from "../../../src/cli/cmd/tui/context/sdk"

function setup(headers?: HeadersInit) {
  const requests: Request[] = []
  return createRoot((dispose) => {
    const sdk = SDKProvider({
      url: "http://localhost:4096",
      directory: "/test/workspace",
      headers,
      events: { on: () => () => undefined },
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json([])
      },
    }) as unknown as ReturnType<typeof useSDK>
    return { sdk, requests, dispose }
  })
}

describe("TUI authenticated fetch", () => {
  test("sends attach headers for both SDK and direct prompt requests", async () => {
    const { sdk, requests, dispose } = setup({ Authorization: "test-authorization" })
    try {
      await sdk.client.session.list()
      await sdk.fetch(`${sdk.url}/session/ses_test/prompt_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-opencode-directory": "/test/other-workspace" },
        body: JSON.stringify({ parts: [{ type: "text", text: "Review this change" }] }),
      })

      expect(requests).toHaveLength(2)
      expect(requests[0].headers.get("Authorization")).toBe("test-authorization")
      expect(requests[1].headers.get("Authorization")).toBe("test-authorization")
      expect(requests[1].headers.get("x-opencode-directory")).toBe("/test/other-workspace")
      expect(await requests[1].json()).toEqual({ parts: [{ type: "text", text: "Review this change" }] })
    } finally {
      dispose()
    }
  })

  test("merges defaults with an existing Request and preserves its body and cancellation signal", async () => {
    const { sdk, requests, dispose } = setup(new Headers({ Authorization: "test-authorization" }))
    const abort = new AbortController()
    try {
      await sdk.fetch(
        new Request(`${sdk.url}/prompt-history`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "draft text",
          signal: abort.signal,
        }),
      )
      expect(requests[0].headers.get("Authorization")).toBe("test-authorization")
      expect(requests[0].headers.get("Content-Type")).toBe("text/plain")
      expect(await requests[0].text()).toBe("draft text")
      abort.abort()
      expect(requests[0].signal.aborted).toBe(true)
    } finally {
      dispose()
    }
  })

  test("preserves explicit request header overrides", async () => {
    const { sdk, requests, dispose } = setup({ Authorization: "test-default", "X-Client": "test-client" })
    try {
      await sdk.fetch(`${sdk.url}/session`, { headers: { authorization: "test-override" } })
      expect(requests[0].headers.get("Authorization")).toBe("test-override")
      expect(requests[0].headers.get("X-Client")).toBe("test-client")
    } finally {
      dispose()
    }
  })

  test("does not forward configured authentication to another origin", async () => {
    const { sdk, requests, dispose } = setup({ Authorization: "test-authorization" })
    try {
      await sdk.fetch("http://localhost:4097/unrelated")
      expect(requests[0].headers.has("Authorization")).toBe(false)
    } finally {
      dispose()
    }
  })
})
