import { describe, expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { classify } from "../../src/permission/risk-classes"

/**
 * Every permission name a tool emits under src/tool/ must be classified by
 * the risk-class table. An unclassified name falls into "unknown", which
 * fail-closes into an unexpected user prompt — a silent regression the
 * compiler cannot catch when a new tool ships.
 */
function collectToolPermissionNames(toolRoot: string): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith(".ts")) continue
      const source = fs.readFileSync(full, "utf8")
      for (const match of source.matchAll(/permission:\s*"([a-zA-Z0-9_-]+)"/g)) {
        const name = match[1]!
        if (!found.has(name)) found.set(name, path.relative(toolRoot, full))
      }
    }
  }
  walk(toolRoot)
  return found
}

describe("permission risk-class coverage", () => {
  test("every permission name emitted by src/tool tools is classified", () => {
    const toolRoot = path.join(import.meta.dirname, "..", "..", "src", "tool")
    const names = collectToolPermissionNames(toolRoot)
    expect(names.size).toBeGreaterThan(10)

    const unclassified: string[] = []
    for (const [name, file] of names) {
      if (classify(name) === "unknown") unclassified.push(`${name} (emitted in ${file})`)
    }
    expect(unclassified).toEqual([])
  })
})
