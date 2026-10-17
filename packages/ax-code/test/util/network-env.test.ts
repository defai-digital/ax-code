import { afterEach, describe, expect, test } from "vitest"
import {
  LOCAL_NO_PROXY,
  __resetNetworkEnvForTest,
  awaitSystemCa,
  hasProxyEnv,
  initNetworkEnv,
  loadSystemCertificatesInWorker,
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

  test("preserves explicit extra roots when installing system certificates", () => {
    let installed: string[] | undefined
    initNetworkEnv({
      env: {},
      http: {},
      log: fakeLogger(),
      tls: {
        getCACertificates: (kind) =>
          ({
            bundled: ["bundled-root"],
            system: ["system-root"],
            extra: ["extra-root", "bundled-root"],
            default: ["custom-root"],
          })[kind],
        setDefaultCACertificates: (certs) => {
          installed = certs
        },
      },
    })
    expect(installed).toEqual(["bundled-root", "extra-root", "custom-root", "system-root"])
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

describe("network-env asynchronous system CA loading", () => {
  function tlsFake() {
    const installs: string[][] = []
    const tls: TlsNetworkApi = {
      getCACertificates: () => ["bundled-root"],
      setDefaultCACertificates: (certs) => void installs.push(certs),
    }
    return { tls, installs }
  }

  test("startup does not wait: certificates are applied when the loader finishes", async () => {
    const { tls, installs } = tlsFake()
    let release!: (certs: string[]) => void
    const loadSystemCa = () => new Promise<string[]>((resolve) => (release = resolve))
    const state = initNetworkEnv({ env: {}, http: {}, tls, log: fakeLogger(), loadSystemCa })
    expect(state.systemCaApplied).toBe(false)
    expect(installs).toEqual([])

    let waited = false
    const waiting = awaitSystemCa().then(() => (waited = true))
    await Promise.resolve()
    expect(waited).toBe(false)

    release(["corp-root", "bundled-root"])
    await waiting
    expect(waited).toBe(true)
    // Bundled roots stay first and duplicates are dropped.
    expect(installs).toEqual([["bundled-root", "corp-root"]])
    expect(networkEnvState().systemCaApplied).toBe(true)
  })

  test("a loader failure or an empty store keeps the bundled roots and never throws", async () => {
    for (const loadSystemCa of [
      async () => undefined,
      async () => [],
      async () => Promise.reject(new Error("keychain")),
    ]) {
      __resetNetworkEnvForTest()
      const { tls, installs } = tlsFake()
      initNetworkEnv({ env: {}, http: {}, tls, log: fakeLogger(), loadSystemCa })
      await awaitSystemCa()
      expect(installs).toEqual([])
      expect(networkEnvState().systemCaApplied).toBe(false)
    }
  })

  test("cancels a pending wait without cancelling another caller's certificate load", async () => {
    const { tls, installs } = tlsFake()
    let release!: (certs: string[]) => void
    initNetworkEnv({
      env: {},
      http: {},
      tls,
      log: fakeLogger(),
      loadSystemCa: () =>
        new Promise<string[]>((resolve) => {
          release = resolve
        }),
    })
    const controller = new AbortController()
    const reason = new Error("cancelled")
    const waiting = awaitSystemCa(10_000, controller.signal)
    controller.abort(reason)
    await expect(waiting).rejects.toBe(reason)
    expect(installs).toEqual([])
    release(["corp-root"])
    await awaitSystemCa()
    expect(installs).toEqual([["bundled-root", "corp-root"]])
  })

  test("rejects an already cancelled wait even when there is no pending load", async () => {
    const reason = new Error("already cancelled")
    await expect(awaitSystemCa(10_000, AbortSignal.abort(reason))).rejects.toBe(reason)
  })

  test("awaiting is bounded when the loader never finishes", async () => {
    const { tls, installs } = tlsFake()
    initNetworkEnv({ env: {}, http: {}, tls, log: fakeLogger(), loadSystemCa: () => new Promise(() => {}) })
    const started = Date.now()
    await awaitSystemCa(30)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(installs).toEqual([])
  })

  test("awaiting resolves at once when nothing is pending and the loader is skipped when disabled", async () => {
    await awaitSystemCa(10_000)
    let called = 0
    const { tls } = tlsFake()
    initNetworkEnv({
      env: { AX_CODE_DISABLE_SYSTEM_CA: "1" },
      http: {},
      tls,
      log: fakeLogger(),
      loadSystemCa: async () => (called++, ["x"]),
    })
    await awaitSystemCa()
    expect(called).toBe(0)
  })

  test("a late loader from a reset initializer cannot replace the current trust store", async () => {
    const { tls, installs } = tlsFake()
    let release!: (certs: string[]) => void
    initNetworkEnv({
      env: {},
      http: {},
      tls,
      log: fakeLogger(),
      loadSystemCa: () =>
        new Promise<string[]>((resolve) => {
          release = resolve
        }),
    })
    __resetNetworkEnvForTest()
    initNetworkEnv({ env: {}, http: {}, tls, log: fakeLogger(), loadSystemCa: async () => ["new-root"] })
    await awaitSystemCa()
    release(["stale-root"])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(installs).toEqual([["bundled-root", "new-root"]])
  })

  test("the worker resolves unavailable when its deadline expires", async () => {
    expect(await loadSystemCertificatesInWorker(0)).toBeUndefined()
  })

  test("the real worker returns certificate strings without blocking the event loop", async () => {
    let ticks = 0
    const timer = setInterval(() => ticks++, 1)
    const certs = await loadSystemCertificatesInWorker()
    clearInterval(timer)
    if (certs !== undefined) {
      expect(Array.isArray(certs)).toBe(true)
      for (const cert of certs) expect(typeof cert).toBe("string")
    }
    // The main thread kept running while the worker read the OS store.
    expect(ticks).toBeGreaterThan(0)
  })
})
