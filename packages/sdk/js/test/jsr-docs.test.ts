import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

type JsrManifest = {
  exports: Record<string, string>
}

const packageRoot = resolve(import.meta.dirname, "..")
const jsrJson = JSON.parse(readFileSync(resolve(packageRoot, "jsr.json"), "utf8")) as JsrManifest

const EXPORT_RE =
  /^export (?:declare )?(?:async )?(?:abstract class|class|interface|type|const|let|var|enum|function|namespace) ([A-Za-z0-9_]+)/
const STAR_RE = /^export type \* from "([^"]+)"/
const STAR2_RE = /^export \* from "([^"]+)"/
const NAMED_RE = /^export (?:type )?\{([^}]+)\}(?: from "([^"]+)")?/

function hasLeadingDoc(lines: string[], index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const trimmed = lines[j].trim()
    if (trimmed === "") continue
    return trimmed.endsWith("*/")
  }
  return false
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec)
  const withoutJs = base.replace(/\.js$/, "")
  const candidates = [`${withoutJs}.d.ts`, `${withoutJs}.ts`, `${base}.d.ts`, `${base}.ts`, base]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function sourceForExport(target: string): string {
  return join(packageRoot, target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"))
}

type SymbolRecord = { name: string; file: string; documented: boolean }

function analyzeFile(file: string, seen = new Set<string>()): SymbolRecord[] {
  if (seen.has(file) || !existsSync(file)) return []
  seen.add(file)
  const lines = readFileSync(file, "utf8").split("\n")
  const out: SymbolRecord[] = []
  const rel = relative(packageRoot, file)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart()
    const star = line.match(STAR_RE) ?? line.match(STAR2_RE)
    if (star) {
      const target = resolveImport(file, star[1])
      if (target) out.push(...analyzeFile(target, seen))
      continue
    }

    const named = line.match(NAMED_RE)
    if (named?.[2]) {
      const target = resolveImport(file, named[2])
      const names = named[1]
        .split(",")
        .map((part) =>
          part
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)
            .pop()
            ?.trim(),
        )
        .filter((name): name is string => Boolean(name) && name !== "*")
      if (!target) {
        out.push(...names.map((name) => ({ name, file: rel, documented: false })))
        continue
      }
      const origin = new Map(analyzeFile(target, new Set()).map((symbol) => [symbol.name, symbol.documented]))
      for (const name of names) {
        out.push({ name, file: relative(packageRoot, target), documented: origin.get(name) === true })
      }
      continue
    }

    const match = line.match(EXPORT_RE)
    if (!match) continue
    out.push({ name: match[1], file: rel, documented: hasLeadingDoc(lines, i) })
  }
  return out
}

describe("JSR documentation score contract", () => {
  test("every named entrypoint has a module doc with @module", () => {
    const missing: string[] = []
    for (const [entry, target] of Object.entries(jsrJson.exports)) {
      if (entry === ".") continue
      const source = sourceForExport(target)
      expect(existsSync(source), `missing source for ${entry}: ${source}`).toBe(true)
      const text = readFileSync(source, "utf8")
      const header = text.slice(0, 1200)
      if (!/\/\*\*[\s\S]*@module\b/.test(header)) missing.push(entry)
    }
    expect(missing, `entrypoints missing @module: ${missing.join(", ")}`).toEqual([])
  })

  test("keeps the default entrypoint free of @module so JSR Overview shows README.md", () => {
    const source = sourceForExport(jsrJson.exports["."])
    const header = readFileSync(source, "utf8").slice(0, 1200)
    expect(header).not.toMatch(/@module\b/)
    expect(header.startsWith("/**")).toBe(true)
  })

  test("documents at least 80% of exported symbols across JSR entrypoints", () => {
    const documented: SymbolRecord[] = []
    const undocumented: SymbolRecord[] = []
    for (const target of Object.values(jsrJson.exports)) {
      for (const symbol of analyzeFile(sourceForExport(target))) {
        if (symbol.documented) documented.push(symbol)
        else undocumented.push(symbol)
      }
    }
    const total = documented.length + undocumented.length
    const percent = total === 0 ? 100 : (100 * documented.length) / total
    const preview = undocumented
      .slice(0, 20)
      .map((symbol) => `${symbol.file}#${symbol.name}`)
      .join(", ")
    expect(
      percent,
      `documented ${documented.length}/${total} (${percent.toFixed(1)}%). Missing: ${preview}`,
    ).toBeGreaterThanOrEqual(80)
  })

  test("documents every handwritten public export", () => {
    const generated = new Set(["./v2", "./v2/client", "./v2/gen/client"])
    const missing: string[] = []
    for (const [entry, target] of Object.entries(jsrJson.exports)) {
      if (generated.has(entry)) continue
      for (const symbol of analyzeFile(sourceForExport(target))) {
        if (!symbol.documented) missing.push(`${entry} ${symbol.file}#${symbol.name}`)
      }
    }
    expect(missing, `undocumented handwritten exports:\n${missing.join("\n")}`).toEqual([])
  })

  test("README is the public JSR overview and contains an install example", () => {
    const readme = readFileSync(resolve(packageRoot, "README.md"), "utf8")
    expect(readme).toContain("# @defai-digital/ax-code-sdk")
    expect(readme).toContain("pnpm add jsr:@defai-digital/ax-code-sdk@")
    expect(readme).toContain("```ts")
    expect(readme).not.toMatch(/first public version has not been published/i)
    expect(readme).not.toMatch(/^Status:/m)
    expect(readme).toContain(
      "https://github.com/defai-digital/ax-code/blob/HEAD/packages/sdk/js/example/headless-app.ts",
    )
  })
})
