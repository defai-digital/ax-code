import http from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import z from "zod"
import { callTuiMcpEndpoint, readTuiMcpEndpoint } from "./endpoint"
import { parseTuiToolCall, tuiMcpTools } from "./mcp-server"
import { MAX_FRAME_BYTES, reject } from "./protocol"
import { parseJsonStrict } from "@/util/json-value"
import { tuiInspectorPage } from "./inspector-page"

/** One explicit target, one loopback listener. No endpoint token reaches the browser. */
export async function startTuiInspector(filename: string, port = 0) {
  if (!(await readTuiMcpEndpoint(filename)).debug) throw new Error("Start the target TUI with --tui-debug")
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid inspector port")
  const capability = randomBytes(32).toString("hex")
  const nonce = randomBytes(24).toString("base64")
  const tools = tuiMcpTools(true)
  const page = tuiInspectorPage(capability, nonce, tools)
  let origin = ""
  const pending = new Set<AbortController>()
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    )
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }
    // Exact host and origin prevent DNS rebinding and cross-origin browser calls.
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin !== undefined && req.headers.origin !== origin) ||
      (req.headers["sec-fetch-site"] !== undefined &&
        !["none", "same-origin"].includes(String(req.headers["sec-fetch-site"])))
    ) {
      send(403, reject("unauthorized"))
      return
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(page)
      return
    }
    if (req.method !== "POST" || req.url !== "/rpc") {
      send(404, reject("invalid_request"))
      return
    }
    const token = req.headers["x-ax-tui-debug"]
    if (
      req.headers.origin !== origin ||
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(capability)) ||
      req.headers["content-type"] !== "application/json"
    ) {
      send(403, reject("unauthorized"))
      return
    }
    if (pending.size >= 16) {
      send(429, reject("busy"))
      return
    }
    const abort = new AbortController()
    pending.add(abort)
    const deadline = setTimeout(() => {
      abort.abort()
      req.destroy()
    }, 5000)
    res.once("close", () => {
      clearTimeout(deadline)
      pending.delete(abort)
      abort.abort()
    })
    let buffer = Buffer.alloc(0)
    req.on("error", () => abort.abort())
    req.on("data", (chunk: Buffer) => {
      if (abort.signal.aborted) return
      if (buffer.length + chunk.length > MAX_FRAME_BYTES) {
        buffer = Buffer.alloc(0)
        abort.abort()
        send(413, reject("invalid_request"))
        req.destroy()
        return
      }
      buffer = Buffer.concat([buffer, chunk])
    })
    req.on("end", () => {
      if (abort.signal.aborted) return
      let body: unknown
      try {
        body = parseJsonStrict(buffer.toString("utf8"))
      } catch {
        send(400, reject("invalid_request"))
        return
      }
      const parsed = z.object({ name: z.string(), args: z.unknown() }).strict().safeParse(body)
      const request = parsed.success ? parseTuiToolCall(parsed.data.name, parsed.data.args) : undefined
      if (!request) {
        send(400, reject("invalid_request"))
        return
      }
      void callTuiMcpEndpoint(filename, request, { signal: abort.signal }).then(
        (result) => {
          if (!res.destroyed) send(200, result)
        },
        () => {
          if (!res.destroyed) send(200, reject("target_unavailable"))
        },
      )
    })
  })
  server.maxConnections = 16
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Inspector listener unavailable")
  origin = `http://127.0.0.1:${address.port}`
  return {
    url: origin + "/",
    async close() {
      for (const abort of pending) abort.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}
