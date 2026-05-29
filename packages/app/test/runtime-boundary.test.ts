import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"

const rawBackendPrimitivePatterns = [
  /\bfetch\s*\(/,
  /\bnew\s+EventSource\s*\(/,
  /\bnew\s+WebSocket\s*\(/,
  /\bXMLHttpRequest\b/,
]

const allowedRawBackendPrimitiveFiles = new Set([
  "src/performance/live-backend-qa.ts",
  "src/runtime/status-report.ts",
])

describe("app runtime backend boundary", () => {
  test("keeps renderer backend traffic behind SDK/headless contracts", async () => {
    const packageRoot = path.resolve(import.meta.dirname, "..")
    const violations: string[] = []

    for await (const file of new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: packageRoot, absolute: false })) {
      if (allowedRawBackendPrimitiveFiles.has(file)) continue
      const source = readFileSync(path.join(packageRoot, file), "utf8")
      for (const pattern of rawBackendPrimitivePatterns) {
        if (pattern.test(source)) violations.push(`${file}: ${pattern.source}`)
      }
    }

    expect(violations).toEqual([])
  })
})
