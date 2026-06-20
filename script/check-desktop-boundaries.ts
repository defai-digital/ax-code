import path from "node:path"
import fg from "fast-glob"
import fs from "node:fs/promises"

const root = path.resolve(import.meta.dirname, "..")
const failOnViolation = process.argv.includes("--fail-on-violation")

const blockedRuntimeImports = [
  "packages/ax-code/src/session/",
  "packages/ax-code/src/provider/",
  "packages/ax-code/src/tool/",
  "packages/ax-code/src/storage/",
  "packages/ax-code/src/mcp/",
  "packages/ax-code/src/workflow/",
  "packages/ax-code/src/runtime/",
  "packages/ax-code/src/config/",
]

type Violation = {
  file: string
  specifier: string
  reason: string
}

function rel(file: string) {
  return path.relative(root, file).split(path.sep).join("/")
}

function importSpecifiers(source: string) {
  const specs = new Set<string>()
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) specs.add(match[1]!)
  for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) specs.add(match[1]!)
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.add(match[1]!)
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) specs.add(match[1]!)
  return [...specs]
}

function resolveRelativeImport(file: string, specifier: string) {
  if (!specifier.startsWith(".")) return undefined
  return rel(path.resolve(path.dirname(file), specifier))
}

function classify(file: string, specifier: string): Violation | undefined {
  const resolved = resolveRelativeImport(file, specifier)
  const candidates = [specifier, resolved].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (blockedRuntimeImports.some((blocked) => candidate.includes(blocked))) {
      return {
        file: rel(file),
        specifier,
        reason: "Desktop must use public SDK/server contracts instead of private runtime internals",
      }
    }
  }

  return undefined
}

async function main() {
  const files = await fg(["desktop/packages/**/src/**/*.{ts,tsx,js,jsx,mjs,cjs}"], {
    cwd: root,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**"],
  })

  const violations: Violation[] = []
  for (const file of files.sort()) {
    const text = await fs.readFile(file, "utf8")
    for (const specifier of importSpecifiers(text)) {
      const violation = classify(file, specifier)
      if (violation) violations.push(violation)
    }
  }

  if (!violations.length) {
    console.log("Desktop boundary check passed: no private runtime imports found")
    return
  }

  const level = failOnViolation ? "error" : "warning"
  console.log(`Desktop boundary check ${level}: ${violations.length} violation(s) found`)
  for (const violation of violations) {
    console.log(`- ${violation.file} imports ${violation.specifier}: ${violation.reason}`)
  }

  if (failOnViolation) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
