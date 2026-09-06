import { afterEach, describe, expect, test, vi } from "vitest"
import { configureAxEngineLocalRuntime } from "../../../src/cli/cmd/tui/component/dialog-provider"

afterEach(() => vi.unstubAllEnvs())

describe("AX Engine local setup", () => {
  test("requests managed lifecycle without asking for or forwarding an endpoint or key", async () => {
    vi.stubEnv("AX_ENGINE_HOST", "http://127.0.0.1:9")
    vi.stubEnv("AX_ENGINE_API_KEY", "legacy-local-token")
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"mode":"managed"}'))

    await configureAxEngineLocalRuntime({
      url: "http://127.0.0.1:4096",
      directory: "/workspace/project",
      fetch,
    })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, request] = fetch.mock.calls[0]
    expect(String(url)).toBe("http://127.0.0.1:4096/provider/ax-engine/connection")
    expect(request?.method).toBe("PUT")
    expect(request?.body).toBe('{"mode":"managed"}')
    expect(new Headers(request?.headers).get("content-type")).toBe("application/json")
  })

  test("surfaces setup failure before the caller can open model selection", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"message":"Local runtime setup failed"}', { status: 400 }))
    await expect(
      configureAxEngineLocalRuntime({
        url: "http://127.0.0.1:4096",
        directory: "/workspace/project",
        fetch,
      }),
    ).rejects.toThrow("Local runtime setup failed")
    expect(fetch).toHaveBeenCalledOnce()
  })

  test("does not retry an uncertain connection update", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("Connection interrupted"))
    await expect(
      configureAxEngineLocalRuntime({
        url: "http://127.0.0.1:4096",
        directory: "/workspace/project",
        fetch,
      }),
    ).rejects.toThrow("Connection interrupted")
    expect(fetch).toHaveBeenCalledOnce()
  })
})
