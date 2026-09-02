import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  PACKAGED_RENDERER_ORIGIN,
  RENDERER_API_ORIGIN_ARG_PREFIX,
  isPackagedRendererUrl,
  isPackagedRendererOrigin,
  isTrustedRendererNavigationUrl,
  isLoopbackApiPath,
  buildRendererApiOrigin,
  buildRendererApiOriginAdditionalArguments,
  readRendererApiOriginFromArgv,
  buildPackagedRendererCsp,
  parseCspDirective,
  isLoopbackConnectSrc,
  resolvePackagedRendererAssetPath,
  createPackagedRendererProtocolHandler,
} = require("./desktop-renderer-protocol.js")

describe("packaged renderer protocol policy", () => {
  test("trusts only the app://ax-code origin", () => {
    expect(isPackagedRendererOrigin(PACKAGED_RENDERER_ORIGIN)).toBe(true)
    expect(isPackagedRendererUrl("app://ax-code/")).toBe(true)
    expect(isPackagedRendererUrl("app://ax-code/auth/session")).toBe(true)
    expect(isPackagedRendererUrl("app://evil/")).toBe(false)
    expect(isTrustedRendererNavigationUrl("app://ax-code/")).toBe(true)
  })

  test("CSP connect-src is loopback-only", () => {
    const csp = buildPackagedRendererCsp()
    expect(csp).toContain("default-src 'self' app://ax-code")
    const connectSrc = parseCspDirective(csp, "connect-src")
    expect(connectSrc.every((source) => isLoopbackConnectSrc(source))).toBe(true)
  })

  test("CSP img-src allows models.dev provider logos", () => {
    const imgSrc = parseCspDirective(buildPackagedRendererCsp(), "img-src")
    expect(imgSrc).toContain("https://models.dev")
  })

  test("asset path resolver blocks escape from web-dist", () => {
    const root = path.resolve("/app/web-dist")
    expect(resolvePackagedRendererAssetPath(root, "/../secret.txt").ok).toBe(false)
    expect(resolvePackagedRendererAssetPath(root, "/%2e%2e/secret").ok).toBe(false)
  })

  test("classifies loopback API paths including UI session auth", () => {
    expect(isLoopbackApiPath("/auth/session")).toBe(true)
    expect(isLoopbackApiPath("/api/fs/home")).toBe(true)
    expect(isLoopbackApiPath("/global/event")).toBe(true)
    expect(isLoopbackApiPath("/assets/index.js")).toBe(false)
  })

  test("reads the API origin from renderer additionalArguments", () => {
    expect(buildRendererApiOrigin(50959)).toBe("http://127.0.0.1:50959")
    expect(buildRendererApiOriginAdditionalArguments(50959)).toEqual([
      `${RENDERER_API_ORIGIN_ARG_PREFIX}http://127.0.0.1:50959`,
    ])
    expect(
      readRendererApiOriginFromArgv(["/preload.js", `${RENDERER_API_ORIGIN_ARG_PREFIX}http://127.0.0.1:50959`], {}),
    ).toBe("http://127.0.0.1:50959")
    expect(readRendererApiOriginFromArgv([], { AX_CODE_DESKTOP_RENDERER_API_ORIGIN: " http://127.0.0.1:1/ " })).toBe(
      "http://127.0.0.1:1",
    )
  })

  test("protocol handler serves original packaged HTML without injecting runtime", async () => {
    const original = '<html><head><meta charset="UTF-8" /></head></html>'
    const files = new Map([[path.resolve("/app/web-dist", "index.html"), original]])
    const handle = createPackagedRendererProtocolHandler({
      webDistPath: "/app/web-dist",
      getApiOrigin: () => "http://127.0.0.1:50959",
      readFile: async (filePath) => {
        const body = files.get(filePath)
        if (body === undefined) throw new Error("missing")
        return body
      },
    })
    const ok = await handle({ url: "app://ax-code/" })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe(original)
    expect(ok.headers.get("content-type")).toContain("text/html")
    expect(ok.headers.get("access-control-allow-origin")).toBeNull()
    const escaped = await handle({ url: "app://ax-code/%2e%2e/secret" })
    expect(escaped.status).toBeGreaterThanOrEqual(400)
  })

  test("protocol handler proxies UI session checks to the loopback server", async () => {
    const seen = []
    const handle = createPackagedRendererProtocolHandler({
      webDistPath: "/app/web-dist",
      getApiOrigin: () => "http://127.0.0.1:50959",
      readFile: async () => {
        throw new Error("missing")
      },
      fetchImpl: async (url, init) => {
        seen.push({ url, method: init.method, cookie: init.headers.get("cookie") })
        return new Response(JSON.stringify({ authenticated: true, disabled: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    const response = await handle({
      url: "app://ax-code/auth/session",
      method: "GET",
      headers: new Headers({ cookie: "oc_ui_session=abc", accept: "application/json" }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: true, disabled: true })
    expect(seen).toEqual([{ url: "http://127.0.0.1:50959/auth/session", method: "GET", cookie: "oc_ui_session=abc" }])
  })

  test("protocol handler does not proxy API paths to a non-loopback origin", async () => {
    const handle = createPackagedRendererProtocolHandler({
      webDistPath: "/app/web-dist",
      getApiOrigin: () => "http://example.com",
      readFile: async () => {
        throw new Error("missing")
      },
      fetchImpl: async () => {
        throw new Error("should not fetch")
      },
    })
    const response = await handle({ url: "app://ax-code/auth/session", method: "GET", headers: new Headers() })
    expect(response.status).toBe(503)
  })
})

describe("packaged renderer protocol runtime routing (S2.4a)", () => {
  const createRoutedHandler = ({ runtimeUpstream, fetchImpl, ...rest } = {}) =>
    createPackagedRendererProtocolHandler({
      webDistPath: "/app/web-dist",
      getApiOrigin: () => "http://127.0.0.1:50959",
      getRuntimeUpstream: () => runtimeUpstream,
      readFile: async () => {
        throw new Error("missing")
      },
      fetchImpl,
      ...rest,
    })

  test("runtime-target paths go to the runtime origin with ^/api stripped and auth injected", async () => {
    const seen = []
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "http://127.0.0.1:46001", authorization: "Basic injected-by-main" },
      fetchImpl: async (url, init) => {
        seen.push({
          url,
          method: init.method,
          authorization: init.headers.get("authorization"),
          origin: init.headers.get("origin"),
          acceptEncoding: init.headers.get("accept-encoding"),
        })
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
      },
    })
    const response = await handle({
      url: "app://ax-code/api/session?directory=%2Ftmp",
      method: "GET",
      headers: new Headers({
        authorization: "Basic renderer-must-not-win",
        origin: "app://ax-code",
        cookie: "oc_ui_session=abc",
      }),
    })
    expect(response.status).toBe(200)
    expect(seen).toEqual([
      {
        url: "http://127.0.0.1:46001/session?directory=%2Ftmp",
        method: "GET",
        authorization: "Basic injected-by-main",
        origin: null,
        acceptEncoding: "identity",
      },
    ])
  })

  test("web-target paths keep the existing web-server hop unchanged", async () => {
    const seen = []
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "http://127.0.0.1:46001", authorization: "Basic injected-by-main" },
      fetchImpl: async (url, init) => {
        seen.push({ url, authorization: init.headers.get("authorization") })
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
      },
    })
    // Desktop override under a runtime-shaped prefix.
    const override = await handle({
      url: "app://ax-code/api/session/abc/prompt_async",
      method: "POST",
      headers: new Headers(),
    })
    expect(override.status).toBe(200)
    // Plain desktop prefix.
    const desktop = await handle({ url: "app://ax-code/api/git/status", method: "GET", headers: new Headers() })
    expect(desktop.status).toBe(200)
    expect(seen).toEqual([
      { url: "http://127.0.0.1:50959/api/session/abc/prompt_async", authorization: null },
      { url: "http://127.0.0.1:50959/api/git/status", authorization: null },
    ])
  })

  test("runtime origin unknown returns 503 with restarting JSON", async () => {
    const handle = createRoutedHandler({
      runtimeUpstream: null,
      fetchImpl: async () => {
        throw new Error("should not fetch")
      },
    })
    const response = await handle({ url: "app://ax-code/api/session", method: "GET", headers: new Headers() })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "ax-code is restarting", restarting: true })
  })

  test("runtime origin unknown after exhausted bootstrap retries returns restarting:false", async () => {
    // Mirrors the web proxy readiness gate: once the lifecycle's bootstrap
    // retry budget is spent, the 503 flips to {restarting:false} so the
    // renderer switches from the "restarting" loader to the failure UI.
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: null, authorization: "", exhausted: true },
      fetchImpl: async () => {
        throw new Error("should not fetch")
      },
    })
    const response = await handle({ url: "app://ax-code/api/session", method: "GET", headers: new Headers() })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "ax-code failed to start", restarting: false })
  })

  test("runtime origin without a credential fails closed (no forward)", async () => {
    // Unreachable via main.js (main always builds the Basic header when an
    // origin exists), but the handler itself must never forward to the
    // runtime without the injected credential.
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "http://127.0.0.1:46001", authorization: "" },
      fetchImpl: async () => {
        throw new Error("should not fetch")
      },
    })
    const response = await handle({ url: "app://ax-code/api/session", method: "GET", headers: new Headers() })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "ax-code is restarting", restarting: true })
  })

  test("runtime fetch failure returns 503 with restarting JSON (not 502)", async () => {
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "http://127.0.0.1:46001", authorization: "Basic injected-by-main" },
      fetchImpl: async () => {
        throw new Error("connection refused")
      },
    })
    const response = await handle({ url: "app://ax-code/api/session", method: "GET", headers: new Headers() })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "ax-code is restarting", restarting: true })
  })

  test("runtime responses stream through unbuffered (SSE pass-through)", async () => {
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"))
      },
    })
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "http://127.0.0.1:46001", authorization: "Basic injected-by-main" },
      fetchImpl: async () =>
        new Response(upstreamBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    })
    const response = await handle({ url: "app://ax-code/api/event", method: "GET", headers: new Headers() })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    // The exact upstream stream object is returned — no buffering or re-chunking.
    expect(response.body).toBe(upstreamBody)
  })

  test("bare runtime prefixes (no /api) route to the runtime verbatim", async () => {
    const seen = []
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "http://127.0.0.1:46001", authorization: "Basic injected-by-main" },
      fetchImpl: async (url) => {
        seen.push(url)
        return new Response("{}", { status: 200 })
      },
    })
    const response = await handle({ url: "app://ax-code/global/event", method: "GET", headers: new Headers() })
    expect(response.status).toBe(200)
    expect(seen).toEqual(["http://127.0.0.1:46001/global/event"])
  })

  test("non-loopback runtime origins fall back to the web-server hop", async () => {
    // Explicit remote-runtime configs worked pre-S2.4 via the web proxy; the
    // direct path must not 503 them (main never sends the credential
    // off-loopback). The web hop forwards verbatim — no ^/api rewrite.
    const seen = []
    const handle = createRoutedHandler({
      runtimeUpstream: { origin: "https://runtime.example.com", authorization: "Basic injected-by-main" },
      fetchImpl: async (url, init) => {
        seen.push({ url, authorization: init.headers.get("authorization") })
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
      },
    })
    const response = await handle({ url: "app://ax-code/api/session", method: "GET", headers: new Headers() })
    expect(response.status).toBe(200)
    expect(seen).toEqual([{ url: "http://127.0.0.1:50959/api/session", authorization: null }])
  })
})
