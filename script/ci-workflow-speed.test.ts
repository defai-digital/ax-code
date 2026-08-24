import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"

const toolchain = readFileSync(".github/actions/setup-ax-code-toolchain/action.yml", "utf8")
const desktop = readFileSync(".github/workflows/desktop-ci.yml", "utf8")
const release = readFileSync(".github/workflows/release.yml", "utf8")
const desktopRelease = readFileSync(".github/workflows/desktop-release.yml", "utf8")

describe("CI workflow speed policy", () => {
  test("the shared JS toolchain caches the pnpm store", () => {
    expect(toolchain).toContain("pnpm/action-setup@v4")
    expect(toolchain).toContain("run_install: false")
    expect(toolchain).toMatch(/cache:\s*pnpm/)
    expect(toolchain).toContain("cache-dependency-path: pnpm-lock.yaml")
  })

  test("Desktop unit checks run on Ubuntu while macOS keeps the packaged smoke", () => {
    expect(desktop).toContain("runs-on: ubuntu-latest")
    expect(desktop).toContain("desktop-macos:")
    expect(desktop).toContain("runs-on: macos-latest")
    expect(desktop).toContain("pnpm run desktop:test")
    expect(desktop).toContain("pnpm run desktop:build")
    expect(desktop.indexOf("pnpm run desktop:test")).toBeLessThan(desktop.indexOf("desktop-macos:"))
    expect(desktop.indexOf("pnpm run desktop:build")).toBeGreaterThan(desktop.indexOf("desktop-macos:"))
  })

  test("release workflows never cancel an in-flight publish", () => {
    expect(release).toMatch(/cancel-in-progress:\s*false/)
    expect(desktopRelease).toMatch(/cancel-in-progress:\s*false/)
  })
})
