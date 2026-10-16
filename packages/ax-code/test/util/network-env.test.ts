import { afterEach, describe, expect, test } from "vitest"
import {
  LOCAL_NO_PROXY,
  __resetNetworkEnvForTest,
  hasProxyEnv,
  initNetworkEnv,
  mergeNoProxy,
  networkEnvState,
  proxyEnvSummary,
  redactProxyUrl,
  type HttpNetworkApi,
  type NetworkLogger,
  type TlsNetworkApi,
} from "../../src/util/network-env"

afterEach(() => {
  __resetNetworkEnvForTest()
})

function fakeLogger(): NetworkLogger & { calls: Array<{ level: string; message: string; extra?: unknown }> } {
  const calls: Array<{ level: string; message: string; extra?: unknown }> = []
  return {
    calls,
    debug: (message, extra) => calls.push({ level: "debug", message, extra }),
    warn: (message, extra) => calls.push({ level: "warn", message, extra }),
  }
}

describe("network-env hasProxyEnv", () => {
  test("detects any proxy variable, upper or lower case", () => {
    expect(hasProxyEnv({})).toBe(false)
    expect(hasProxyEnv({ HTTP_PROXY: "  " })).toBe(false)
    expect(hasProxyEnv({ HTTP_PROXY: "http://p:1" })).toBe(true)
    expect(hasProxyEnv({ https_proxy: "http://p:1" })).toBe(true)
  })
})

describe("network-env redactProxyUrl", () => {
  test("strips userinfo credentials", () => {
    expect(redactProxyUrl("http://user:secret@proxy.example:8080")).toBe("***@proxy.example:8080")
  })

  test("keeps credential-free URLs intact", () => {
    expect(redactProxyUrl("http://proxy.example:8080")).toBe("http://proxy.example:8080")
  })

  test("never echoes credentials from a malformed value", () => {
    expect(redactProxyUrl("user:secret@broken")).toBe("***@broken")
    expect(redactProxyUrl("plainhost")).toBe("plainhost")
  })
})

describe("network-env mergeNoProxy", () => {
  test("adds local entries when none set", () => {
    expect(mergeNoProxy(undefined)).toBe(LOCAL_NO_PROXY.join(","))
  })

  test("preserves existing user entries and appends locals", () => {
    const merged = mergeNoProxy("example.com, internal.corp")
    expect(merged).toContain("example.com")
    expect(merged).toContain("internal.corp")
    for (const host of LOCAL_NO_PROXY) expect(merged).toContain(host)
  })

  test("does not duplicate entries case-insensitively", () => {
    const merged = mergeNoProxy("localhost,LOCALHOST")
    expect(
      merged
        .toLowerCase()
        .split(",")
        .filter((t) => t === "localhost"),
    ).toHaveLength(1)
  })

  test("does not overwrite a user NO_PROXY entirely", () => {
    const merged = mergeNoProxy("only.example")
    expect(merged.startsWith("only.example")).toBe(true)
  })
})

describe("network-env proxyEnvSummary", () => {
  test("redacts credentials and lists only set variables", () => {
    const summary = proxyEnvSummary({ HTTP_PROXY: "http://u:p@h:1", HTTPS_PROXY: "" })
    expect(summary).toBe("HTTP_PROXY=***@h:1")
    expect(summary).not.toContain("u:p")
  })
})

describe("network-env initNetworkEnv", () => {
  const proxyEnv = { HTTP_PROXY: "http://user:secret@proxy.example:8080" }

  test("calls setGlobalProxyFromEnv with merged NO_PROXY when a proxy is set", () => {
    const calls: Array<{ env?: unknown }> = []
    const http: HttpNetworkApi = {
      setGlobalProxyFromEnv: (env) => {
        calls.push({ env })
        return () => {}
      },
    }
    const state = initNetworkEnv({ env: proxyEnv, http, tls: {}, log: fakeLogger() })
    expect(state.proxyApplied).toBe(true)
    expect(calls).toHaveLength(1)
    const passed = calls[0]!.env as Record<string, string>
    expect(passed.HTTP_PROXY).toBe("http://user:secret@proxy.example:8080")
    expect(passed.NO_PROXY).toContain("localhost")
    expect(passed.NO_PROXY).toContain("127.0.0.1")
    expect(passed.NO_PROXY).toContain("::1")
    expect(passed.NO_PROXY).toContain("*.local")
  })

  test("does nothing when no proxy is set", () => {
    let called = 0
    const http: HttpNetworkApi = {
      setGlobalProxyFromEnv: () => {
        called++
        return () => {}
      },
    }
    const state = initNetworkEnv({ env: {}, http, tls: {}, log: fakeLogger() })
    expect(state.proxyApplied).toBe(false)
    expect(called).toBe(0)
  })

  test("never logs proxy credentials", () => {
    const log = fakeLogger()
    const http: HttpNetworkApi = { setGlobalProxyFromEnv: () => () => {} }
    initNetworkEnv({ env: proxyEnv, http, tls: {}, log })
    const text = JSON.stringify(log.calls)
    expect(text).not.toContain("secret")
    expect(text).not.toContain("user:secret")
  })

  test("is idempotent: a second call does not re-apply", () => {
    let called = 0
    const http: HttpNetworkApi = {
      setGlobalProxyFromEnv: () => {
        called++
        return () => {}
      },
    }
    const tls: TlsNetworkApi = {
      getCACertificates: (kind) => (kind === "system" ? ["sys"] : ["bundled"]),
      setDefaultCACertificates: () => {},
    }
    initNetworkEnv({ env: proxyEnv, http, tls, log: fakeLogger() })
    initNetworkEnv({ env: proxyEnv, http, tls, log: fakeLogger() })
    expect(called).toBe(1)
  })

  test("adds system CAs to the bundled list", () => {
    let installed: string[] | undefined
    const tls: TlsNetworkApi = {
      getCACertificates: (kind) => (kind === "system" ? ["sys-root"] : ["bundled-root"]),
      setDefaultCACertificates: (certs) => {
        installed = certs
      },
    }
    const state = initNetworkEnv({ env: {}, http: {}, tls, log: fakeLogger() })
    expect(state.systemCaApplied).toBe(true)
    expect(installed).toEqual(["bundled-root", "sys-root"])
  })

  test("skips system CA loading when AX_CODE_DISABLE_SYSTEM_CA is set", () => {
    let called = 0
    const tls: TlsNetworkApi = {
      getCACertificates: () => ["system"],
      setDefaultCACertificates: () => {
        called++
      },
    }
    const state = initNetworkEnv({ env: { AX_CODE_DISABLE_SYSTEM_CA: "1" }, http: {}, tls, log: fakeLogger() })
    expect(state.systemCaApplied).toBe(false)
    expect(called).toBe(0)
  })

  test("survives a throwing proxy setter", () => {
    const http: HttpNetworkApi = {
      setGlobalProxyFromEnv: () => {
        throw new Error("bad proxy")
      },
    }
    const state = initNetworkEnv({ env: proxyEnv, http, tls: {}, log: fakeLogger() })
    expect(state.proxyApplied).toBe(false)
  })

  test("networkEnvState reflects the last applied state", () => {
    expect(networkEnvState()).toEqual({ proxyApplied: false, systemCaApplied: false })
    initNetworkEnv({ env: proxyEnv, http: { setGlobalProxyFromEnv: () => () => {} }, tls: {}, log: fakeLogger() })
    expect(networkEnvState().proxyApplied).toBe(true)
  })
})
