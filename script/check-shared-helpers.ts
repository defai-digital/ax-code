#!/usr/bin/env -S npx tsx
/**
 * Repo guard: helpers consolidated into @ax-code/util must keep exactly one
 * implementation.
 *
 * The check fails when:
 *   - the canonical packages/util/src/<slug>.ts implementation is missing an
 *     expected export,
 *   - an intel/reason `src/internal/*` shim is no longer a thin
 *     `export * from "@ax-code/util/<slug>"` re-export, or
 *   - a second `export function` implementation of a moved helper reappears
 *     anywhere under the consolidated packages' `src`.
 *
 * Byte-identical duplicates live in `packages/ax-code/src/util/*` too, but that
 * package is out of this refactor's scope and its `timeout.ts` intentionally has
 * different (ref'd) timer semantics, so it is not scanned here.
 *
 * Run:  tsx script/check-shared-helpers.ts
 */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const SCAN_ROOTS = ["packages/ax-code-intel/src", "packages/ax-code-reason/src"]

type Consolidated = {
  /** File slug under packages/util/src. */
  slug: string
  /** Named exports the single implementation must provide. */
  symbols: string[]
  /** Package-local shim files that must re-export the canonical module. */
  shims: string[]
}

const CONSOLIDATED: Consolidated[] = [
  {
    slug: "string-list",
    symbols: ["stringList", "uniqueItems", "uniqueStrings", "uniqueSortedStrings"],
    shims: [
      "packages/ax-code-intel/src/internal/string-list.ts",
      "packages/ax-code-reason/src/internal/string-list.ts",
    ],
  },
  {
    slug: "unref-timeout",
    symbols: ["sleep", "withTimeout"],
    shims: ["packages/ax-code-intel/src/internal/timeout.ts", "packages/ax-code-reason/src/internal/timeout.ts"],
  },
]

const reExport = (slug: string) => new RegExp(`export\\s+\\*\\s+from\\s+["']@ax-code/util/${slug}["']`)
const reImplement = (symbol: string) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`)

async function read(rel: string): Promise<string | null> {
  try {
    return await readFile(path.join(ROOT, rel), "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

async function collect(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(rel)))
    else if (entry.name.endsWith(".ts")) out.push(rel.split(path.sep).join("/"))
  }
  return out
}

async function main() {
  const errors: string[] = []

  for (const entry of CONSOLIDATED) {
    const canonicalRel = `packages/util/src/${entry.slug}.ts`
    const canonical = await read(canonicalRel)
    if (canonical === null) {
      errors.push(`missing canonical implementation: ${canonicalRel}`)
      continue
    }
    for (const symbol of entry.symbols) {
      if (!reImplement(symbol).test(canonical)) errors.push(`${canonicalRel} does not export ${symbol}`)
    }

    for (const shimRel of entry.shims) {
      const shim = await read(shimRel)
      if (shim === null) {
        errors.push(`missing shim: ${shimRel}`)
        continue
      }
      if (!reExport(entry.slug).test(shim)) {
        errors.push(`${shimRel} must contain: export * from "@ax-code/util/${entry.slug}"`)
      }
      for (const symbol of entry.symbols) {
        if (reImplement(symbol).test(shim)) {
          errors.push(`${shimRel} re-implements ${symbol}; keep only one implementation in ${canonicalRel}`)
        }
      }
    }

    for (const root of SCAN_ROOTS) {
      for (const file of await collect(root)) {
        if (entry.shims.includes(file)) continue
        const text = (await read(file)) ?? ""
        for (const symbol of entry.symbols) {
          if (reImplement(symbol).test(text)) {
            errors.push(`${file} declares ${symbol}; consolidate it in ${canonicalRel} instead of re-implementing`)
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("check-shared-helpers: duplicated or broken shared helpers detected\n")
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }

  const summary = CONSOLIDATED.map((entry) => `${entry.slug} (${entry.shims.length} shims)`).join(", ")
  console.log(`check-shared-helpers: ok — one implementation each for ${summary}`)
}

await main()
