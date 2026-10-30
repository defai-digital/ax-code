import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const NATIVE_SOURCE_ROOT = fileURLToPath(new URL("../native/renderer/", import.meta.url))
const GENERATED = new Set([".zig-cache", "zig-out", "lib"])

/** Hash source paths and bytes, excluding Zig's local build products. */
export function nativeSourceDigest(directory = NATIVE_SOURCE_ROOT): string {
  const hash = createHash("sha256")
  function visit(current: string, prefix: string): void {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      if (!prefix && GENERATED.has(entry.name)) continue
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory()) visit(join(current, entry.name), `${name}/`)
      else if (entry.isFile()) {
        const bytes = readFileSync(join(current, entry.name))
        hash.update(`${name}\0${bytes.byteLength}\0`).update(bytes)
      } else throw new Error(`Native source must contain regular files: ${name}`)
    }
  }
  visit(directory, "")
  return hash.digest("hex")
}
