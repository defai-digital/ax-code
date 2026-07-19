/**
 * Runtime-agnostic HTTP + WebSocket server adapter (ADR-036 / S1 spike).
 *
 * Bun serves via `Bun.serve({ fetch, websocket })` with `hono/bun`'s
 * websocket helpers. Node has no drop-in equivalent: it uses
 * `@hono/node-server` for HTTP and `@hono/node-ws` for websockets, where the
 * upgrade helper is created from the app (`createNodeWebSocket({ app })`) and
 * attached after the server binds (`injectWebSocket(server)`).
 *
 * The friction this module resolves: ws routes (e.g. `routes/pty.ts`) import a
 * standalone `upgradeWebSocket` at module-load time, before any Node helper
 * exists. We expose a forwarder whose returned middleware resolves the active
 * implementation at REQUEST time, so routes can register first and the Node
 * helper can be wired in when the server actually starts.
 *
 * Node upgrade implementations are keyed by the HTTP server that owns the
 * incoming socket, so concurrent servers cannot route upgrades through one
 * another's WebSocketServer. Bun is unaffected (its helper is static).
 */
import type { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"

export interface ServerHandle {
  port: number
  hostname: string
  url: URL
  stop(closeActiveConnections?: boolean): Promise<void>
}

type FetchHandler = (req: Request) => Response | Promise<Response>

export interface ServeOptions {
  /** Hono app — required for websocket support (its `fetch` is used for HTTP). */
  app?: Hono
  /** Raw fetch handler for HTTP-only servers that don't use a Hono app. */
  fetch?: FetchHandler
  hostname: string
  port: number
  idleTimeout?: number
}

function resolveFetch(opts: ServeOptions): FetchHandler {
  const handler = opts.fetch ?? (opts.app?.fetch as FetchHandler | undefined)
  if (!handler) throw new Error("serve() requires either `app` or `fetch`")
  return handler
}

function isNodeRuntime(): boolean {
  // Capability check: real Bun exposes Bun.serve; the Node compat shim
  // (node-compat.ts) defines globalThis.Bun WITHOUT serve. More robust than
  // runtimeMode() alone, which depends on the build-time version define
  // (undefined when running from raw source on Node, e.g. the S1 spike).
  const bunServe = (globalThis as { Bun?: { serve?: unknown } }).Bun?.serve
  return typeof bunServe !== "function"
}

// --- upgradeWebSocket forwarder -------------------------------------------

// Bun's helper is static and safe to resolve lazily on first use. Node exposes
// the owning http.Server through c.env.incoming.socket.server.
const nodeUpgrades = new WeakMap<object, UpgradeWebSocket<any, any>>()

function resolveBunUpgrade(): UpgradeWebSocket<any, any> {
  // hono/bun is only importable under Bun; require lazily so Node never loads it.
  const { upgradeWebSocket } = require("hono/bun") as typeof import("hono/bun")
  return upgradeWebSocket as unknown as UpgradeWebSocket<any, any>
}

/**
 * Drop-in replacement for `hono/bun`'s `upgradeWebSocket`. Returns a Hono
 * middleware that delegates to the runtime's real upgrade helper at request
 * time, so the binding order (routes register before the server starts) works
 * on both runtimes.
 */
export const upgradeWebSocket: UpgradeWebSocket<any, any> = ((createEvents: any, options?: any) => {
  return async (c: any, next: any) => {
    const owner = c.env?.incoming?.socket?.server
    let impl = owner && typeof owner === "object" ? nodeUpgrades.get(owner) : undefined
    if (!impl && !isNodeRuntime()) impl = resolveBunUpgrade()
    if (!impl) return next() // no ws support on this path
    return impl(createEvents, options)(c, next)
  }
}) as unknown as UpgradeWebSocket<any, any>

// --- serve -----------------------------------------------------------------

async function serveBun(opts: ServeOptions): Promise<ServerHandle> {
  const { hostname, port, idleTimeout } = opts
  const { websocket } = require("hono/bun") as typeof import("hono/bun")
  const server = Bun.serve({
    hostname,
    port,
    idleTimeout: idleTimeout ?? 0,
    fetch: resolveFetch(opts),
    websocket,
  })
  const boundPort = server.port ?? port
  return {
    port: boundPort,
    hostname,
    url: new URL(`http://${hostname}:${boundPort}`),
    stop: async (closeActiveConnections?: boolean) => {
      await server.stop(closeActiveConnections)
    },
  }
}

async function serveNode(opts: ServeOptions): Promise<ServerHandle> {
  const { hostname, port } = opts
  const { serve } = await import("@hono/node-server")

  // Websockets need the Hono app (createNodeWebSocket binds to it). HTTP-only
  // callers pass just `fetch` and skip the ws wiring entirely.
  let nodeWs: Awaited<ReturnType<(typeof import("@hono/node-ws"))["createNodeWebSocket"]>> | undefined
  if (opts.app) {
    const { createNodeWebSocket } = await import("@hono/node-ws")
    nodeWs = createNodeWebSocket({ app: opts.app as any })
  }

  return await new Promise<ServerHandle>((resolve, reject) => {
    const httpServer = serve({ fetch: resolveFetch(opts), hostname, port }, (info) => {
      httpServer.removeListener("error", onError)
      resolve({
        port: info.port,
        hostname,
        url: new URL(`http://${hostname}:${info.port}`),
        stop: (_closeActiveConnections?: boolean) =>
          new Promise<void>((res) => {
            for (const client of nodeWs?.wss.clients ?? []) {
              try {
                client.close()
              } catch {}
            }
            httpServer.close(() => res())
          }),
      })
    })
    // Node binds asynchronously; EADDRINUSE arrives as an 'error' event, not a
    // synchronous throw like Bun.serve. Surface it as a rejection so the
    // caller's port-fallback logic behaves the same on both runtimes.
    const onError = (err: unknown) => {
      httpServer.removeListener("error", onError)
      reject(err)
    }
    httpServer.on("error", onError)
    if (nodeWs) {
      nodeUpgrades.set(httpServer, nodeWs.upgradeWebSocket as unknown as UpgradeWebSocket<any, any>)
    }
    nodeWs?.injectWebSocket(httpServer)
  })
}

/**
 * Start an HTTP(+WS) server for the current runtime. Rejects on bind failure
 * (e.g. EADDRINUSE) on both Bun and Node so callers can implement uniform
 * port-fallback.
 */
export function serve(opts: ServeOptions): Promise<ServerHandle> {
  return isNodeRuntime() ? serveNode(opts) : serveBun(opts)
}
