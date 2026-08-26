import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  PACKAGED_RENDERER_ORIGIN,
  isPackagedRendererUrl,
  isPackagedRendererOrigin,
  isTrustedRendererNavigationUrl,
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
    expect(isPackagedRendererUrl("app://evil/")).toBe(false)
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

  test("protocol handler serves packaged assets and rejects escapes", async () => {
    const files = new Map([[path.resolve("/app/web-dist", "index.html"), "<html>ok</html>"]])
    const handle = createPackagedRendererProtocolHandler({
      webDistPath: "/app/web-dist",
      readFile: async (filePath) => {
        const body = files.get(filePath)
        if (body === undefined) throw new Error("missing")
        return body
      },
    })
    const ok = await handle({ url: "app://ax-code/" })
    expect(ok.status).toBe(200)
    const escaped = await handle({ url: "app://ax-code/%2e%2e/secret" })
    expect(escaped.status).toBeGreaterThanOrEqual(400)
  })
})
