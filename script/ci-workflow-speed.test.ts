import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"

const toolchain = readFileSync(".github/actions/setup-ax-code-toolchain/action.yml", "utf8")
const release = readFileSync(".github/workflows/release.yml", "utf8")

describe("CI workflow speed policy", () => {
  test("the shared JS toolchain caches the pnpm store", () => {
    expect(toolchain).toContain("pnpm/action-setup@v4")
    expect(toolchain).toContain("run_install: false")
    expect(toolchain).toMatch(/cache:\s*pnpm/)
    expect(toolchain).toContain("cache-dependency-path: pnpm-lock.yaml")
  })

  test("the release workflow never cancels an in-flight publish", () => {
    expect(release).toMatch(/cancel-in-progress:\s*false/)
  })
})
