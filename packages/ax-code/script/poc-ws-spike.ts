/**
 * S1 spike harness: prove the runtime-adapter serves HTTP + WebSocket on the
 * current runtime. Run under BOTH:
 *   node --import tsx script/poc-ws-spike.ts      (Node path: @hono/node-server + @hono/node-ws)
 *   bun  script/poc-ws-spike.ts                   (Bun path:  Bun.serve + hono/bun)
 *
 * Exercises the demanding case from routes/pty.ts: a ws route that reads
 * `ws.raw` (readyState/send/close) and echoes frames, plus the EADDRINUSE
 * port-fallback contract (serve() must reject on bind failure on both runtimes).
 */
import { Hono } from "hono"

async function installCompatIfNode() {
  // On Node, install the same Bun shim the real entrypoint uses so app code
  // and the adapter's capability check behave like production.
  if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
    const { installNodeBunCompat } = await import("../src/bun/node-compat")
    installNodeBunCompat()
  }
}

async function wsClient(url: string) {
  // Use the global WebSocket on Bun; the `ws` package on Node.
  const G = globalThis as { WebSocket?: any; Bun?: { serve?: unknown } }
  if (typeof G.WebSocket === "function" && typeof G.Bun?.serve === "function") return new G.WebSocket(url)
  const { WebSocket } = await import("ws")
  return new WebSocket(url) as unknown as WebSocket
}

function ok(name: string) {
  console.log(`  ✅ ${name}`)
}
function fail(name: string, err?: unknown): never {
  console.error(`  ❌ ${name}${err ? " failed with an error" : ""}`)
  process.exit(1)
}

async function main() {
  await installCompatIfNode()
  const runtime = typeof (globalThis as { Bun?: { serve?: unknown } }).Bun?.serve === "function" ? "Bun" : "Node"
  console.log(`\n=== S1 ws-adapter spike on ${runtime} ===`)

  const { serve, upgradeWebSocket } = await import("../src/server/runtime-adapter")

  // App with a ws echo route that mirrors pty.ts's ws.raw usage.
  const app = new Hono().get(
    "/echo",
    upgradeWebSocket(() => ({
      onOpen(_evt: unknown, ws: any) {
        const raw = ws.raw
        if (!raw || typeof raw.send !== "function" || typeof raw.readyState !== "number") {
          // Proves ws.raw exposes the Bun-ServerWebSocket-compatible shape on both runtimes.
          ws.close()
        }
      },
      onMessage(evt: any, ws: any) {
        ws.send(`echo:${evt.data}`)
      },
    })),
  )

  // 1) bind on an ephemeral port
  const server = await serve({ app, hostname: "127.0.0.1", port: 0, idleTimeout: 0 })
  ok(`bound on ephemeral port ${server.port}`)

  // 2) ws round-trip
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("round-trip timed out")), 5000)
    wsClient(`ws://127.0.0.1:${server.port}/echo`).then((ws: any) => {
      ws.addEventListener?.("open", () => ws.send("ping"))
      ws.on?.("open", () => ws.send("ping"))
      const onMsg = (data: unknown) => {
        const text = typeof data === "string" ? data : String((data as { data?: unknown })?.data ?? data)
        clearTimeout(timer)
        if (text === "echo:ping") {
          ws.close?.()
          resolve()
        } else reject(new Error(`unexpected frame: ${text}`))
      }
      ws.addEventListener?.("message", (e: any) => onMsg(e.data))
      ws.on?.("message", (d: any) => onMsg(d.toString()))
      ws.on?.("error", reject)
    }, reject)
  })
    .then(() => ok("websocket round-trip (echo:ping)"))
    .catch((e) => fail("websocket round-trip", e))

  // 2b) HTTP-only `fetch` serve (oauth-callback / control-plane pattern: no app, no ws)
  const httpOnly = await serve({
    fetch: (req: Request) => new Response(`pong:${new URL(req.url).pathname}`),
    hostname: "127.0.0.1",
    port: 0,
  })
  const res = await fetch(`http://127.0.0.1:${httpOnly.port}/cb`)
  const body = await res.text()
  if (body === "pong:/cb") ok("HTTP-only fetch serve (no Hono app)")
  else fail(`HTTP-only fetch serve returned ${body}`)
  await httpOnly.stop()

  // 3) EADDRINUSE: a second bind on the SAME port must reject (port-fallback contract)
  const fixed = await serve({ app, hostname: "127.0.0.1", port: 0 })
  let rejected = false
  try {
    await serve({ app, hostname: "127.0.0.1", port: fixed.port })
  } catch {
    rejected = true
  }
  if (rejected) ok(`serve() rejects on EADDRINUSE (port ${fixed.port})`)
  else fail("serve() did NOT reject on port conflict")

  // 4) clean stop
  await server.stop(true)
  await fixed.stop(true)
  ok("servers stopped")

  console.log(`\n=== ${runtime}: ALL PASS ===\n`)
  process.exit(0)
}

main().catch((e) => fail("spike crashed", e))
