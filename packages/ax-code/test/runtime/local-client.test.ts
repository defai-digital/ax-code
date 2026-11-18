import { beforeEach, expect, test, vi } from "vitest"
import { RuntimeLocalClient } from "../../src/runtime/local-client"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { DEFAULT_SERVER_PORT } from "../../src/constants/server"

const bridge = vi.hoisted(() => ({ fetch: vi.fn<(request: Request) => Promise<Response>>() }))

vi.mock("../../src/server/server", () => ({
  Server: {
    Default: () => ({ fetch: bridge.fetch }),
    currentUrl: () => new URL("http://localhost:1234"),
  },
}))
vi.mock("@ax-code/sdk/v2", () => {
  throw new Error("In-process requests must not load the SDK server launcher")
})

beforeEach(() => {
  bridge.fetch.mockReset()
})

test.each([undefined, "http://127.0.0.1:4123"])(
  "in-process requests preserve scoping, payload and cancellation with base URL %s",
  async (baseUrl) => {
    const directory = "/tmp/日本語 work"
    let received: Request | undefined
    let payload: unknown
    bridge.fetch.mockImplementation(async (request) => {
      received = request
      payload = await request.json()
      return Response.json({ id: "ses_local" })
    })
    const controller = new AbortController()
    const client = RuntimeLocalClient.create({ directory, baseUrl })
    const response = await client.session.create({ title: "client payload" }, { signal: controller.signal })
    expect(response.data?.id).toBe("ses_local")
    if (!received) throw new Error("Expected an in-process request")
    expect(received.url).toBe(`${baseUrl ?? `http://localhost:${DEFAULT_SERVER_PORT}`}/session`)
    expect(received.method).toBe("POST")
    expect(received.headers.get("x-ax-code-directory")).toBe(encodeURIComponent(directory))
    expect(received.headers.get("x-opencode-directory")).toBe(encodeURIComponent(directory))
    expect(ServerRuntimeAuth.isAuthorized(received.headers.get(ServerRuntimeAuth.HEADER) ?? undefined)).toBe(true)
    expect(payload).toEqual({ title: "client payload" })
    expect(received.signal.aborted).toBe(false)
    controller.abort()
    expect(received.signal.aborted).toBe(true)
  },
)
