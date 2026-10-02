#!/usr/bin/env -S npx tsx
/**
 * Repo guard: @ax-code/ax-agent-runtime is an incubation package (ADR-163).
 * Phase 1 holds the turn decision kernel contract plus the host port — no
 * core imports, no environment access, no executable policy.
 *
 * The check fails when `packages/ax-agent-runtime/src/**`:
 *   - imports anything but `node:*` builtins or src-contained relative
 *     paths (bare imports resolve against an empty `dependencies`, so any
 *     bare non-`node:` import is a violation even before resolution),
 *   - touches environment, timer, or domain-type tokens,
 *   - declares a value export outside the host allowlist, or
 *   - escapes the manifest contract (`exports` map, `private`, empty deps,
 *     no tsconfig `paths`).
 * It also fails when any file under `packages/ax-code/src` (production
 * paths; tests are exempt) imports the incubation package or the glue
 * outside `agent-runtime-glue.ts`.
 *
 * Known limitation: the stripper is string- and comment-aware but not
 * regex-aware — a regex literal containing quote or comment characters can
 * confuse it. The scanner is a guard against accidental pollution, not a
 * sandbox against adversarial code.
 *
 * Run:  tsx script/check-agent-runtime-boundary.ts
 */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = path.resolve(import.meta.dirname, "..")
const PKG_DIR = path.join(ROOT, "packages", "ax-agent-runtime")
const SRC_DIR = path.join(PKG_DIR, "src")
const CORE_SRC_DIR = path.join(ROOT, "packages", "ax-code", "src")

const VALUE_EXPORT_ALLOWLIST = new Set(["configureAgentRuntimeHost", "getAgentRuntimeHost"])

const BANNED_TOKENS = [
  "process.env",
  "process.cwd(",
  "homedir(",
  "Bun.",
  "MessageV2",
  "MessageID",
  "PartID",
  "SessionID",
  "ProviderID",
  "ModelID",
  "node:fs",
  "setTimeout(",
  "setInterval(",
  "setImmediate(",
  "queueMicrotask(",
]

const BANNED_TOKEN_PATTERNS: RegExp[] = [
  /\bprocess\s*\[/,
  /\bDate\s*\(/,
  /\bDate\s*\.\s*now\s*\(/,
  /\bperformance\s*\.\s*now\s*\(/,
  /\bglobalThis\s*\./,
]

const EXPECTED_EXPORTS: Record<string, string> = {
  ".": "./src/index.ts",
  "./host": "./src/host.ts",
  "./decision": "./src/decision.ts",
}

const FROM_SPECIFIER_PATTERN = /\bfrom\s*["'`]([^"'`]+?)["'`]/g
const SIDE_EFFECT_IMPORT_PATTERN = /import\s*["'`]([^"'`]+?)["'`]/g
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*["'`]([^"'`]+?)["'`]\s*\)/g
const REQUIRE_PATTERN = /require\s*\(\s*["'`]([^"'`]+?)["'`]\s*\)/g
const REFERENCE_PATTERN = /<reference\s+path\s*=\s*["']([^"']+)["']/g

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"])

export type BoundaryViolation = { file: string; line: number; detail: string }

type StripFrame =
  | { kind: "line" | "block" | "sq" | "dq" }
  | { kind: "tpl"; exprDepth: number }
  | { kind: "expr"; braceDepth: number }

/**
 * Blank strings and comments (or, with keepStrings, comments only),
 * preserving newlines so line numbers stay stable. Template `${}`
 * interpolations are kept as code. Pure and unit-tested. Not regex-aware
 * (see header).
 */
export function stripToCode(text: string, keepStrings = false): string {
  let out = ""
  let i = 0
  const frames: StripFrame[] = []
  const top = (): StripFrame | undefined => frames[frames.length - 1]
  const pushCodeChar = (ch: string, next: string | undefined): boolean => {
    if (ch === "/" && next === "/") {
      frames.push({ kind: "line" })
      out += "  "
      i += 2
      return true
    }
    if (ch === "/" && next === "*") {
      frames.push({ kind: "block" })
      out += "  "
      i += 2
      return true
    }
    if (ch === "'") {
      frames.push({ kind: "sq" })
      out += keepStrings ? ch : " "
      i += 1
      return true
    }
    if (ch === '"') {
      frames.push({ kind: "dq" })
      out += keepStrings ? ch : " "
      i += 1
      return true
    }
    if (ch === "`") {
      frames.push({ kind: "tpl", exprDepth: 0 })
      out += keepStrings ? ch : " "
      i += 1
      return true
    }
    return false
  }
  while (i < text.length) {
    const ch = text[i] as string
    const next = text[i + 1] as string | undefined
    const frame = top()
    if (frame === undefined || frame.kind === "expr") {
      if (frame !== undefined) {
        if (ch === "{") frame.braceDepth += 1
        if (ch === "}") {
          frame.braceDepth -= 1
          if (frame.braceDepth === 0) {
            frames.pop()
            out += " "
            i += 1
            continue
          }
        }
      }
      if (!pushCodeChar(ch, next)) {
        out += ch
        i += 1
      }
      continue
    }
    if (frame.kind === "line") {
      if (ch === "\n") {
        frames.pop()
        out += "\n"
      } else {
        out += " "
      }
      i += 1
      continue
    }
    if (frame.kind === "block") {
      if (ch === "*" && next === "/") {
        frames.pop()
        out += "  "
        i += 2
        continue
      }
      out += ch === "\n" ? "\n" : " "
      i += 1
      continue
    }
    if (frame.kind === "sq" || frame.kind === "dq") {
      const quote = frame.kind === "sq" ? "'" : '"'
      if (ch === "\\") {
        out += keepStrings ? text.slice(i, i + 2) : "  "
        i += 2
        continue
      }
      if (ch === quote) frames.pop()
      out += ch === "\n" ? "\n" : keepStrings ? ch : " "
      i += 1
      continue
    }
    // tpl frame
    if (frame.exprDepth === 0) {
      if (ch === "\\") {
        out += keepStrings ? text.slice(i, i + 2) : "  "
        i += 2
        continue
      }
      if (ch === "`") {
        frames.pop()
        out += keepStrings ? ch : " "
        i += 1
        continue
      }
      if (ch === "$" && next === "{") {
        frames.push({ kind: "expr", braceDepth: 1 })
        out += "  "
        i += 2
        continue
      }
      out += ch === "\n" ? "\n" : keepStrings ? ch : " "
      i += 1
      continue
    }
  }
  return out
}

/** Strip comments but keep string contents (for specifier scanning). */
export function stripComments(text: string): string {
  return stripToCode(text, true)
}

/** True when a relative specifier resolves outside `srcDir`. Pure and unit-tested. */
export function escapesSrc(specifier: string, fromFile: string, srcDir: string): boolean {
  const resolved = path.resolve(path.dirname(fromFile), specifier)
  const rel = path.relative(srcDir, resolved)
  return rel === "" || rel.startsWith("..") || path.isAbsolute(rel)
}

function checkSpecifier(specifier: string, fromFile: string): string | undefined {
  if (specifier.startsWith("node:")) return undefined
  if (specifier.startsWith(".")) {
    if (!escapesSrc(specifier, fromFile, SRC_DIR)) return undefined
    return `relative import "${specifier}" escapes ${path.relative(ROOT, SRC_DIR)}`
  }
  return `banned bare import "${specifier}" (phase 1 allows only "node:*" and src-contained relative imports)`
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length
}

export type FoundSpecifier = { specifier: string; line: number }

/** Extract import/require/reference specifiers with line numbers. Pure and unit-tested. */
export function scanSpecifiers(strippedText: string, rawText: string): FoundSpecifier[] {
  const found: FoundSpecifier[] = []
  for (const pattern of [FROM_SPECIFIER_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, REQUIRE_PATTERN]) {
    pattern.lastIndex = 0
    for (const match of strippedText.matchAll(pattern)) {
      if (match[1] !== undefined && match.index !== undefined) {
        found.push({ specifier: match[1], line: lineOf(strippedText, match.index) })
      }
    }
  }
  REFERENCE_PATTERN.lastIndex = 0
  for (const match of rawText.matchAll(REFERENCE_PATTERN)) {
    if (match[1] !== undefined && match.index !== undefined) {
      found.push({ specifier: match[1], line: lineOf(rawText, match.index) })
    }
  }
  return found
}

/** Check one stripped code line for tokens and value exports. Pure and unit-tested. */
export function scanLine(codeLine: string): string[] {
  const details: string[] = []
  for (const token of BANNED_TOKENS) {
    if (codeLine.includes(token)) details.push(`banned token "${token}"`)
  }
  for (const pattern of BANNED_TOKEN_PATTERNS) {
    if (pattern.test(codeLine)) details.push(`banned token matching ${pattern}`)
  }
  details.push(...checkExportDeclaration(codeLine))
  return details
}

function checkExportedName(name: string): string | undefined {
  if (VALUE_EXPORT_ALLOWLIST.has(name)) return undefined
  return `non-allowlisted export "${name}" (no executable policy in phase 1)`
}

export function checkExportListNames(inner: string): string[] {
  const details: string[] = []
  for (const part of inner.split(",")) {
    const trimmed = part.trim()
    if (!trimmed || /^type\s+/.test(trimmed)) continue
    const cleaned = trimmed
    const exported = cleaned.includes(" as ") ? (cleaned.split(" as ").at(-1) ?? "").trim() : cleaned
    if (!exported) continue
    const problem = checkExportedName(exported)
    if (problem) details.push(problem)
  }
  return details
}

export function checkExportDeclaration(codeLine: string): string[] {
  if (/^\s*export\s+type\b/.test(codeLine)) return []
  if (/^\s*export\s+interface\b/.test(codeLine)) return []
  if (/^\s*export\s+namespace\b/.test(codeLine)) return []
  if (!/^\s*export\b/.test(codeLine)) return []
  if (/export\s+default\b/.test(codeLine)) return ["banned default export (phase 1 allows no default exports)"]
  if (/export\s*\*/.test(codeLine)) return ["banned export-star (list names explicitly)"]
  const list = codeLine.match(/export\s*\{([^}]*)\}/)
  if (list) return checkExportListNames(list[1] ?? "")
  const fn = codeLine.match(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/)
  if (fn?.[1]) {
    const problem = checkExportedName(fn[1])
    return problem ? [problem] : []
  }
  const value = codeLine.match(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/)
  if (value?.[1]) {
    const problem = checkExportedName(value[1])
    return problem ? [problem] : []
  }
  const cls = codeLine.match(/export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)
  if (cls?.[1]) {
    const problem = checkExportedName(cls[1])
    return problem ? [problem] : []
  }
  const en = codeLine.match(/export\s+enum\s+([A-Za-z_$][\w$]*)/)
  if (en?.[1]) {
    const problem = checkExportedName(en[1])
    return problem ? [problem] : []
  }
  return []
}

/** Multiline `export { ... }` lists, checked on whole stripped text. Pure and unit-tested. */
export function checkExportLists(strippedText: string): Array<{ line: number; detail: string }> {
  const findings: Array<{ line: number; detail: string }> = []
  const pattern = /export\s*\{([\s\S]*?)\}/g
  for (const match of strippedText.matchAll(pattern)) {
    if (match.index === undefined) continue
    // `export type { ... }` never matches: `type` sits between `export` and `{`.
    for (const detail of checkExportListNames(match[1] ?? "")) {
      findings.push({ line: lineOf(strippedText, match.index), detail })
    }
  }
  return findings
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)))
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full)
  }
  return files.sort()
}

async function checkSources(): Promise<BoundaryViolation[]> {
  const violations: BoundaryViolation[] = []
  for (const file of await listSourceFiles(SRC_DIR)) {
    const rel = path.relative(ROOT, file)
    const raw = await readFile(file, "utf8")
    const stripped = stripToCode(raw)
    const withStrings = stripComments(raw)
    for (const { specifier, line } of scanSpecifiers(withStrings, raw)) {
      const problem = checkSpecifier(specifier, file)
      if (problem) violations.push({ file: rel, line, detail: problem })
    }
    stripped.split("\n").forEach((codeLine, index) => {
      for (const detail of scanLine(codeLine)) {
        violations.push({ file: rel, line: index + 1, detail })
      }
    })
    for (const { line, detail } of checkExportLists(stripped)) {
      // Single-line lists are already reported by scanLine; keep only multiline ones.
      const singleLineReported = stripped.split("\n")[line - 1]?.includes("}") ?? false
      if (!singleLineReported) violations.push({ file: rel, line, detail })
    }
  }
  return violations
}

async function checkManifest(): Promise<BoundaryViolation[]> {
  const file = path.join(PKG_DIR, "package.json")
  const violations: BoundaryViolation[] = []
  const manifest = JSON.parse(await readFile(file, "utf8")) as {
    private?: unknown
    exports?: unknown
    dependencies?: unknown
    peerDependencies?: unknown
    optionalDependencies?: unknown
  }
  const rel = path.relative(ROOT, file)
  if (manifest.private !== true)
    violations.push({ file: rel, line: 1, detail: `"private" must be true during incubation` })
  const exportsMap = (manifest.exports ?? {}) as Record<string, string>
  for (const [key, value] of Object.entries(EXPECTED_EXPORTS)) {
    if (exportsMap[key] !== value)
      violations.push({ file: rel, line: 1, detail: `exports["${key}"] must be "${value}"` })
  }
  for (const key of Object.keys(exportsMap)) {
    if (!(key in EXPECTED_EXPORTS)) violations.push({ file: rel, line: 1, detail: `unexpected export "${key}"` })
  }
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"] as const) {
    const value = manifest[field]
    if (value !== undefined && Object.keys(value as object).length > 0) {
      violations.push({ file: rel, line: 1, detail: `"${field}" must stay empty in phase 1` })
    }
  }
  const tsconfigFile = path.join(PKG_DIR, "tsconfig.json")
  const tsconfig = JSON.parse(await readFile(tsconfigFile, "utf8")) as { compilerOptions?: { paths?: unknown } }
  if (tsconfig.compilerOptions?.paths !== undefined) {
    violations.push({
      file: path.relative(ROOT, tsconfigFile),
      line: 1,
      detail: `tsconfig "paths" must stay absent in phase 1`,
    })
  }
  return violations
}

async function checkGlueConsumers(): Promise<BoundaryViolation[]> {
  const violations: BoundaryViolation[] = []
  const glueFile = path.join(CORE_SRC_DIR, "agent-runtime-glue.ts")
  for (const file of await listSourceFiles(CORE_SRC_DIR)) {
    if (file === glueFile) continue
    const raw = await readFile(file, "utf8")
    if (!raw.includes("agent-runtime")) continue
    const withStrings = stripComments(raw)
    for (const { specifier, line } of scanSpecifiers(withStrings, raw)) {
      if (specifier.includes("agent-runtime")) {
        violations.push({
          file: path.relative(ROOT, file),
          line,
          detail: `production import of the incubation package must go through agent-runtime-glue.ts (tests exempt)`,
        })
      }
    }
  }
  return violations
}

export async function checkBoundary(): Promise<BoundaryViolation[]> {
  return [...(await checkSources()), ...(await checkManifest()), ...(await checkGlueConsumers())]
}

async function main(): Promise<void> {
  const violations = await checkBoundary()
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line}: ${violation.detail}`)
    }
    process.exit(1)
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) await main()
