import { afterEach, describe, expect, test, vi } from "vitest"
import {
  axEngineAttachProviderConfig,
  axEngineConnectionApiKey,
  axEngineEndpointsMayAlias,
  axEngineManagedProviderConfig,
  normalizeAxEngineEndpointBaseURL,
  resolveAxEngineAttachBaseURL,
  resolveAxEngineConnectMode,
} from "../../../src/provider/ax-engine/connection"

afterEach(() => vi.unstubAllEnvs())

describe("AX Engine connection compatibility", () => {
  test("keeps legacy attachment on loopback and rejects unsafe URLs", () => {
    expect(normalizeAxEngineEndpointBaseURL("127.0.0.1:31418")).toBe("http://127.0.0.1:31418/v1")
    expect(normalizeAxEngineEndpointBaseURL("http://localhost:31418/v1")).toBe("http://localhost:31418/v1")
    expect(() => normalizeAxEngineEndpointBaseURL("https://api.example.com/v1")).toThrow(/local host/i)
    expect(() => normalizeAxEngineEndpointBaseURL("http://0.0.0.0:31418")).toThrow(/local host/i)
    expect(() => normalizeAxEngineEndpointBaseURL("ftp://localhost/model")).toThrow(/http/i)
    expect(() => normalizeAxEngineEndpointBaseURL("http://user:secret@localhost:31418")).toThrow(/credentials/i)
    expect(() => normalizeAxEngineEndpointBaseURL("")).toThrow(/required/i)
  })

  test("explicit local setup overrides legacy configuration and host environment", () => {
    vi.stubEnv("AX_ENGINE_HOST", undefined)
    expect(resolveAxEngineConnectMode()).toBe("managed")
    expect(resolveAxEngineConnectMode({ baseURL: "http://127.0.0.1:31418/v1" })).toBe("attach")
    vi.stubEnv("AX_ENGINE_HOST", "http://127.0.0.1:31419")
    expect(resolveAxEngineConnectMode()).toBe("attach")
    const options = axEngineManagedProviderConfig("AX Engine (Local)")["ax-engine"].options
    expect(options).toEqual({ connectionMode: "managed", baseURL: "", apiKey: "" })
    expect(resolveAxEngineConnectMode(options)).toBe("managed")
  })

  test("detects aliases of the same owned local process", () => {
    expect(axEngineEndpointsMayAlias("http://127.0.0.1:31418/v1", "http://localhost:31418")).toBe(true)
    expect(axEngineEndpointsMayAlias("http://127.0.0.2:31418/v1", "http://localhost:31418/v1")).toBe(false)
    expect(axEngineEndpointsMayAlias("http://localhost:31418/v1", "http://localhost:31419/v1")).toBe(false)
  })

  test("legacy attachment stores its endpoint without a plaintext credential", () => {
    expect(
      axEngineAttachProviderConfig({ providerName: "AX Engine (Local)", baseURL: "http://127.0.0.1:31418" }),
    ).toEqual({
      "ax-engine": {
        name: "AX Engine (Local)",
        options: { connectionMode: "attach", baseURL: "http://127.0.0.1:31418/v1", apiKey: "" },
      },
    })
  })

  test("resolves legacy endpoints and credentials only in the runtime compatibility layer", () => {
    vi.stubEnv("AX_ENGINE_HOST", undefined)
    vi.stubEnv("AX_ENGINE_API_KEY", undefined)
    expect(resolveAxEngineAttachBaseURL()).toBe("http://127.0.0.1:31418/v1")
    expect(axEngineConnectionApiKey({})).toBe("local")
    expect(resolveAxEngineAttachBaseURL({ baseURL: "http://127.0.0.1:9/v1" })).toBe("http://127.0.0.1:9/v1")
    expect(axEngineConnectionApiKey({ options: { apiKey: "k" } })).toBe("k")
  })
})
