import { WikiMaintenanceSchema } from "./maintenance-schema"
import type { WikiMaintenanceStatus } from "./idle-controller"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import { constants } from "node:fs"
import { open, realpath, unlink } from "node:fs/promises"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { assertWikiDirectorySafe } from "@ax-code/ax-wiki/node"
import { graphRelativePath, projectWikiManifest, parseWikiGraph } from "@ax-code/ax-wiki/graph"
import { renderWikiGraphHtml } from "@ax-code/ax-wiki-viewer/node"
import { parseJsonStrict } from "../util/json-value"

export namespace WikiVisualization {
  export const Unavailable = NamedError.create(
    "WikiVisualizationUnavailable",
    z.object({
      message: z.string(),
      reason: z.enum(["missing", "too_large"]),
    }),
  )

  const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

  export async function snapshot(root: string, wikiDir = "ax-wiki") {
    graphRelativePath(wikiDir)
    const canonicalRoot = await realpath(root)
    await assertWikiDirectorySafe(canonicalRoot, wikiDir)
    // @scan-suppress security_scan - wikiDir is a relative graph path, and the manifest realpath must match this join.
    const manifestPath = path.join(canonicalRoot, wikiDir, ".manifest.json")
    const resolved = await realpath(manifestPath).catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        throw new Unavailable({
          reason: "missing",
          message: "No Wiki manifest found. Generate a Wiki explicitly before viewing it.",
        })
      throw error
    })
    if (resolved !== manifestPath) throw new Error("Wiki visualization refuses symlinked manifests")
    const handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let raw: string
    try {
      const before = await handle.stat()
      if (before.size > MAX_MANIFEST_BYTES)
        throw new Unavailable({ reason: "too_large", message: "Wiki manifest exceeds the 4 MiB limit." })
      if (!before.isFile()) throw new Error("Wiki manifest must be a regular file")
      const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1)
      let size = 0
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, null)
        if (!read.bytesRead) break
        size += read.bytesRead
      }
      const after = await handle.stat()
      if (
        size > MAX_MANIFEST_BYTES ||
        before.mtimeMs !== after.mtimeMs ||
        before.size !== after.size ||
        (await realpath(manifestPath)) !== resolved
      )
        throw new Error("Wiki manifest changed while reading; retry visualization")
      raw = buffer.subarray(0, size).toString("utf8")
    } finally {
      await handle.close()
    }
    const graph = projectWikiManifest(parseJsonStrict(raw), { snapshot: "pending" })
    // Identity covers the complete recorded manifest, including evidence beyond the view cap.
    // Canonical JSON prevents insertion order alone from changing snapshot identity.
    const canonical = (value: unknown, depth = 0): unknown => {
      if (depth > 32) throw new Error("Wiki manifest exceeds nesting limit")
      if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1))
      if (!value || typeof value !== "object") return value
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v, depth + 1)]),
      )
    }
    graph.snapshot = `sha256:${createHash("sha256")
      .update(JSON.stringify(canonical(parseJsonStrict(raw))))
      .digest("hex")}`
    return graph
  }

  export async function exportHtml(destination: string, html: string) {
    const handle = await open(destination, "wx", 0o600)
    try {
      await handle.writeFile(html, "utf8")
    } catch (error) {
      await handle.close()
      await unlink(destination)
      throw error
    }
    await handle.close()
  }

  export async function serve(
    document: ReturnType<typeof renderWikiGraphHtml>,
    live?: {
      state(): string
      document(): ReturnType<typeof renderWikiGraphHtml> | undefined
    },
  ) {
    const capability = `/wiki/${randomBytes(32).toString("hex")}`
    let authority = ""
    const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000 }, (req, res) => {
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("Referrer-Policy", "no-referrer")
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
      let active = document
      let stateBody: string | undefined
      let frame = false
      if (live && req.url === `${capability}/state`) stateBody = live.state()
      if (
        live &&
        req.url?.startsWith(`${capability}/graph?revision=`) &&
        /^sha256%3A[a-f0-9]{64}$/.test(req.url.slice(`${capability}/graph?revision=`.length))
      ) {
        const graph = live.document()
        if (graph) {
          active = graph
          frame = true
        }
      }
      res.setHeader("Content-Security-Policy", `${active.csp}; frame-ancestors ${frame ? "'self'" : "'none'"}`)
      if (
        req.headers.host !== authority ||
        (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        res.writeHead(403).end()
        return
      }
      if (req.url !== capability && stateBody === undefined && !frame) {
        res.writeHead(404).end()
        return
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" }).end()
        return
      }
      if (
        req.headers["transfer-encoding"] ||
        (req.headers["content-length"] && req.headers["content-length"] !== "0")
      ) {
        res.writeHead(400).end()
        return
      }
      const body = stateBody ?? active.html
      res.setHeader(
        "Content-Type",
        stateBody === undefined ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
      )
      res.setHeader("Content-Length", Buffer.byteLength(body))
      res.end(req.method === "HEAD" ? undefined : body)
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      server.close()
      throw new Error("No Wiki viewer address")
    }
    authority = `127.0.0.1:${address.port}`
    let closing: Promise<void> | undefined
    return {
      url: `http://${authority}${capability}`,
      close() {
        return (closing ??= new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        }))
      },
    }
  }

  /** Live shell owns no runtime connection: the TUI supplies detached state. */
  export async function serveLive() {
    let state: WikiMaintenanceStatus & { snapshot?: string } = {
      phase: "queued",
      reason: "idle",
      completed: 0,
      total: 0,
      revision: 0,
    }
    let graph: ReturnType<typeof renderWikiGraphHtml> | undefined
    // @scan-suppress security_scan - Browser script polling its own page. stateUrl is a same-origin path, not a server request.
    const script = `let shown="";const stateUrl=location.pathname+"/state";const label=document.getElementById("status");const view=document.getElementById("graph");async function poll(){try{const r=await fetch(stateUrl,{cache:"no-store"});if(!r.ok)throw Error();const s=await r.json();const reasons={idle:"Waiting for project idle",busy:"Waiting for active sessions and queued work",permissions:"Wiki generation is blocked by read/write permissions",disabled:"Automatic Wiki maintenance is disabled",non_git:"Open the graph again to request Wiki generation for this non-Git directory",building:"Generating Wiki",complete:"Wiki ready",failed:"Wiki maintenance failed or is unavailable. Check the runtime connection and configured model, then reopen the graph to retry."};label.textContent=(reasons[s.reason]||"Wiki status unavailable")+(s.phase==="running"&&s.total?" ("+s.completed+"/"+s.total+")":"");if(s.snapshot&&s.snapshot!==shown){shown=s.snapshot;view.src=location.pathname+"/graph?revision="+encodeURIComponent(s.snapshot);view.hidden=false;}setTimeout(poll,1500)}catch{label.textContent="AX Code connection closed or unavailable. Reopen the graph from the TUI."}}poll();`
    const digest = createHash("sha256").update(script).digest("base64")
    const csp = `default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'`
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>AX Wiki</title><style>body{margin:0;background:#101827;color:#e5edf7;font:15px system-ui}header{padding:16px}h1{margin:0 0 8px;font-size:20px}iframe{width:100%;height:calc(100vh - 100px);border:0;background:white}p{margin:0}</style></head><body><header><h1>AX Wiki</h1><p id="status" role="status" aria-live="polite">Preparing Wiki. Waiting for project idle.</p></header><iframe id="graph" title="Wiki page and source evidence graph" hidden></iframe><script>${script}</script></body></html>`
    const listener = await serve(
      { html, csp },
      {
        state: () => JSON.stringify(state),
        document: () => graph,
      },
    )
    return {
      ...listener,
      update(next: WikiMaintenanceStatus, snapshot?: unknown) {
        const detached = WikiMaintenanceSchema.parse(next)
        if (snapshot !== undefined) {
          const parsed = parseWikiGraph(snapshot)
          if (state.snapshot !== parsed.snapshot) graph = renderWikiGraphHtml(parsed)
          state = { ...detached, snapshot: parsed.snapshot }
        } else state = { ...detached, snapshot: state.snapshot }
      },
    }
  }

  export const render = renderWikiGraphHtml
}
