// @vitest-environment node
// This suite drives window-present vs window-absent behaviour by stubbing
// globalThis.window itself, so it must run without jsdom's ambient window.
import { describe, expect, test } from "vitest"

import {
  buildDirectoryUrl,
  disconnectProviderAuth,
  fetchProviderJsonWithRetry,
  fetchProviderSources,
  isCliProvider,
  isRestartingError,
  parseAuthMethodsPayload,
  parseAvailableProvidersPayload,
  normalizeAuthType,
  saveProviderAuth,
} from "./providerApi"

const setWindowStub = (stub: unknown): void => {
  ;(globalThis as { window?: unknown }).window = stub
}
const clearWindowStub = (): void => {
  delete (globalThis as { window?: unknown }).window
}
const setFetchStub = (stub: typeof fetch): void => {
  ;(globalThis as { fetch: typeof fetch }).fetch = stub
}

describe("buildDirectoryUrl (no window — server/SSR)", () => {
  test("returns the URL unchanged when directory is null", () => {
    expect(buildDirectoryUrl("/api/provider/auth", null)).toBe("/api/provider/auth")
  })

  test("appends directory as a query parameter", () => {
    expect(buildDirectoryUrl("/api/provider/auth", "/home/user/project")).toBe(
      "/api/provider/auth?directory=%2Fhome%2Fuser%2Fproject",
    )
  })

  test("uses & separator when URL already has a query string", () => {
    expect(buildDirectoryUrl("/api/provider?foo=bar", "/home")).toBe("/api/provider?foo=bar&directory=%2Fhome")
  })
})

describe("buildDirectoryUrl (browser)", () => {
  test("resolves relative paths against the desktop server origin", () => {
    setWindowStub({
      __AX_CODE_DESKTOP_DESKTOP_SERVER__: { origin: "http://127.0.0.1:54321" },
      location: { origin: "app://ax-code" },
    })
    try {
      expect(buildDirectoryUrl("/api/provider/auth", "/home/user/project")).toBe(
        "http://127.0.0.1:54321/api/provider/auth?directory=%2Fhome%2Fuser%2Fproject",
      )
    } finally {
      clearWindowStub()
    }
  })

  test("falls back to window.location.origin when no desktop server is present (web)", () => {
    setWindowStub({ location: { origin: "https://app.example.com" } })
    try {
      expect(buildDirectoryUrl("/api/provider/auth", null)).toBe("https://app.example.com/api/provider/auth")
    } finally {
      clearWindowStub()
    }
  })
})

describe("isRestartingError", () => {
  test("returns true for objects with restarting: true", () => {
    expect(isRestartingError({ restarting: true })).toBe(true)
  })

  test("returns false for objects without restarting flag", () => {
    expect(isRestartingError({ error: "not found" })).toBe(false)
  })

  test("returns false for non-objects", () => {
    expect(isRestartingError(null)).toBe(false)
    expect(isRestartingError("error")).toBe(false)
    expect(isRestartingError(undefined)).toBe(false)
  })
})

describe("isCliProvider", () => {
  test("recognizes CLI-backed providers", () => {
    expect(isCliProvider("claude-code")).toBe(true)
    expect(isCliProvider("gemini-cli")).toBe(true)
    expect(isCliProvider("codex-cli")).toBe(true)
    expect(isCliProvider("grok-build-cli")).toBe(true)
    expect(isCliProvider("qoder-cli")).toBe(true)
    expect(isCliProvider("antigravity-cli")).toBe(true)
    expect(isCliProvider("openai")).toBe(false)
  })
})

describe("provider requests", () => {
  test("saveProviderAuth sends the auth key payload through the shared auth route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    setFetchStub((async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(true), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch)

    try {
      await saveProviderAuth("claude-code", "cli", "/home/user/project")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe("/api/auth/claude-code?directory=%2Fhome%2Fuser%2Fproject")
      expect(calls[0]?.init?.method).toBe("PUT")
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ type: "api", key: "cli" }))
    } finally {
      setFetchStub(originalFetch)
    }
  })

  test("disconnectProviderAuth resolves through the desktop server origin and preserves directory", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    setWindowStub({
      __AX_CODE_DESKTOP_DESKTOP_SERVER__: { origin: "http://127.0.0.1:54321" },
      location: { origin: "app://ax-code" },
    })
    setFetchStub((async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ requiresReload: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch)

    try {
      const result = await disconnectProviderAuth("openai", "/home/user/project", "all")
      expect(result).toEqual({ requiresReload: true })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(
        "http://127.0.0.1:54321/api/provider/openai/auth?directory=%2Fhome%2Fuser%2Fproject&scope=all",
      )
      expect(calls[0]?.init?.method).toBe("DELETE")
    } finally {
      setFetchStub(originalFetch)
      clearWindowStub()
    }
  })

  test("disconnectProviderAuth falls back to window.location.origin in web mode", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    setWindowStub({
      location: { origin: "https://app.example.com" },
    })
    setFetchStub((async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch)

    try {
      await disconnectProviderAuth("anthropic", "/work", "all")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe("https://app.example.com/api/provider/anthropic/auth?directory=%2Fwork&scope=all")
    } finally {
      setFetchStub(originalFetch)
      clearWindowStub()
    }
  })

  test("fetchProviderSources uses shared provider request handling", async () => {
    const originalFetch = globalThis.fetch
    const calls: string[] = []
    setFetchStub((async (url: RequestInfo | URL) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ data: { sources: { user: { exists: true } } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch)

    try {
      const result = await fetchProviderSources("openai", "/home/user/project")
      expect(result).toEqual({
        user: { exists: true },
      })
      expect(calls).toEqual(["/api/provider/openai/source?directory=%2Fhome%2Fuser%2Fproject"])
    } finally {
      setFetchStub(originalFetch)
    }
  })
})

describe("fetchProviderJsonWithRetry", () => {
  test("throws with restarting:true when all 503 restarting retries are exhausted", async () => {
    const originalFetch = globalThis.fetch
    setFetchStub((async () => {
      return new Response(JSON.stringify({ restarting: true }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch)

    try {
      await fetchProviderJsonWithRetry(
        "/api/test",
        { method: "GET" },
        {
          retryDelaysMs: [0],
          sleep: async () => {},
        },
      )
      expect(true).toBe(false) // should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as { restarting?: boolean }).restarting).toBe(true)
    } finally {
      setFetchStub(originalFetch)
    }
  })

  test("throws without restarting flag for non-restarting errors", async () => {
    const originalFetch = globalThis.fetch
    setFetchStub((async () => {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch)

    try {
      await fetchProviderJsonWithRetry("/api/test", { method: "GET" })
      expect(true).toBe(false) // should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as { restarting?: boolean }).restarting).toBeFalsy()
    } finally {
      setFetchStub(originalFetch)
    }
  })

  test("uses standard server error envelope messages", async () => {
    const originalFetch = globalThis.fetch
    setFetchStub((async () => {
      return new Response(
        JSON.stringify({
          name: "InvalidRequestError",
          message: "Unknown AX Engine model",
          status: 400,
          details: { resource: "model" },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      )
    }) as typeof fetch)

    try {
      await fetchProviderJsonWithRetry("/api/test", { method: "POST" })
      expect(true).toBe(false) // should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("Unknown AX Engine model")
    } finally {
      setFetchStub(originalFetch)
    }
  })
})

describe("parseAuthMethodsPayload", () => {
  test("parses a record of provider auth methods", () => {
    const payload = {
      openai: [{ type: "api", name: "API Key" }],
      anthropic: [{ type: "oauth", name: "OAuth" }],
    }
    const result = parseAuthMethodsPayload(payload)
    expect(result).toEqual({
      openai: [{ type: "api", name: "API Key" }],
      anthropic: [{ type: "oauth", name: "OAuth" }],
    })
  })

  test("returns empty object for non-record payloads", () => {
    expect(parseAuthMethodsPayload(null)).toEqual({})
    expect(parseAuthMethodsPayload("string")).toEqual({})
    expect(parseAuthMethodsPayload(undefined)).toEqual({})
  })

  test("filters out non-array values", () => {
    const payload = { openai: "not-an-array", anthropic: [{ type: "api" }] }
    const result = parseAuthMethodsPayload(payload)
    expect(result).toEqual({ anthropic: [{ type: "api" }] })
  })
})

describe("parseAvailableProvidersPayload", () => {
  test("parses an array of provider entries", () => {
    const payload = [{ id: "openai", name: "OpenAI" }, { id: "anthropic" }]
    const result = parseAvailableProvidersPayload(payload)
    expect(result).toEqual([{ id: "openai", name: "OpenAI" }, { id: "anthropic" }])
  })

  test('parses a record with an "all" array', () => {
    const payload = { all: [{ id: "openai" }, { id: "anthropic" }] }
    const result = parseAvailableProvidersPayload(payload)
    expect(result).toEqual([{ id: "openai" }, { id: "anthropic" }])
  })

  test('parses a record with a "providers" array', () => {
    const payload = { providers: [{ id: "openai" }] }
    const result = parseAvailableProvidersPayload(payload)
    expect(result).toEqual([{ id: "openai" }])
  })

  test("deduplicates entries by id", () => {
    const payload = [{ id: "openai" }, { id: "openai", name: "OpenAI" }]
    const result = parseAvailableProvidersPayload(payload)
    expect(result).toEqual([{ id: "openai" }])
  })

  test("handles string entries", () => {
    const payload = ["openai", "anthropic"]
    const result = parseAvailableProvidersPayload(payload)
    expect(result).toEqual([{ id: "openai" }, { id: "anthropic" }])
  })

  test("returns empty array for invalid payloads", () => {
    expect(parseAvailableProvidersPayload(null)).toEqual([])
    expect(parseAvailableProvidersPayload("string")).toEqual([])
    expect(parseAvailableProvidersPayload({})).toEqual([])
  })
})

describe("normalizeAuthType", () => {
  test('returns "oauth" for OAuth-type methods', () => {
    expect(normalizeAuthType({ type: "oauth" })).toBe("oauth")
    expect(normalizeAuthType({ name: "OAuth" })).toBe("oauth")
  })

  test('returns "api" for API-type methods', () => {
    expect(normalizeAuthType({ type: "api" })).toBe("api")
    expect(normalizeAuthType({ label: "API Key" })).toBe("api")
  })

  test("returns lowercase type for other methods", () => {
    expect(normalizeAuthType({ type: "DEVICE_CODE" })).toBe("device_code")
  })

  test("returns empty string for methods with no type info", () => {
    expect(normalizeAuthType({})).toBe("")
  })
})
