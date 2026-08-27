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
  injectPackagedRendererServerRuntime,
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

  test("injects the loopback server origin into packaged HTML", () => {
    const html = injectPackagedRendererServerRuntime("<html><head></head></html>", "http://127.0.0.1:50959")
    expect(html).toContain('window.__AX_CODE_DESKTOP_DESKTOP_SERVER__={origin:"http://127.0.0.1:50959"')
  })

  test("protocol handler serves packaged assets and rejects escapes", async () => {
    const files = new Map([[path.resolve("/app/web-dist", "index.html"), "<html><head></head></html>"]])
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
    expect(await ok.text()).toContain('origin:"http://127.0.0.1:50959"')
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
