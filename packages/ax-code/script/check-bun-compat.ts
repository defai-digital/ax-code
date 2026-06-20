// CI guard: every `Bun.<api>` used in src/ must be backed by the Node compat
// shim (src/bun/node-compat.ts), otherwise it silently breaks the Node runtime
// (it throws "Bun.x is not a function" only at runtime, never at build/type
// time). When you add a new Bun.* call, either add a shim in node-compat.ts and
// list it here, or replace the call with a Node-portable alternative.
//
// Run: bun run script/check-bun-compat.ts  (wired into CI alongside the other
// check:* guards).
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(dir, "src")

// Bun.* APIs shimmed by src/bun/node-compat.ts (keep in sync with installNodeBunCompat).
const SHIMMED = new Set([
  "version",
  "file",
  "write",
  "hash",
  "Glob",
  "connect",
  "stringWidth",
  "which",
  "resolveSync",
  "stdin",
  "$",
])

// Files allowed to reference Bun.* the shim does not provide, because they are
// the runtime boundary itself (capability-gated, never reached under Node).
const ALLOWED_FILES = new Set([
  path.join(srcDir, "bun", "node-compat.ts"),
  path.join(srcDir, "server", "runtime-adapter.ts"), // Bun.serve, capability-checked
])

async function walk(target: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue
      out.push(...(await walk(full)))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const violations: string[] = []
for (const file of await walk(srcDir)) {
  if (ALLOWED_FILES.has(file)) continue
  const text = await fs.readFile(file, "utf8")
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    // Ignore comments to avoid flagging prose like "// Bun.spawn so ...".
    const code = line.replace(/\/\/.*$/, "")
    for (const match of code.matchAll(/\bBun\.(\$|[a-zA-Z_]\w*)/g)) {
      const api = match[1]!
      if (!SHIMMED.has(api)) {
        violations.push(`${path.relative(dir, file)}:${i + 1}  Bun.${api} is not shimmed in node-compat.ts`)
      }
    }
  })
}

if (violations.length > 0) {
  console.error("Bun.* compat guard failed — these APIs break the Node runtime:\n")
  for (const v of violations) console.error("  " + v)
  console.error(
    "\nFix: add a shim in src/bun/node-compat.ts (and to SHIMMED in this script), " +
      "or replace with a Node-portable call.",
  )
  process.exit(1)
}

console.log("Bun.* compat guard passed: all Bun.* usage is Node-shimmed.")
