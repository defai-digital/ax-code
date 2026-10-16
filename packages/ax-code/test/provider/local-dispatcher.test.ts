import { describe, expect, test } from "vitest"
import {
  __resetLocalDispatcherForTest,
  ensureLocalDispatcher,
  hostFromRequest,
  isLocalProviderHost,
  needsLocalDispatcher,
  selectDispatcher,
} from "../../src/provider/local-dispatcher"

describe("local-dispatcher isLocalProviderHost", () => {
  const local = [
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.5.5.5",
    "::1",
    "10.0.0.1",
    "10.255.255.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "0.0.0.0",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "ollama",
    "lmstudio",
    "model.local",
    "gateway.internal",
  ]

  const remote = [
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just outside 172.16/12
    "192.169.1.1", // not 192.168/16
    "2001:4860:4860::8888", // public IPv6
    "example.com",
  ]

  test.each(local)("treats %s as local", (host) => {
    expect(isLocalProviderHost(host)).toBe(true)
  })

  test.each(remote)("treats %s as remote", (host) => {
    expect(isLocalProviderHost(host)).toBe(false)
  })

  test("handles bracketed IPv6 and trailing dots", () => {
    expect(isLocalProviderHost("[::1]")).toBe(true)
    expect(isLocalProviderHost("localhost.")).toBe(true)
  })

  test("returns false for empty input", () => {
    expect(isLocalProviderHost("")).toBe(false)
    expect(isLocalProviderHost("   ")).toBe(false)
  })
})

describe("local-dispatcher hostFromRequest", () => {
  test("extracts host from string, URL, and Request", () => {
    expect(hostFromRequest("http://localhost:38080/v1")).toBe("localhost")
    expect(hostFromRequest(new URL("https://api.openai.com/v1"))).toBe("api.openai.com")
    expect(hostFromRequest(new Request("http://192.168.0.10:1234/v1"))).toBe("192.168.0.10")
  })

  test("returns undefined for a malformed target", () => {
    expect(hostFromRequest("not a url")).toBeUndefined()
  })
})

describe("local-dispatcher selectDispatcher", () => {
  test("returns the dispatcher for a local host", () => {
    const sentinel = { kind: "agent" }
    const got = selectDispatcher({ url: "http://127.0.0.1:38080/v1/chat" }, () => sentinel)
    expect(got).toBe(sentinel)
  })

  test("returns undefined for a public host without timeout opt-out", () => {
    const got = selectDispatcher({ url: "https://api.openai.com/v1/chat" }, () => ({ kind: "agent" }))
    expect(got).toBeUndefined()
  })

  test("returns the dispatcher for a public host when timeout is disabled", () => {
    const sentinel = { kind: "agent" }
    const got = selectDispatcher({ url: "https://api.openai.com/v1/chat", timeoutDisabled: true }, () => sentinel)
    expect(got).toBe(sentinel)
  })

  test("propagates a factory that yields no dispatcher (undici missing)", () => {
    const got = selectDispatcher({ url: "http://localhost:11434/v1" }, () => undefined)
    expect(got).toBeUndefined()
  })

  test("resets the memoized agent for test isolation", () => {
    __resetLocalDispatcherForTest()
    expect(typeof selectDispatcher).toBe("function")
  })
})

describe("local-dispatcher real undici Agent", () => {
  test("loads the bundled undici and serves the default dispatcher for local hosts only", async () => {
    __resetLocalDispatcherForTest()
    expect(selectDispatcher({ url: "http://127.0.0.1:8080/v1" })).toBeUndefined()
    await ensureLocalDispatcher()
    const agent = selectDispatcher({ url: "http://127.0.0.1:8080/v1" })
    expect(agent).toBeDefined()
    expect(typeof (agent as { dispatch?: unknown }).dispatch).toBe("function")
    expect(selectDispatcher({ url: "https://api.openai.com/v1" })).toBeUndefined()
    __resetLocalDispatcherForTest()
  })

  test("needsLocalDispatcher mirrors the selection rule", () => {
    expect(needsLocalDispatcher({ url: "http://localhost:11434" })).toBe(true)
    expect(needsLocalDispatcher({ url: "https://api.openai.com" })).toBe(false)
    expect(needsLocalDispatcher({ url: "https://api.openai.com", timeoutDisabled: true })).toBe(true)
  })
})
