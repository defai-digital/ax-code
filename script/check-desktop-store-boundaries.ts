/**
 * Desktop store boundary check — structural enforcement for the UI store
 * layer (SPEC-2026-08-30-desktop-state-convergence, decision D4).
 *
 * Rules, all scanning imports that resolve INSIDE desktop/packages/ui/src
 * (both relative specifiers and the `@/` alias; cross-package imports are
 * check-desktop-boundaries' job):
 *
 * - R1 store→store import ratchet: top-level modules in src/stores/ may not
 *   import other top-level src/stores/ modules except via the FROZEN
 *   allowlist below. The allowlist may only shrink: a new edge is a
 *   violation, a removed edge prints a prompt to shrink the list.
 * - R2 sync internals encapsulation: files outside src/sync/ may not import
 *   the sync internals (child-store, event-reducer, event-pipeline,
 *   sync-context-impl). Use the public surface instead (sync-context hooks,
 *   sync-refs, session-actions, …). The exception list is frozen and may
 *   only shrink.
 * - R3 transport consumer registry: src/lib/event-stream/client (the unified
 *   Slice 1 transport) may only be imported by the registered consumers
 *   below. Everyone else uses lib/event-stream/subscribe.ts.
 * - R4 no duplicate exported hook names: across src/stores/ and src/sync/
 *   two modules may not export the same `useX` identifier. Implemented with
 *   static analysis (not the runtime store registry in
 *   src/lib/store-registry.ts) because only pilot stores are registered so
 *   far; barrels (`export * from` / `export { x } from` an in-scope module)
 *   are transparent — the name belongs to the defining module.
 *
 * Docs: desktop/packages/ui/src/stores/DOCUMENTATION.md (Store boundary
 * enforcement) and desktop/packages/ui/src/sync/DOCUMENTATION.md.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fg from "fast-glob"
import ts from "typescript"
import { extractImportSpecifiers, type ImportSpecifier } from "./import-specifiers"

const root = path.resolve(import.meta.dirname, "..")

const UI_SRC = "desktop/packages/ui/src"
const STORES_DIR = `${UI_SRC}/stores`
const SYNC_DIR = `${UI_SRC}/sync`
const TRANSPORT_CLIENT_MODULE = `${UI_SRC}/lib/event-stream/client`

const DOCS_POINTER =
  "See desktop/packages/ui/src/stores/DOCUMENTATION.md (Store boundary enforcement) " +
  "and desktop/packages/ui/src/sync/DOCUMENTATION.md"

/**
 * R1 frozen baseline — the exact store→store edges present when this check
 * was introduced (2026-08-30). Entries are `<importer> -> <imported>` using
 * extension-less module basenames. MAY ONLY SHRINK.
 */
export const STORE_TO_STORE_IMPORT_ALLOWLIST: readonly string[] = [
  "useAgentsStore -> useCommandsStore",
  "useAgentsStore -> useConfigStore",
  "useAgentsStore -> useProjectsStore",
  "useAgentsStore -> useSkillsCatalogStore",
  "useAgentsStore -> useSkillsStore",
  "useConfigStore -> useConfigStore-impl",
  "useConfigStore-impl -> useAgentsStore",
  "useConfigStore-impl -> useDirectoryStore",
  "useDirectoryStore -> useFileSearchStore",
  "useGlobalSessionsStore -> globalSessions",
  "useGlobalSessionsStore -> messageQueueStore",
  "useGlobalSessionsStore -> permissionStore",
  "useMcpConfigStore -> useAgentsStore",
  "useMcpStore -> useDirectoryStore",
  "useMultiRunStore -> useDirectoryStore",
  "useMultiRunStore -> useGlobalSessionsStore",
  "useMultiRunStore -> useProjectsStore",
  "useMultiRunStore -> useSnippetsStore",
  "usePluginsStore -> useAgentsStore",
  "useProjectsStore -> useDirectoryStore",
  "useSessionRollbackStore -> useDirectoryStore",
  "useSkillsCatalogStore -> useSkillsStore",
  "useUIStore -> useUIStore-impl",
]

/** R2 sync-internal modules (extension-less basenames under src/sync/). */
const SYNC_INTERNAL_MODULES = ["child-store", "event-reducer", "event-pipeline", "sync-context-impl"]

/**
 * R2 frozen exceptions — external imports of sync internals that predate this
 * check. MAY ONLY SHRINK; remove the import, not the rule.
 */
export const SYNC_INTERNAL_IMPORT_EXCEPTIONS: readonly { file: string; target: string }[] = [
  // ReconnectBanner triggers an immediate reconnect via the pipeline's
  // retry-now command. Grandfathered; a later sub-step moves this command
  // onto the documented public surface.
  { file: `${UI_SRC}/components/ui/ReconnectBanner.tsx`, target: "event-pipeline" },
]

/**
 * R3 registered consumers of the unified event transport client. Everyone
 * else must go through lib/event-stream/subscribe.ts.
 */
export const EVENT_TRANSPORT_CLIENT_CONSUMERS: readonly string[] = [
  `${UI_SRC}/lib/event-stream/subscribe.ts`,
  `${UI_SRC}/lib/event-stream/client.test.ts`,
  `${UI_SRC}/sync/event-pipeline.ts`,
]

export const STORE_BOUNDARY_REASONS = {
  storeToStore:
    "Stores must not import other stores outside the frozen allowlist (R1). " +
    "Extract a shared lib/ helper or read via .getState() at the call site instead.",
  syncInternal:
    "Sync internals (child-store, event-reducer, event-pipeline, sync-context-impl) are private to src/sync/ (R2). " +
    "Import the documented public surface (sync-context hooks, sync-refs, session-actions) instead.",
  transportConsumer:
    "lib/event-stream/client may only be imported by its registered consumers (R3). " +
    "Use the public lib/event-stream/subscribe.ts entry point instead.",
  duplicateHook:
    "Exported hook names (useX) must be unique across src/stores/ and src/sync/ (R4). " +
    "Rename one of the colliding hooks.",
} as const

export type StoreBoundaryViolation = {
  file: string
  line: number
  column: number
  specifier: string
  rule: "R1" | "R2" | "R3" | "R4"
  reason: string
  sourceLine?: string
}

export type StoreBoundaryEdge = {
  file: string
  line: number
  column: number
  edge: string
  specifier: string
}

function normalize(value: string) {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value
  return path.posix.normalize(withoutQuery.replaceAll("\\", "/"))
}

function rel(file: string) {
  const value = path.isAbsolute(file) ? path.relative(root, file) : file
  return normalize(value)
}

function hasPathPrefix(value: string, prefix: string) {
  return value === prefix || value.startsWith(`${prefix}/`)
}

function stripExtension(value: string) {
  return value.replace(/\.(d\.ts|tsx?|jsx?|mjs|cjs|mts|cts)$/i, "")
}

function isTestModule(modulePath: string) {
  return /(?:\.(?:test|spec))$/.test(stripExtension(modulePath))
}

/**
 * Resolve an import specifier to an extension-less repo-relative module path
 * inside desktop/packages/ui/src, or undefined when it points elsewhere.
 * Handles both relative specifiers and the ui package's `@/` alias.
 */
export function resolveUiModule(file: string, specifier: string): string | undefined {
  const clean = specifier.split(/[?#]/, 1)[0] ?? specifier
  if (clean.startsWith("@/")) {
    return stripExtension(normalize(`${UI_SRC}/${clean.slice(2)}`))
  }
  if (!clean.startsWith(".")) return undefined
  const absoluteFile = path.isAbsolute(file) ? file : path.resolve(root, file)
  const resolved = rel(path.resolve(path.dirname(absoluteFile), clean))
  if (!hasPathPrefix(resolved, UI_SRC)) return undefined
  return stripExtension(resolved)
}

function isTopLevelStoreModule(fileRel: string) {
  return path.posix.dirname(stripExtension(fileRel)) === STORES_DIR && !isTestModule(fileRel)
}

function violation(
  file: string,
  item: ImportSpecifier,
  rule: StoreBoundaryViolation["rule"],
  reason: string,
  sourceLines: readonly string[],
): StoreBoundaryViolation {
  return {
    file: rel(file),
    line: item.line,
    column: item.column,
    specifier: item.specifier,
    rule,
    reason,
    sourceLine: sourceLines[item.line - 1]?.trim(),
  }
}

/** R1 — store→store edges imported by a top-level src/stores/ module. */
export function analyzeStoreToStoreImports(file: string, source: string): StoreBoundaryEdge[] {
  const fileRel = rel(file)
  if (!isTopLevelStoreModule(fileRel)) return []

  const importer = path.posix.basename(stripExtension(fileRel))
  const edges: StoreBoundaryEdge[] = []
  for (const item of extractImportSpecifiers(source, file)) {
    const resolved = resolveUiModule(file, item.specifier)
    if (!resolved || path.posix.dirname(resolved) !== STORES_DIR || isTestModule(resolved)) continue
    const imported = path.posix.basename(resolved)
    if (imported === importer) continue
    edges.push({
      file: fileRel,
      line: item.line,
      column: item.column,
      edge: `${importer} -> ${imported}`,
      specifier: item.specifier,
    })
  }
  return edges
}

/** R2 — external imports of sync-internal modules. */
export function analyzeSyncInternalImports(file: string, source: string): StoreBoundaryViolation[] {
  const fileRel = rel(file)
  if (hasPathPrefix(fileRel, SYNC_DIR)) return []

  const sourceLines = source.split(/\r?\n/)
  const violations: StoreBoundaryViolation[] = []
  for (const item of extractImportSpecifiers(source, file)) {
    const resolved = resolveUiModule(file, item.specifier)
    if (!resolved || path.posix.dirname(resolved) !== SYNC_DIR) continue
    const target = path.posix.basename(resolved)
    if (!SYNC_INTERNAL_MODULES.includes(target)) continue
    if (SYNC_INTERNAL_IMPORT_EXCEPTIONS.some((entry) => entry.file === fileRel && entry.target === target)) continue
    violations.push(violation(file, item, "R2", STORE_BOUNDARY_REASONS.syncInternal, sourceLines))
  }
  return violations
}

/** R3 — imports of the unified event transport client. */
export function analyzeEventTransportClientImports(file: string, source: string): StoreBoundaryViolation[] {
  const fileRel = rel(file)
  const sourceLines = source.split(/\r?\n/)
  const violations: StoreBoundaryViolation[] = []
  for (const item of extractImportSpecifiers(source, file)) {
    const resolved = resolveUiModule(file, item.specifier)
    if (resolved !== TRANSPORT_CLIENT_MODULE) continue
    if (EVENT_TRANSPORT_CLIENT_CONSUMERS.includes(fileRel)) continue
    violations.push(violation(file, item, "R3", STORE_BOUNDARY_REASONS.transportConsumer, sourceLines))
  }
  return violations
}

const HOOK_NAME_PATTERN = /^use[A-Z]/

function isInStoreScope(modulePath: string | undefined): modulePath is string {
  return !!modulePath && (hasPathPrefix(modulePath, STORES_DIR) || hasPathPrefix(modulePath, SYNC_DIR))
}

/**
 * R4 — `useX` hook names DEFINED by this module. Re-exports from another
 * in-scope module are transparent (the name belongs to the defining module);
 * re-exports from out-of-scope modules are attributed to this file.
 */
export function collectExportedHookNames(file: string, source: string): string[] {
  const fileRel = rel(file)
  if (!isInStoreScope(stripExtension(fileRel)) || isTestModule(fileRel)) return []
  if (fileRel.split("/").includes("__tests__")) return []

  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names: string[] = []
  const hasExportModifier = (node: ts.Node) =>
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

  const addIfHook = (name: string | undefined) => {
    if (name && HOOK_NAME_PATTERN.test(name)) names.push(name)
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) addIfHook(declaration.name.text)
      }
      continue
    }

    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && hasExportModifier(statement)) {
      addIfHook(statement.name?.text)
      continue
    }

    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue

    if (statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      // Transparent barrel when the target lives in the scanned scope.
      if (isInStoreScope(resolveUiModule(file, statement.moduleSpecifier.text))) continue
    }

    const clause = statement.exportClause
    if (!clause || !ts.isNamedExports(clause)) continue
    for (const element of clause.elements) {
      if (element.isTypeOnly) continue
      addIfHook(element.name.text)
    }
  }

  return names
}

/** R4 — duplicate exported hook names across stores/ + sync/. */
export function findDuplicateHookNames(hookNames: ReadonlyMap<string, readonly string[]>): StoreBoundaryViolation[] {
  const violations: StoreBoundaryViolation[] = []
  for (const [name, owners] of [...hookNames.entries()].sort()) {
    if (owners.length < 2) continue
    for (const owner of owners) {
      violations.push({
        file: owner,
        line: 1,
        column: 1,
        specifier: name,
        rule: "R4",
        reason: `${STORE_BOUNDARY_REASONS.duplicateHook} "${name}" is exported by: ${owners.join(", ")}`,
      })
    }
  }
  return violations
}

export type StoreBoundaryReport = {
  violations: StoreBoundaryViolation[]
  warnings: string[]
}

export async function collectDesktopStoreBoundaryViolations(): Promise<StoreBoundaryReport> {
  const files = await fg([`${UI_SRC}/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}`], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/out/**"],
  })

  const violations: StoreBoundaryViolation[] = []
  const warnings: string[] = []
  const storeEdges: StoreBoundaryEdge[] = []
  const transportImporters = new Set<string>()
  const hookNames = new Map<string, string[]>()

  for (const file of files.sort()) {
    const source = await fs.readFile(file, "utf8")
    const fileRel = rel(file)

    storeEdges.push(...analyzeStoreToStoreImports(file, source))
    violations.push(...analyzeSyncInternalImports(file, source))
    violations.push(...analyzeEventTransportClientImports(file, source))

    const importsTransport = extractImportSpecifiers(source, file).some(
      (item) => resolveUiModule(file, item.specifier) === TRANSPORT_CLIENT_MODULE,
    )
    if (importsTransport) transportImporters.add(fileRel)

    for (const name of collectExportedHookNames(file, source)) {
      const owners = hookNames.get(name) ?? []
      owners.push(fileRel)
      hookNames.set(name, owners)
    }
  }

  // R1 — ratchet: new edges are violations, missing allowlist entries prompt a shrink.
  const allowlist = new Set(STORE_TO_STORE_IMPORT_ALLOWLIST)
  const seenEdges = new Set<string>()
  for (const edge of storeEdges) {
    seenEdges.add(edge.edge)
    if (allowlist.has(edge.edge)) continue
    violations.push({
      file: edge.file,
      line: edge.line,
      column: edge.column,
      specifier: edge.specifier,
      rule: "R1",
      reason: `${STORE_BOUNDARY_REASONS.storeToStore} New edge: ${edge.edge}`,
    })
  }
  for (const entry of STORE_TO_STORE_IMPORT_ALLOWLIST) {
    if (seenEdges.has(entry)) continue
    warnings.push(`R1 allowlist entry no longer used — shrink STORE_TO_STORE_IMPORT_ALLOWLIST: ${entry}`)
  }

  // R3 — registered consumers that no longer import the client prompt a shrink.
  for (const consumer of EVENT_TRANSPORT_CLIENT_CONSUMERS) {
    if (transportImporters.has(consumer)) continue
    warnings.push(`R3 registered consumer no longer imports lib/event-stream/client — shrink the registry: ${consumer}`)
  }

  // R4 — duplicate exported hook names across stores/ + sync/.
  violations.push(...findDuplicateHookNames(hookNames))

  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.rule.localeCompare(b.rule) ||
      a.specifier.localeCompare(b.specifier),
  )

  return { violations, warnings }
}

async function main() {
  const warnOnly = process.argv.includes("--warn-only")
  const { violations, warnings } = await collectDesktopStoreBoundaryViolations()

  for (const warning of warnings) {
    console.warn(`Desktop store boundary check notice: ${warning}`)
  }

  if (!violations.length) {
    console.log("Desktop store boundary check passed")
    return
  }

  const level = warnOnly ? "warning" : "error"
  const log = warnOnly ? console.warn : console.error
  log(`Desktop store boundary check ${level}: ${violations.length} violation(s) found`)
  for (const item of violations) {
    log(`- [${item.rule}] ${item.file}:${item.line}:${item.column} imports ${item.specifier}: ${item.reason}`)
  }
  log(DOCS_POINTER)

  if (!warnOnly) process.exitCode = 1
}

const entry = process.argv[1]
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  })
}
