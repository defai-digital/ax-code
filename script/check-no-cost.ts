#!/usr/bin/env bun
/**
 * Repo guard: ax-code intentionally does NOT track or display monetary cost
 * for LLM calls. Any reintroduction of pricing schemas, cost computation, or
 * cost-display surfaces should be caught at PR time.
 *
 * The check is deliberately narrow — it looks for the specific shapes a
 * "cost meter" comeback would take, not the word "cost" in general (which
 * legitimately appears in comments about CPU / runtime / storage cost).
 *
 * Forbidden:
 *   - schema field named `cost` (zod, drizzle, openapi, plain TS object literal)
 *   - identifiers `pricePerToken`, `inputCost`, `outputCost`, `totalCost`,
 *     `costUsd`, `priceUsd`
 *   - `model.cost`, `models[*].cost`, `Cost.compute`, `Cost.format`
 *   - `/cost` slash command registrations
 *
 * Run:  bun run script/check-no-cost.ts
 * Wire: .github/workflows/repo-structure.yml runs this as part of audit.
 */

import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const ROOTS = [
  path.join(ROOT, "packages/ax-code/src"),
  path.join(ROOT, "packages/ax-code/script"),
  path.join(ROOT, "packages/sdk/openapi.json"),
  path.join(ROOT, "packages/sdk/js/src"),
  path.join(ROOT, "script"),
]
// Skip generated bundles and tooling caches. Match by prefix so `dist`,
// `dist-source`, `dist-node`, `ts-dist` etc. are all skipped — without
// this a developer with a local build would trip the guard on bundled
// third-party libraries that happen to mention `totalCost`.
const SKIP_DIR_PREFIXES = ["node_modules", "dist", "ts-dist", ".turbo", ".git"]
// Files that legitimately reference monetary cost in commentary about prior
// removal — they document why ax-code does NOT have a cost meter and would
// otherwise self-trigger this guard.
const SELF_REFERENCE_ALLOWLIST = new Set([
  path.join(ROOT, "packages/ax-code/script/update-models.ts"),
  path.join(ROOT, "script/check-no-cost.ts"),
])

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_PREFIXES.some((p) => name === p || name.startsWith(`${p}-`) || name.startsWith(`${p}_`))
}

type Hit = { file: string; line: number; column: number; pattern: string; snippet: string }

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Schema field — zod-style or plain TS object literal. Value side covers
  // zod (`z.`), TS primitive type names, opening brace, the `Cost` type,
  // and JSON-encoded primitive values (`"number"` / `"string"`) so OpenAPI
  // dumps with `"cost": "number"` are also caught — the previous regen had
  // `"cost": {` which the brace branch already covered, but a future
  // string-valued schema would otherwise slip through.
  { name: "schema-field", re: /["']?cost["']?\s*:\s*(z\.|number\b|string\b|\{|Cost\b|"(?:number|string)")/g },
  // OpenAPI required arrays containing "cost".
  { name: "openapi-required-cost", re: /"required"\s*:\s*\[[^\]]*"cost"[^\]]*\]/g },
  // Pricing-style identifiers.
  { name: "pricing-identifier", re: /\b(?:pricePerToken|inputCost|outputCost|totalCost|costUsd|priceUsd)\b/g },
  // Common access patterns.
  { name: "model-cost-access", re: /\b(?:model|models\[[^\]]+\])\.cost\b/g },
  // Cost helper namespace.
  { name: "cost-namespace", re: /\bCost\.(?:compute|format|fromTokens|forUsage)\b/g },
  // /cost slash command (case-sensitive — distinct from English "cost" prose).
  { name: "cost-slash-command", re: /command\s*:\s*["']\/cost["']/g },
]

// Match local-variable / parameter declarations that the schema-field regex
// would otherwise false-trigger on. These are TypeScript type annotations on
// identifiers that happen to be named `cost`, not pricing schema fields:
//   - `const cost: number = 5`           → before = `const ` (cost IS the
//                                           identifier, no extra \w+)
//   - `function cost(x: number)`         → before = `function `
//   - `function f(cost: number)`         → before = `function f(`
//   - `(cost: string) => ...`            → before = `(`
//   - `f(a, cost: number)`               → before = `..., `
// Legitimate matches (interface field, type alias field, zod object key,
// inline object literal) are preceded by `{`, `=`, `;`, etc. and won't
// hit either branch — they remain caught.
const SCHEMA_FIELD_FALSE_POSITIVE_PREFIX = /(?:\b(?:const|let|var|function|class)\s+(?:\w+\s+)?$|[(,]\s*$)/

async function* walk(target: string): AsyncIterable<string> {
  // Roots are best-effort: a fresh checkout (or a workspace package not
  // built yet) may legitimately lack `packages/sdk/openapi.json`. Treat
  // missing roots as empty rather than crashing the whole guard.
  const s = await stat(target).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") return null
    throw err
  })
  if (s === null) return
  if (s.isFile()) {
    yield target
    return
  }
  if (!s.isDirectory()) return
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue
      yield* walk(path.join(target, entry.name))
      continue
    }
    if (!entry.isFile()) continue
    const name = entry.name
    if (
      name.endsWith(".ts") ||
      name.endsWith(".tsx") ||
      name.endsWith(".js") ||
      name.endsWith(".jsx") ||
      name.endsWith(".json")
    ) {
      yield path.join(target, entry.name)
    }
  }
}

function* scanText(file: string, body: string): IterableIterator<Hit> {
  const lines = body.split("\n")
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const before = body.slice(0, m.index)
      const line = before.split("\n").length
      const lineStart = before.lastIndexOf("\n") + 1
      const column = m.index - lineStart + 1
      const lineText = lines[line - 1] ?? ""
      const beforeMatchOnLine = lineText.slice(0, column - 1)
      // Ignore matches inside line comments — `// cost: maybe one day` is
      // not a schema field. Match `//` not preceded by `:` (so `https://`
      // inside a string doesn't false-skip a real match further along).
      if (/(^|[^:])\/\//.test(beforeMatchOnLine)) continue
      // Schema-field regex is the only one with non-trivial false-positive
      // risk: it would otherwise flag local-variable / function-parameter
      // declarations like `const cost: number` or `(cost: number) => ...`.
      // These are TS type annotations on a `cost` identifier, not pricing
      // schema fields.
      if (name === "schema-field" && SCHEMA_FIELD_FALSE_POSITIVE_PREFIX.test(beforeMatchOnLine)) continue
      yield {
        file,
        line,
        column,
        pattern: name,
        snippet: lineText.trim(),
      }
    }
  }
}

async function main() {
  const hits: Hit[] = []
  for (const root of ROOTS) {
    for await (const file of walk(root)) {
      if (SELF_REFERENCE_ALLOWLIST.has(file)) continue
      const body = await readFile(file, "utf-8").catch(() => null)
      if (body === null) continue
      for (const hit of scanText(file, body)) hits.push(hit)
    }
  }

  if (hits.length === 0) {
    console.log("check-no-cost: clean — no cost meter / pricing surfaces detected")
    return
  }

  console.error("check-no-cost: forbidden cost / pricing references detected\n")
  for (const h of hits) {
    const rel = path.relative(ROOT, h.file)
    console.error(`  ${rel}:${h.line}:${h.column}  [${h.pattern}]  ${h.snippet}`)
  }
  console.error(
    "\nax-code intentionally does not track or display monetary cost for LLM calls.\n" +
      "If this is genuinely a non-cost field (CPU / runtime / storage cost in a comment),\n" +
      "rephrase the identifier or move the comment so it doesn't match the schema-field regex.",
  )
  process.exit(1)
}

await main()
