import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

// Import-boundary invariant (ADR Decision 1 / gate AC10): the reusable `core` must
// not import the filesystem, child processes, the network, or any AX Code runtime
// module. It may use purely-functional Node stdlib (node:path, node:crypto, Buffer).
// This test statically scans the core module sources for forbidden import specifiers.

const srcDir = path.dirname(fileURLToPath(new URL("../src/core.ts", import.meta.url)))

const CORE_FILES = [
  "core.ts",
  "types.ts",
  "contracts.ts",
  "ports.ts",
  "paths.ts",
  "hash.ts",
  "glob.ts",
  "plan.ts",
  "protected.ts",
  "frontmatter.ts",
  "validate.ts",
  "build-pure.ts",
]

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+["']node:fs/, reason: "core must not import node:fs" },
  { pattern: /from\s+["']node:child_process/, reason: "core must not import node:child_process" },
  { pattern: /from\s+["']node:net/, reason: "core must not import node:net" },
  { pattern: /from\s+["']node:os/, reason: "core must not import node:os" },
  { pattern: /from\s+["']@ax-code\/ax-code/, reason: "core must not import AX Code runtime" },
  { pattern: /from\s+["']\.\.\//, reason: "core must not import outside the package" },
]

describe("import boundary: core subpath is pure", () => {
  for (const file of CORE_FILES) {
    test(`${file} has no fs/child_process/net/os/AX-Code imports`, () => {
      const text = readFileSync(path.join(srcDir, file), "utf8")
      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        expect(text, `${file}: ${reason}`).not.toMatch(pattern)
      }
    })
  }

  test("node-only modules are the ones that touch the filesystem", () => {
    // Guard against accidentally moving an fs import into core later: build.ts (node)
    // is expected to import node:fs, proving the partition is meaningful.
    const buildText = readFileSync(path.join(srcDir, "build.ts"), "utf8")
    expect(buildText).toMatch(/from\s+["']node:fs\/promises["']/)
  })
})
