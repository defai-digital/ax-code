import fs from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { SourceMap } from "node:module"
import { parseJsonStrict } from "../util/json-value"
import { isRecord } from "../util/record"
import type { BrowserScenario } from "./scenario"

export type SourceDiagnostic = {
  file: string
  line: number
  column: number
  confidence: "explicit" | "local_map" | "unresolved"
  contentHash?: string
  mapHash?: string
}

export async function readLocalSource(
  root: string,
  file: string,
  allow: (file: string) => Promise<void>,
): Promise<{ content: string; file: string; hash: string }> {
  const realRoot = await fs.realpath(root)
  const target = await fs.realpath(path.resolve(realRoot, file))
  const relative = path.relative(realRoot, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source reference leaves the repository")
  await allow(relative)
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Source reference is too large")
    const buffer = Buffer.alloc(1024 * 1024 + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== stat.size || (await fs.realpath(target)) !== target)
      throw new Error("Source changed while reading")
    const current = await fs.stat(target)
    if (
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.size !== stat.size ||
      current.mtimeMs !== stat.mtimeMs
    )
      throw new Error("Source changed while reading")
    const content = buffer.subarray(0, bytesRead).toString("utf8")
    return { content, file: relative, hash: createHash("sha256").update(content).digest("hex") }
  } finally {
    await handle.close()
  }
}

/** Local evidence only: references are advisory and never change an assertion verdict. */
export async function linkSources(
  root: string,
  sources: BrowserScenario.Manifest["sources"],
  allow: (file: string) => Promise<void>,
): Promise<SourceDiagnostic[]> {
  const read = (file: string) => readLocalSource(root, file, allow)
  const results: SourceDiagnostic[] = []
  for (const reference of sources) {
    try {
      const original = await read(reference.file)
      if (reference.map) {
        const map = await read(reference.map)
        const payload = parseJsonStrict(map.content)
        if (
          !isRecord(payload) ||
          payload.version !== 3 ||
          !Array.isArray(payload.sources) ||
          typeof payload.mappings !== "string"
        )
          throw new Error("Invalid local source map")
        if (payload.file !== path.basename(reference.file))
          throw new Error("Source map does not name the generated file")
        const entry = new SourceMap(payload as unknown as ConstructorParameters<typeof SourceMap>[0]).findEntry(
          reference.line - 1,
          reference.column,
        )
        if (!("originalSource" in entry) || !entry.originalSource || /:\/\//.test(entry.originalSource))
          throw new Error("Source map location unavailable")
        // @scan-suppress security_scan - readLocalSource resolves and rejects paths outside the repository before opening.
        const mapped = await read(path.join(path.dirname(reference.map), entry.originalSource))
        results.push({
          file: mapped.file,
          line: entry.originalLine + 1,
          column: entry.originalColumn,
          confidence: "local_map",
          contentHash: mapped.hash,
          mapHash: map.hash,
        })
      } else {
        if (reference.line > original.content.split("\n").length) throw new Error("Source line unavailable")
        results.push({
          file: original.file,
          line: reference.line,
          column: reference.column,
          confidence: "explicit",
          contentHash: original.hash,
        })
      }
    } catch {
      results.push({ file: reference.file, line: reference.line, column: reference.column, confidence: "unresolved" })
    }
  }
  return results
}
