// CI guard: JSON.parse on data crossing a trust boundary (subprocess stdout,
// HTTP response bodies) should go through the shared parse helpers in
// util/json-value.ts (parseJsonResult / parseJsonStrict / parseJsonPayload),
// not a bare `JSON.parse(...)` call. A bare call throws a raw, unhelpful
// SyntaxError straight at the user when the input is empty or malformed —
// this exact bug shape shipped twice independently (#253, #337) before
// either was reused. New bare JSON.parse calls in src/ outside the allowlist
// below fail this check; pre-existing ones are grandfathered in
// ExistingViolations pending migration (see #339).
//
// Run: pnpm --dir packages/ax-code run check:bare-json-parse
import path from "node:path"
import { fileURLToPath } from "node:url"
import { exists, readText, scan } from "./fs-compat"

const ext = new Set([".ts", ".tsx"])
const JSON_PARSE = /\bJSON\.parse\s*\(/

function skip(file: string) {
  return (
    file.includes("/node_modules/") || file.includes("/dist/") || file.includes("/.git/") || file.includes("/.turbo/")
  )
}

export namespace JsonParseGuard {
  // The only file allowed to call JSON.parse directly — everything else
  // should call through its parseJsonResult/parseJsonStrict/parseJsonPayload.
  export const ImplementationFile = "src/util/json-value.ts"

  // Files exempt from the guard entirely: low-level runtime-compat shims
  // that must replicate an underlying API's raw throw-on-parse-failure
  // contract (Bun.file().json() / $`cmd`.json()), plus generated or hook
  // sources where "JSON.parse" appears inside embedded script text rather
  // than as a call in this TypeScript runtime.
  export const AllowedFiles: ReadonlySet<string> = new Set([
    "src/bun/node-compat.ts",
    "src/hooks/lifecycle.ts",
    "src/quality/dre-graph-assets.ts",
  ])

  // Pre-existing bare JSON.parse call sites, grandfathered pending
  // migration to the shared helper. Remove an entry once its file stops
  // calling JSON.parse directly — a lingering entry is flagged as stale by
  // staleAllowlistEntries() so the allowlist stays honest.
  export const ExistingViolations: ReadonlySet<string> = new Set([
    "src/cli/cmd/release/check.ts",
    "src/cli/cmd/run-output.ts",
    "src/cli/cmd/workflow-impl.ts",
    "src/desktop/webui.ts",
    "src/mcp/discovery.ts",
    "src/provider/ax-engine/hf-cache.ts",
    "src/provider/cli/json.ts",
    "src/server/ipc-transport.ts",
    "src/session/processor-impl.ts",
    "src/session/prompt-command-workflow.ts",
    "src/tool/visual/compare.ts",
    "src/tool/visual/critique.ts",
  ])

  export interface Violation {
    file: string
    line: number
    text: string
  }

  export async function listFiles(root: string) {
    const out: string[] = []
    const base = path.join(root, "src")
    if (!(await exists(base))) return out
    for (const file of await scan("**/*", { cwd: base, absolute: true })) {
      if (skip(file)) continue
      if (!ext.has(path.extname(file))) continue
      // Normalize to forward slashes so the allowlist Sets (written with "/")
      // match on Windows, where path.relative returns backslash-joined paths.
      out.push(path.relative(root, file).split(path.sep).join("/"))
    }
    return out.sort()
  }

  export async function check(root: string): Promise<Violation[]> {
    const out: Violation[] = []
    for (const file of await listFiles(root)) {
      if (file === ImplementationFile) continue
      if (AllowedFiles.has(file)) continue
      if (ExistingViolations.has(file)) continue
      const text = await readText(path.join(root, file))
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const trimmed = line.trim()
        // Skip full-line comments — a mention of JSON.parse in prose isn't a call.
        // (Trailing `// comment` after real code, and JSON.parse inside a string
        // literal, can still false-positive; this text scan isn't a full parser.)
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue
        if (JSON_PARSE.test(line)) out.push({ file, line: i + 1, text: trimmed })
      }
    }
    return out
  }

  // Detect allowlist entries whose file no longer calls JSON.parse directly
  // (migrated) or no longer exists (deleted/renamed) — either way the entry
  // should be removed.
  export async function staleAllowlistEntries(root: string): Promise<string[]> {
    const stale: string[] = []
    for (const file of ExistingViolations) {
      const fullPath = path.join(root, file)
      if (!(await exists(fullPath))) {
        stale.push(file)
        continue
      }
      const text = await readText(fullPath)
      if (!JSON_PARSE.test(text)) stale.push(file)
    }
    return stale
  }

  export function format(input: Violation) {
    return `${input.file}:${input.line} — ${input.text}`
  }
}

if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const violations = await JsonParseGuard.check(root)
  const staleEntries = await JsonParseGuard.staleAllowlistEntries(root)
  let failed = false
  if (violations.length > 0) {
    failed = true
    console.log("# Bare JSON.parse violations")
    for (const item of violations) console.log(`- ${JsonParseGuard.format(item)}`)
    console.log(
      "\nUse parseJsonResult/parseJsonStrict/parseJsonPayload from src/util/json-value.ts instead of a bare JSON.parse call on subprocess/HTTP/file output (see #339).",
    )
  }
  if (staleEntries.length > 0) {
    failed = true
    console.log("# Stale JsonParseGuard.ExistingViolations entries — remove these from check-bare-json-parse.ts")
    for (const entry of staleEntries) console.log(`- ${entry}`)
  }
  if (!failed) {
    console.log("ok: no bare JSON.parse violations found")
  } else {
    process.exit(1)
  }
}
