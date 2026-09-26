import { constants } from "node:fs"
import { open, realpath, unlink } from "node:fs/promises"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { assertWikiDirectorySafe } from "@ax-code/ax-wiki/node"
import { graphRelativePath, projectWikiManifest } from "@ax-code/ax-wiki/graph"
import { renderWikiGraphHtml } from "@ax-code/ax-wiki-viewer/node"
import { parseJsonStrict } from "../util/json-value"

export namespace WikiVisualization {
  const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

  export async function snapshot(root: string, wikiDir = "ax-wiki") {
    graphRelativePath(wikiDir)
    const canonicalRoot = await realpath(root)
    await assertWikiDirectorySafe(canonicalRoot, wikiDir)
    const manifestPath = path.join(canonicalRoot, wikiDir, ".manifest.json")
    const resolved = await realpath(manifestPath).catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        throw new Error("No Wiki manifest found. Generate a Wiki explicitly before viewing it.")
      throw error
    })
    if (resolved !== manifestPath) throw new Error("Wiki visualization refuses symlinked manifests")
    const handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let raw: string
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size > MAX_MANIFEST_BYTES)
        throw new Error("Wiki manifest must be a regular file no larger than 4 MiB")
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

  export async function serve(document: ReturnType<typeof renderWikiGraphHtml>) {
    const capability = `/wiki/${randomBytes(32).toString("hex")}`
    let authority = ""
    const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000 }, (req, res) => {
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("Referrer-Policy", "no-referrer")
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
      res.setHeader("Content-Security-Policy", `${document.csp}; frame-ancestors 'none'`)
      if (
        req.headers.host !== authority ||
        (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        res.writeHead(403).end()
        return
      }
      if (req.url !== capability) {
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
      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.setHeader("Content-Length", Buffer.byteLength(document.html))
      res.end(req.method === "HEAD" ? undefined : document.html)
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

  export const render = renderWikiGraphHtml
}
