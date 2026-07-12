import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fg from "fast-glob"
import { extractImportSpecifiers, type ImportSpecifier } from "./import-specifiers"

const root = path.resolve(import.meta.dirname, "..")

const desktopSourceGlobs = [
  "desktop/packages/ui/src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
  "desktop/packages/web/{src,server,bin}/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
  "desktop/packages/electron/{src,scripts}/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
]

const blockedRuntimeAreas = ["session", "provider", "tool", "storage", "mcp", "workflow", "runtime", "config"]

const allowedUiEntrypoints = new Set([
  "@openchamber/ui/main",
  "@openchamber/ui/index.css",
  "@openchamber/ui/styles/fonts",
  "@openchamber/ui/terminalApi",
  "@openchamber/ui/api/endpoints",
  "@openchamber/ui/api/gitApiHttp",
  "@openchamber/ui/api/types",
  "@openchamber/ui/apps/renderElectronMiniChatApp",
])

const uiForbiddenDependencies = [
  "electron",
  "electron-updater",
  "express",
  "http-proxy-middleware",
  "node-pty",
  "simple-git",
]

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

export const DESKTOP_BOUNDARY_REASONS = {
  privateRuntime: "Desktop must use public SDK/server contracts instead of private AX Code runtime internals",
  privateUi: "Desktop packages must use documented @openchamber/ui entrypoints",
  webUiAlias: "The web package must not use the @/ alias because it resolves directly into UI source",
  siblingSource: "Desktop packages must not import a sibling package's source tree",
  sdkInternals: "Desktop must use public @ax-code/sdk exports instead of SDK src/dist internals",
  uiDependency: "The UI package must not declare server or desktop-shell dependencies",
} as const

export type DesktopBoundaryViolation = {
  file: string
  line: number
  column: number
  specifier: string
  reason: string
  sourceLine?: string
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

function desktopPackage(file: string) {
  return rel(file).match(/^desktop\/packages\/([^/]+)(?:\/|$)/)?.[1]
}

function resolveRelativeImport(file: string, specifier: string) {
  if (!specifier.startsWith(".")) return undefined
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0] ?? specifier
  const absoluteFile = path.isAbsolute(file) ? file : path.resolve(root, file)
  return rel(path.resolve(path.dirname(absoluteFile), cleanSpecifier))
}

function isPrivateRuntimeImport(candidate: string) {
  return blockedRuntimeAreas.some(
    (area) =>
      hasPathPrefix(candidate, `packages/ax-code/src/${area}`) ||
      hasPathPrefix(candidate, `ax-code/src/${area}`) ||
      hasPathPrefix(candidate, `ax-code/${area}`),
  )
}

function isSdkInternalImport(candidate: string) {
  return ["@ax-code/sdk/src", "@ax-code/sdk/dist", "packages/sdk/js/src", "packages/sdk/js/dist"].some((prefix) =>
    hasPathPrefix(candidate, prefix),
  )
}

function siblingSourcePackage(file: string, resolved: string | undefined) {
  if (!resolved) return undefined
  const target = resolved.match(/^desktop\/packages\/([^/]+)\/src(?:\/|$)/)?.[1]
  if (!target || target === desktopPackage(file)) return undefined
  return target
}

function violation(
  file: string,
  item: ImportSpecifier,
  reason: string,
  sourceLines: readonly string[],
): DesktopBoundaryViolation {
  return {
    file: rel(file),
    line: item.line,
    column: item.column,
    specifier: item.specifier,
    reason,
    sourceLine: sourceLines[item.line - 1]?.trim(),
  }
}

export function analyzeDesktopSource(file: string, source: string) {
  const violations: DesktopBoundaryViolation[] = []
  const owner = desktopPackage(file)
  const sourceLines = source.split(/\r?\n/)

  for (const item of extractImportSpecifiers(source, file)) {
    const specifier = normalize(item.specifier)
    const resolved = resolveRelativeImport(file, item.specifier)
    const candidates = resolved ? [specifier, resolved] : [specifier]

    if (candidates.some(isPrivateRuntimeImport)) {
      violations.push(violation(file, item, DESKTOP_BOUNDARY_REASONS.privateRuntime, sourceLines))
    }

    if (candidates.some(isSdkInternalImport)) {
      violations.push(violation(file, item, DESKTOP_BOUNDARY_REASONS.sdkInternals, sourceLines))
    }

    if (owner !== "ui" && specifier.startsWith("@openchamber/ui/") && !allowedUiEntrypoints.has(specifier)) {
      violations.push(violation(file, item, DESKTOP_BOUNDARY_REASONS.privateUi, sourceLines))
    }

    if (owner === "web" && hasPathPrefix(specifier, "@")) {
      violations.push(violation(file, item, DESKTOP_BOUNDARY_REASONS.webUiAlias, sourceLines))
    }

    if (siblingSourcePackage(file, resolved)) {
      violations.push(violation(file, item, DESKTOP_BOUNDARY_REASONS.siblingSource, sourceLines))
    }
  }

  return violations
}

function dependencyLine(source: string, name: string) {
  const index = source.split(/\r?\n/).findIndex((line) => line.includes(`"${name}"`))
  return index < 0 ? 1 : index + 1
}

export function analyzeDesktopManifest(file: string, source: string) {
  if (rel(file) !== "desktop/packages/ui/package.json") return []

  const manifest = JSON.parse(source) as Record<string, unknown>
  const violations: DesktopBoundaryViolation[] = []

  for (const field of dependencyFields) {
    const dependencies = manifest[field]
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue

    for (const name of uiForbiddenDependencies) {
      if (!Object.hasOwn(dependencies, name)) continue
      violations.push({
        file: rel(file),
        line: dependencyLine(source, name),
        column: 1,
        specifier: name,
        reason: DESKTOP_BOUNDARY_REASONS.uiDependency,
      })
    }
  }

  return violations
}

export async function collectDesktopBoundaryViolations() {
  const files = await fg(desktopSourceGlobs, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/resources/**"],
  })

  const violations: DesktopBoundaryViolation[] = []
  for (const file of files.sort()) {
    violations.push(...analyzeDesktopSource(file, await fs.readFile(file, "utf8")))
  }

  const uiManifest = path.join(root, "desktop/packages/ui/package.json")
  violations.push(...analyzeDesktopManifest(uiManifest, await fs.readFile(uiManifest, "utf8")))

  return violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.specifier.localeCompare(b.specifier) ||
      a.reason.localeCompare(b.reason),
  )
}

async function main() {
  const warnOnly = process.argv.includes("--warn-only")
  const violations = await collectDesktopBoundaryViolations()

  if (!violations.length) {
    console.log("Desktop boundary check passed")
    return
  }

  const level = warnOnly ? "warning" : "error"
  const log = warnOnly ? console.warn : console.error
  log(`Desktop boundary check ${level}: ${violations.length} violation(s) found`)
  for (const item of violations) {
    log(`- ${item.file}:${item.line}:${item.column} imports ${item.specifier}: ${item.reason}`)
  }

  if (!warnOnly) process.exitCode = 1
}

const entry = process.argv[1]
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  })
}
