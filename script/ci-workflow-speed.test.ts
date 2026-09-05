import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"

const toolchain = readFileSync(".github/actions/setup-ax-code-toolchain/action.yml", "utf8")
const release = readFileSync(".github/workflows/release.yml", "utf8")
const ci = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")

describe("CI workflow speed policy", () => {
  test("runtime contracts run in a bounded lane with their own report and no retries", () => {
    const lane = ci.match(/^  runtime-contract:\n[\s\S]*?(?=^  \w[\w-]*:|$(?![\s\S]))/m)?.[0]
    expect(lane).toBeDefined()
    expect(lane).toContain("timeout-minutes: 15")
    expect(lane).toContain('AX_TEST_MAX_WORKERS: "2"')
    expect(lane).toContain('node-version: "24"')
    expect(lane).toContain("test:ci -- runtime-contract --rerun-on-fail 0")
    expect(lane).toContain("name: ax-code-runtime-contract-report")
    expect(lane).toContain("if-no-files-found: error")
    for (const file of ["test-ci.ts", "test-groups.ts"]) {
      const source = readFileSync(`packages/ax-code/script/${file}`, "utf8")
      expect(source).toContain('"--retry=0"')
    }
  })

  test("the shared JS toolchain caches the pnpm store", () => {
    expect(toolchain).toContain("pnpm/action-setup@v4")
    expect(toolchain).toContain("run_install: false")
    expect(toolchain).toMatch(/cache:\s*pnpm/)
    expect(toolchain).toContain("cache-dependency-path: pnpm-lock.yaml")
  })

  test("the release workflow never cancels an in-flight publish", () => {
    expect(release).toMatch(/cancel-in-progress:\s*false/)
  })

  test("the release workflow runs the self-scan before deterministic tests", () => {
    const scan = release.indexOf("pnpm run check:self-scan")
    const deterministic = release.indexOf("test:ci -- deterministic")
    expect(scan).toBeGreaterThan(-1)
    expect(deterministic).toBeGreaterThan(scan)
  })
})
