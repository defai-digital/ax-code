import fs from "node:fs/promises"
import path from "node:path"

const ext = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])

function imports(text: string) {
  const out = [] as string[]
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) out.push(match[1] ?? "")
  for (const match of text.matchAll(/import\s+["']([^"']+)["']/g)) out.push(match[1] ?? "")
  return out
}

function isEffect(spec: string) {
  return spec === "effect" || spec.startsWith("effect/") || spec.startsWith("@effect/")
}

function isSolid(spec: string) {
  return spec === "solid-js" || spec.startsWith("solid-js/") || spec.startsWith("@solid-primitives/")
}

function isOpenTui(spec: string) {
  return spec.startsWith("@opentui/")
}

function v4Rule(spec: string): V4Guardrails.Rule | undefined {
  if (isEffect(spec)) return "effect"
  if (isSolid(spec)) return "solid"
  if (isOpenTui(spec)) return "opentui"
}

async function exists(dir: string) {
  return fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)
}

function skip(file: string) {
  return (
    file.includes("/node_modules/") || file.includes("/dist/") || file.includes("/.git/") || file.includes("/.turbo/")
  )
}

// V4Guardrails keeps the original v4-directory-scoped rules for
// solid-js and @opentui/*. Those directories are intentionally
// renderer-free; effect is checked globally by EffectGuard below.
export namespace V4Guardrails {
  export const Directories = [
    "src/runtime",
    "src/cli/cmd/tui-v4",
    "src/cli/cmd/tui/state",
    "src/cli/cmd/tui/input",
    "src/cli/cmd/tui/native",
  ] as const
  export type Rule = "effect" | "solid" | "opentui"

  export interface Violation {
    file: string
    spec: string
    rule: Rule
  }

  export async function listFiles(root: string) {
    const out = [] as string[]
    for (const dir of Directories) {
      const base = path.join(root, dir)
      if (!(await exists(base))) continue
      for await (const file of new Bun.Glob("**/*").scan({ cwd: base, absolute: true })) {
        if (skip(file)) continue
        if (!ext.has(path.extname(file))) continue
        out.push(path.relative(root, file))
      }
    }
    return out.sort()
  }

  export async function check(root: string): Promise<Violation[]> {
    const out = [] as Violation[]
    for (const file of await listFiles(root)) {
      const text = await Bun.file(path.join(root, file)).text()
      for (const spec of imports(text)) {
        const hit = v4Rule(spec)
        if (!hit) continue
        out.push({ file, spec, rule: hit })
      }
    }
    return out
  }

  export function format(input: Violation) {
    return `${input.file} imports ${input.spec} (${input.rule})`
  }
}

// EffectGuard scans the entire src/ tree for `from "effect"` (and
// related @effect/*, effect/* paths). Per ARCHITECTURE.md the only
// places allowed to introduce new Effect usage are src/effect/,
// src/session/, src/file/watcher.ts, and the deliberate Zod bridge at
// src/util/effect-zod.ts. Everything else is in scope for the H2
// migration backlog tracked in PRD-2026-05-17-stability-audit-remediation.
//
// To keep CI green while H2 is in progress, the remaining violators are
// listed in `ExistingViolations` and skipped. Each file deleted from
// that list as the migration lands narrows the allowed surface.
// A new Effect import in any other file becomes a CI failure.
export namespace EffectGuard {
  export const AllowedDirs = ["src/effect/", "src/session/"] as const
  export const AllowedFiles = ["src/file/watcher.ts", "src/util/effect-zod.ts"] as const

  // Temporary allowlist of pre-existing Effect importers outside the
  // documented allowlist. Remove entries from this list as each file
  // migrates off Effect (per Phase 4 of the stability remediation PRD).
  // Sorted alphabetically — easy to diff against `git grep -l 'from "effect"'`.
  export const ExistingViolations: ReadonlySet<string> = new Set([
    "src/account/index.ts",
    "src/account/repo.ts",
    "src/account/schema.ts",
    "src/agent/agent.ts",
    "src/auth/index.ts",
    "src/cli/cmd/account.ts",
    "src/cli/effect/prompt.ts",
    "src/command/index.ts",
    "src/config/markdown.ts",
    "src/file/time.ts",
    "src/filesystem/index.ts",
    "src/flag/flag.ts",
    "src/installation/index.ts",
    "src/permission/index.ts",
    "src/project/project.ts",
    "src/provider/auth.ts",
    "src/pty/index.ts",
    "src/question/index.ts",
    "src/replay/index.ts",
    "src/skill/discovery.ts",
    "src/skill/index.ts",
    "src/tool/registry.ts",
    "src/tool/truncate.ts",
    "src/util/effect-http-client.ts",
    "src/util/schema.ts",
  ])

  export interface Violation {
    file: string
    spec: string
  }

  function isAllowed(file: string) {
    if (AllowedFiles.includes(file as (typeof AllowedFiles)[number])) return true
    for (const dir of AllowedDirs) if (file.startsWith(dir)) return true
    return false
  }

  export async function listFiles(root: string) {
    const out = [] as string[]
    const base = path.join(root, "src")
    if (!(await exists(base))) return out
    for await (const file of new Bun.Glob("**/*").scan({ cwd: base, absolute: true })) {
      if (skip(file)) continue
      if (!ext.has(path.extname(file))) continue
      out.push(path.relative(root, file))
    }
    return out.sort()
  }

  export async function check(root: string): Promise<Violation[]> {
    const out = [] as Violation[]
    for (const file of await listFiles(root)) {
      if (isAllowed(file)) continue
      if (ExistingViolations.has(file)) continue
      const text = await Bun.file(path.join(root, file)).text()
      for (const spec of imports(text)) {
        if (!isEffect(spec)) continue
        out.push({ file, spec })
      }
    }
    return out
  }

  // Detect files that used to need an allowlist entry but no longer
  // import Effect. Listing a clean file here keeps the script honest
  // about migration progress.
  export async function staleAllowlistEntries(root: string): Promise<string[]> {
    const stale = [] as string[]
    for (const file of ExistingViolations) {
      const fullPath = path.join(root, file)
      if (!(await exists(fullPath))) {
        stale.push(file)
        continue
      }
      const text = await Bun.file(fullPath).text()
      const stillImports = imports(text).some(isEffect)
      if (!stillImports) stale.push(file)
    }
    return stale
  }

  export function format(input: Violation) {
    return `${input.file} imports ${input.spec}`
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..")
  const v4Violations = await V4Guardrails.check(root)
  const effectViolations = await EffectGuard.check(root)
  const staleEntries = await EffectGuard.staleAllowlistEntries(root)
  let failed = false
  if (v4Violations.length > 0) {
    failed = true
    console.log("# V4 Guardrail Violations (solid-js / @opentui in renderer-free dirs)")
    for (const item of v4Violations) console.log(`- ${V4Guardrails.format(item)}`)
  }
  if (effectViolations.length > 0) {
    failed = true
    console.log(
      "# Effect Guard Violations (outside src/effect, src/session, src/file/watcher.ts, src/util/effect-zod.ts)",
    )
    for (const item of effectViolations) console.log(`- ${EffectGuard.format(item)}`)
    console.log("\nNew code must use async/await + Zod + Result<T,E> instead of Effect (ARCHITECTURE.md).")
  }
  if (staleEntries.length > 0) {
    failed = true
    console.log("# Stale Effect allowlist entries — remove these from EffectGuard.ExistingViolations")
    for (const entry of staleEntries) console.log(`- ${entry}`)
  }
  if (!failed) {
    console.log("ok: no guardrail violations found")
  } else {
    process.exit(1)
  }
}
