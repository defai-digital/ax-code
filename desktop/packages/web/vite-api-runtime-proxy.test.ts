// S2.4b: keeps the Vite dev proxy classification in sync with the packaged
// app:// router (desktop/packages/electron/src/api-prefix-router.js) and
// covers the dev upstream file parsing/fallback semantics.

import fs from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import {
  classifyDesktopDevApiPath,
  createDesktopApiRuntimeProxyPlugin,
  createDevRuntimeUpstreamReader,
  parseDevRuntimeUpstream,
  shouldHandleDesktopDevApiPath,
} from "./vite-api-runtime-proxy"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const electronRouter = createRequire(import.meta.url)("../electron/src/api-prefix-router.js") as {
  routeApiRequest: (pathname: string, method?: string) => { target: string; upstreamPath: string }
}

const tmpDirs: string[] = []
const servers: http.Server[] = []
const originalDesktopPort = process.env.AX_CODE_DESKTOP_PORT

const makeTmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-runtime-proxy-test-"))
  tmpDirs.push(dir)
  return dir
}

const listen = (server: http.Server) =>
  new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind test server"))
        return
      }
      resolve(address.port)
    })
    server.on("error", reject)
  })

const trackServer = (server: http.Server) => {
  servers.push(server)
  return server
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    if (!server) continue
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (!dir) continue
    fs.rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalDesktopPort === "string") {
    process.env.AX_CODE_DESKTOP_PORT = originalDesktopPort
  } else {
    delete process.env.AX_CODE_DESKTOP_PORT
  }
})

describe("classifyDesktopDevApiPath parity with the packaged router", () => {
  // One sample per routing category in api-prefix-router.js.
  const samples: Array<[string, string]> = [
    // Desktop overrides under runtime-shaped prefixes.
    ["POST", "/api/session/sess_1/prompt_async"],
    ["POST", "/api/session/sess_1/command"],
    ["GET", "/api/provider/anthropic/source"],
    ["DELETE", "/api/provider/anthropic/auth"],
    ["GET", "/api/mcp/auth/pending"],
    ["GET", "/api/config/settings"],
    ["GET", "/api/config/agents"],
    ["POST", "/api/config/reload"],
    // Desktop-owned prefixes.
    ["GET", "/api/fs/list"],
    ["GET", "/api/git/status"],
    ["GET", "/api/sessions"],
    ["GET", "/api/terminal/list"],
    ["GET", "/api/health"],
    ["GET", "/health"],
    ["GET", "/auth/session"],
    // Method-scoped runtime entry (PUT /api/auth/:providerID only).
    ["PUT", "/api/auth/openai"],
    ["GET", "/api/auth/openai"],
    ["POST", "/api/auth/reset"],
    // Runtime prefixes.
    ["GET", "/api/config"],
    ["GET", "/api/config/providers"],
    ["GET", "/api/session"],
    ["POST", "/api/session/sess_1/message"],
    ["GET", "/api/event"],
    ["GET", "/api/provider"],
    ["GET", "/api/find/file"],
    ["GET", "/api/pty"],
    ["GET", "/api/agent"],
    ["GET", "/api/global/health"],
    ["GET", "/global/health"],
    ["GET", "/global/event"],
    // Dashboard surfaces — runtime direct, no /api strip.
    ["GET", "/graph"],
    ["GET", "/dre-graph"],
    ["GET", "/dre-graph/assets/index.js"],
    // Unclassified paths keep the safe web default.
    ["GET", "/api/unknown-future-endpoint"],
  ]

  for (const [method, pathname] of samples) {
    it(`${method} ${pathname} routes identically to routeApiRequest`, () => {
      expect(classifyDesktopDevApiPath(pathname, method)).toEqual(electronRouter.routeApiRequest(pathname, method))
    })
  }

  it("degrades to the web target when the pathname is unusable", () => {
    expect(classifyDesktopDevApiPath("", "GET").target).toBe("web")
  })
})

describe("shouldHandleDesktopDevApiPath", () => {
  it("owns only the prefixes the packaged router classifies", () => {
    expect(shouldHandleDesktopDevApiPath("/api")).toBe(true)
    expect(shouldHandleDesktopDevApiPath("/api/event")).toBe(true)
    expect(shouldHandleDesktopDevApiPath("/global/health")).toBe(true)
    expect(shouldHandleDesktopDevApiPath("/graph")).toBe(true)
    expect(shouldHandleDesktopDevApiPath("/dre-graph")).toBe(true)
    // /auth and /health stay on vite's static web-proxy entries.
    expect(shouldHandleDesktopDevApiPath("/auth/session")).toBe(false)
    expect(shouldHandleDesktopDevApiPath("/health")).toBe(false)
    // Vite internals, SPA routes, and prefix lookalikes stay untouched.
    expect(shouldHandleDesktopDevApiPath("/@vite/client")).toBe(false)
    expect(shouldHandleDesktopDevApiPath("/src/main.tsx")).toBe(false)
    expect(shouldHandleDesktopDevApiPath("/graphics")).toBe(false)
    expect(shouldHandleDesktopDevApiPath("/apricot")).toBe(false)
    expect(shouldHandleDesktopDevApiPath("/")).toBe(false)
  })
})

describe("parseDevRuntimeUpstream", () => {
  const validPayload = JSON.stringify({
    version: 1,
    origin: "http://127.0.0.1:4096",
    authorization: "Basic dGVzdA==",
    updatedAt: "2026-08-29T00:00:00.000Z",
  })

  it("accepts a well-formed payload", () => {
    expect(parseDevRuntimeUpstream(validPayload)).toEqual({
      origin: "http://127.0.0.1:4096",
      authorization: "Basic dGVzdA==",
      updatedAt: "2026-08-29T00:00:00.000Z",
    })
  })

  it("rejects garbage and shape mismatches", () => {
    expect(parseDevRuntimeUpstream("")).toBeNull()
    expect(parseDevRuntimeUpstream("not json")).toBeNull()
    expect(parseDevRuntimeUpstream("{")).toBeNull()
    expect(parseDevRuntimeUpstream("null")).toBeNull()
    expect(parseDevRuntimeUpstream("[]")).toBeNull()
    expect(parseDevRuntimeUpstream('"http://127.0.0.1:4096"')).toBeNull()
    expect(parseDevRuntimeUpstream(JSON.stringify({ version: 2, origin: "http://127.0.0.1:4096" }))).toBeNull()
    expect(parseDevRuntimeUpstream(JSON.stringify({ version: 1 }))).toBeNull()
    expect(parseDevRuntimeUpstream(JSON.stringify({ version: 1, origin: 4096 }))).toBeNull()
  })

  it("rejects non-loopback and smuggled origins", () => {
    const withOrigin = (origin: string) => JSON.stringify({ version: 1, origin })
    expect(parseDevRuntimeUpstream(withOrigin("http://evil.example.com"))).toBeNull()
    expect(parseDevRuntimeUpstream(withOrigin("http://192.168.1.10:4096"))).toBeNull()
    expect(parseDevRuntimeUpstream(withOrigin("ftp://127.0.0.1:4096"))).toBeNull()
    expect(parseDevRuntimeUpstream(withOrigin("http://127.0.0.1:4096/admin"))).toBeNull()
    expect(parseDevRuntimeUpstream(withOrigin("http://127.0.0.1:4096/?x=1"))).toBeNull()
    expect(parseDevRuntimeUpstream(withOrigin("http://user:pass@127.0.0.1:4096"))).toBeNull()
    // Loopback spellings that ARE accepted.
    expect(parseDevRuntimeUpstream(withOrigin("http://localhost:4096"))?.origin).toBe("http://localhost:4096")
    expect(parseDevRuntimeUpstream(withOrigin("http://[::1]:4096"))?.origin).toBe("http://[::1]:4096")
  })

  it("drops malformed authorization values", () => {
    const payload = JSON.stringify({ version: 1, origin: "http://127.0.0.1:4096", authorization: "Bearer abc" })
    expect(parseDevRuntimeUpstream(payload)).toEqual({ origin: "http://127.0.0.1:4096" })
  })
})

describe("createDevRuntimeUpstreamReader", () => {
  it("reads null when the file is missing and caches within the TTL", () => {
    const filePath = path.join(makeTmpDir(), "upstream.json")
    let now = 1000
    const reader = createDevRuntimeUpstreamReader({ filePath, cacheMs: 250, now: () => now })

    expect(reader.read()).toBeNull()

    fs.writeFileSync(filePath, JSON.stringify({ version: 1, origin: "http://127.0.0.1:4096" }), { mode: 0o600 })
    // Still within the TTL — the cached null is served.
    now += 100
    expect(reader.read()).toBeNull()
    // Past the TTL — the file is re-read.
    now += 200
    expect(reader.read()?.origin).toBe("http://127.0.0.1:4096")
  })

  it("invalidate() forces an immediate re-read", () => {
    const filePath = path.join(makeTmpDir(), "upstream.json")
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, origin: "http://127.0.0.1:4096" }), { mode: 0o600 })
    const reader = createDevRuntimeUpstreamReader({ filePath, cacheMs: 60_000 })

    expect(reader.read()?.origin).toBe("http://127.0.0.1:4096")

    fs.writeFileSync(filePath, JSON.stringify({ version: 1, origin: "http://127.0.0.1:51234" }), { mode: 0o600 })
    expect(reader.read()?.origin).toBe("http://127.0.0.1:4096")

    reader.invalidate()
    expect(reader.read()?.origin).toBe("http://127.0.0.1:51234")
  })

  it("treats an unparseable file as missing", () => {
    const filePath = path.join(makeTmpDir(), "upstream.json")
    fs.writeFileSync(filePath, "garbage{{{", { mode: 0o600 })
    const reader = createDevRuntimeUpstreamReader({ filePath })
    expect(reader.read()).toBeNull()
  })

  it("is null without a configured file path", () => {
    expect(createDevRuntimeUpstreamReader({ filePath: null }).read()).toBeNull()
  })
})

interface RecordedRequest {
  method?: string
  url?: string
  headers: http.IncomingHttpHeaders
}

const startRecordingServer = async (
  responder: (req: http.IncomingMessage, res: http.ServerResponse, recorded: RecordedRequest[]) => void,
) => {
  const recorded: RecordedRequest[] = []
  const server = trackServer(
    http.createServer((req, res) => {
      recorded.push({ method: req.method, url: req.url, headers: { ...req.headers } })
      responder(req, res, recorded)
    }),
  )
  const port = await listen(server)
  return { port, recorded }
}

// Mounts the plugin's middleware on a bare http server via a fake Vite server.
const startProxyServer = async (upstreamFilePath: string, webPort: number) => {
  process.env.AX_CODE_DESKTOP_PORT = String(webPort)
  const plugin = createDesktopApiRuntimeProxyPlugin({ upstreamFilePath })
  let handler: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | null = null
  const fakeViteServer = {
    middlewares: {
      use: (fn: typeof handler) => {
        handler = fn
      },
    },
  }
  ;(plugin.configureServer as (server: unknown) => void)(fakeViteServer)
  if (!handler) throw new Error("plugin did not register a middleware")
  const middleware = handler
  const server = trackServer(
    http.createServer((req, res) => {
      middleware(req, res, () => {
        res.statusCode = 404
        res.end("spa-fallback")
      })
    }),
  )
  const port = await listen(server)
  return { port }
}

const getJson = async (port: number, requestPath: string, headers: Record<string, string> = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, { headers })
  const text = await response.text()
  return { status: response.status, text, headers: response.headers }
}

describe("desktop API runtime proxy middleware", () => {
  it("forwards runtime-shaped paths directly to the runtime with rewrite, auth, and no Origin", async () => {
    const runtime = await startRecordingServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, url: req.url }))
    })
    const web = await startRecordingServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ via: "web" }))
    })

    const dir = makeTmpDir()
    const upstreamFile = path.join(dir, "upstream.json")
    fs.writeFileSync(
      upstreamFile,
      JSON.stringify({ version: 1, origin: `http://127.0.0.1:${runtime.port}`, authorization: "Basic c2VjcmV0" }),
      { mode: 0o600 },
    )

    const proxy = await startProxyServer(upstreamFile, web.port)
    const result = await getJson(proxy.port, "/api/session/sess_1/message?verbose=1", {
      Origin: "http://127.0.0.1:5173",
      "Accept-Encoding": "gzip",
    })

    expect(result.status).toBe(200)
    expect(JSON.parse(result.text)).toEqual({ ok: true, url: "/session/sess_1/message?verbose=1" })
    expect(web.recorded).toHaveLength(0)

    const forwarded = runtime.recorded[0]
    expect(forwarded.headers.authorization).toBe("Basic c2VjcmV0")
    expect(forwarded.headers.origin).toBeUndefined()
    expect(forwarded.headers["accept-encoding"]).toBe("identity")
    expect(forwarded.headers.host).toBe(`127.0.0.1:${runtime.port}`)
  })

  it("never forwards the renderer's own Authorization to the runtime (injected credential wins)", async () => {
    const runtime = await startRecordingServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    const web = await startRecordingServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })

    const dir = makeTmpDir()
    const upstreamFile = path.join(dir, "upstream.json")
    fs.writeFileSync(
      upstreamFile,
      JSON.stringify({ version: 1, origin: `http://127.0.0.1:${runtime.port}`, authorization: "Basic c2VjcmV0" }),
      { mode: 0o600 },
    )

    const proxy = await startProxyServer(upstreamFile, web.port)
    const result = await getJson(proxy.port, "/api/session", { Authorization: "Basic evil" })

    expect(result.status).toBe(200)
    expect(runtime.recorded).toHaveLength(1)
    // Node collapses duplicate case-variant Authorization keys into one
    // comma-joined header, so an exact equality assertion proves the
    // renderer's header was dropped, not just shadowed.
    expect(runtime.recorded[0].headers.authorization).toBe("Basic c2VjcmV0")
  })

  it("strips the renderer's Authorization even when no runtime credential is configured", async () => {
    const runtime = await startRecordingServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    const web = await startRecordingServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })

    const dir = makeTmpDir()
    const upstreamFile = path.join(dir, "upstream.json")
    fs.writeFileSync(upstreamFile, JSON.stringify({ version: 1, origin: `http://127.0.0.1:${runtime.port}` }), {
      mode: 0o600,
    })

    const proxy = await startProxyServer(upstreamFile, web.port)
    const result = await getJson(proxy.port, "/api/session", { Authorization: "Basic evil" })

    expect(result.status).toBe(200)
    expect(runtime.recorded).toHaveLength(1)
    expect(runtime.recorded[0].headers.authorization).toBeUndefined()
  })

  it("streams runtime SSE responses through unbuffered", async () => {
    const runtime = await startRecordingServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" })
      res.write("data: one\n\n")
      setTimeout(() => {
        res.write("data: two\n\n")
        res.end()
      }, 50)
    })
    const web = await startRecordingServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })

    const dir = makeTmpDir()
    const upstreamFile = path.join(dir, "upstream.json")
    fs.writeFileSync(upstreamFile, JSON.stringify({ version: 1, origin: `http://127.0.0.1:${runtime.port}` }), {
      mode: 0o600,
    })

    const proxy = await startProxyServer(upstreamFile, web.port)
    const response = await fetch(`http://127.0.0.1:${proxy.port}/api/event`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")

    // Read the stream incrementally: the first event must arrive before the
    // response completes (i.e. the proxy did not buffer the whole body).
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ""
    const first = await reader.read()
    received += decoder.decode(first.value, { stream: true })
    expect(first.done).toBe(false)
    expect(received).toContain("data: one")
    let chunk = await reader.read()
    while (!chunk.done) {
      received += decoder.decode(chunk.value, { stream: true })
      chunk = await reader.read()
    }
    expect(received).toContain("data: two")
    await reader.cancel()
  })

  it("forwards web-classified paths verbatim to the web server", async () => {
    const runtime = await startRecordingServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const web = await startRecordingServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ via: "web", url: req.url }))
    })

    const dir = makeTmpDir()
    const upstreamFile = path.join(dir, "upstream.json")
    fs.writeFileSync(
      upstreamFile,
      JSON.stringify({ version: 1, origin: `http://127.0.0.1:${runtime.port}`, authorization: "Basic c2VjcmV0" }),
      { mode: 0o600 },
    )

    const proxy = await startProxyServer(upstreamFile, web.port)
    const result = await getJson(proxy.port, "/api/fs/list?path=%2Ftmp")

    expect(result.status).toBe(200)
    expect(JSON.parse(result.text)).toEqual({ via: "web", url: "/api/fs/list?path=%2Ftmp" })
    expect(runtime.recorded).toHaveLength(0)
    // The web hop never receives the runtime credential.
    expect(web.recorded[0].headers.authorization).toBeUndefined()
  })

  it("falls back to the web server when no upstream file exists", async () => {
    const web = await startRecordingServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ via: "web", url: req.url }))
    })

    const dir = makeTmpDir()
    const proxy = await startProxyServer(path.join(dir, "missing.json"), web.port)
    const result = await getJson(proxy.port, "/api/session")

    expect(result.status).toBe(200)
    expect(JSON.parse(result.text)).toEqual({ via: "web", url: "/api/session" })
  })

  it("falls back to the web server when the upstream file points at a dead runtime", async () => {
    const web = await startRecordingServer((req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ restarting: true, url: req.url }))
    })

    // Allocate a port, then close it so nothing listens there.
    const deadServer = trackServer(http.createServer())
    const deadPort = await listen(deadServer)
    await new Promise<void>((resolve) => deadServer.close(() => resolve()))

    const dir = makeTmpDir()
    const upstreamFile = path.join(dir, "upstream.json")
    fs.writeFileSync(upstreamFile, JSON.stringify({ version: 1, origin: `http://127.0.0.1:${deadPort}` }), {
      mode: 0o600,
    })

    const proxy = await startProxyServer(upstreamFile, web.port)
    const result = await getJson(proxy.port, "/api/event")

    expect(result.status).toBe(503)
    expect(JSON.parse(result.text)).toEqual({ restarting: true, url: "/api/event" })
    expect(web.recorded).toHaveLength(1)
  })

  it("lets non-API paths fall through to the SPA pipeline", async () => {
    const web = await startRecordingServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const proxy = await startProxyServer(path.join(makeTmpDir(), "missing.json"), web.port)

    const result = await getJson(proxy.port, "/src/main.tsx")
    expect(result.status).toBe(404)
    expect(result.text).toBe("spa-fallback")
    expect(web.recorded).toHaveLength(0)
  })
})
