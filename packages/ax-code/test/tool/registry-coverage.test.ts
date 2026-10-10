import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

const srcRoot = path.resolve(import.meta.dirname, "../../src")
const toolRoot = path.join(srcRoot, "tool")
const registryPath = path.join(toolRoot, "registry.ts")

function walk(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

function relativeImports(source: string): string[] {
  return [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((match) => match[1]!)
}

function resolveToolImport(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = specifier.endsWith(".ts") ? [base] : [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
  return candidates.find((candidate) => candidate.startsWith(toolRoot) && walkExists(candidate))
}

function walkExists(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function toolsReachableFromRegistry(): Set<string> {
  const seen = new Set<string>()
  const pending = [registryPath]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, "utf8")
    for (const specifier of relativeImports(source)) {
      const resolved = resolveToolImport(file, specifier)
      if (resolved && !seen.has(resolved)) pending.push(resolved)
    }
  }
  return seen
}

describe("tool.registry coverage", () => {
  test("imports every builtin tool module and keeps tool ids unique", () => {
    const reachable = toolsReachableFromRegistry()
    const definitions = walk(toolRoot).filter(
      (file) => file.endsWith(".ts") && readFileSync(file, "utf8").includes("Tool.define("),
    )
    const missing = definitions
      .filter((file) => !reachable.has(file))
      .map((file) => path.relative(toolRoot, file))
    expect(missing).toEqual([])

    const ids = definitions.flatMap((file) => [
      ...readFileSync(file, "utf8").matchAll(/Tool\.define\(\s*["']([^"']+)["']/g),
    ])
    const names = ids.map((match) => match[1]!)
    expect(names).toEqual([...new Set(names)])
  })

  test("imports every tool prompt", () => {
    const sources = walk(srcRoot).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    const imported = new Set<string>()
    for (const file of sources) {
      for (const specifier of relativeImports(readFileSync(file, "utf8"))) {
        if (specifier.endsWith(".txt")) imported.add(path.basename(specifier))
      }
    }
    const prompts = walk(toolRoot)
      .filter((file) => file.endsWith(".txt"))
      .map((file) => path.basename(file))
    expect(prompts.filter((name) => !imported.has(name))).toEqual([])
  })
})
