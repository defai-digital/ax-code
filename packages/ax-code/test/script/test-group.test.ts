import { describe, expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { check, ciGroups, list, pick } from "../../script/test-group"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")

describe("test group classification", () => {
  test("every offline file has a CI lane, with no duplicate integration contracts", async () => {
    const files = await list()
    const workflow = await readFile(path.join(repoRoot, ".github/workflows/ax-code-ci.yml"), "utf8")
    for (const group of ciGroups) expect(workflow).toContain(`test:ci -- ${group}`)
    const automated = new Set(ciGroups.flatMap((group) => pick(files, group)))
    const live = new Set(pick(files, "live"))
    expect(files.filter((file) => !automated.has(file) && !live.has(file))).toEqual([])
    expect(pick(files, "integration").length).toBeGreaterThan(0)
    for (const file of pick(files, "integration")) {
      expect(pick(files, "runtime-contract")).not.toContain(file)
      expect(pick(files, "deterministic")).not.toContain(file)
      expect(live.has(file)).toBe(false)
    }
    expect(pick(files, "integration")).toContain("test/server/session-messages.test.ts")
    expect(pick(files, "integration")).toContain("test/pty/pty-session.test.ts")
  })

  test("rejects stale group entries instead of silently dropping renamed tests", async () => {
    const files = await list()
    expect(() => check(files.filter((file) => file !== "test/server/session-messages.test.ts"))).toThrow(
      "Missing grouped tests",
    )
  })
  test("runtime contracts include real process, permission, recovery, and plugin tests", async () => {
    const files = await list()
    expect(() => check(files)).not.toThrow()
    const contract = pick(files, "runtime-contract")
    expect(contract).toEqual(
      expect.arrayContaining([
        "test/plugin/lifecycle.test.ts",
        "test/tool/bash.test.ts",
        "test/tool/bash-background.test.ts",
        "test/tool/bash-strict-mode.test.ts",
        "test/permission/next.test.ts",
        "test/session/message-recovery.test.ts",
      ]),
    )
    expect(contract).not.toContain("test/session/structured-output-integration.test.ts")
    expect(contract).not.toContain("test/lsp/lsp-cache-integration.test.ts")
  })

  test("package unit script uses the explicit unit group runner", async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf8"))

    expect(pkg.scripts["test:unit"]).toBe("tsx script/test-groups.ts unit")
    expect(pkg.scripts["test:tui-renderer"]).toBe("tsx script/test-groups.ts tui-renderer")
  })

  test("keeps consumer TUI regressions here and framework-only tests in ax-tui", async () => {
    const files = [
      ...(await list()),
      "test/cli/tui/tui-spinner-renderable.test.ts",
      "test/cli/tui/tui-spinner.test.ts",
      "test/script/tui-package-integrity.test.ts",
    ]

    expect(pick(files, "tui-renderer").sort()).toEqual([
      "test/cli/tui/render-anti-patterns.test.ts",
      "test/cli/tui/tui-ffi-coordinate-guard.test.ts",
      "test/cli/tui/tui-ffi-pointer-pin.test.ts",
      "test/script/build-deps.test.ts",
      "test/script/check-tui-layering.test.ts",
      "test/script/esbuild-solid-plugin.test.ts",
      "test/script/tui-dist.test.ts",
      "test/script/tui-startup-smoke.test.ts",
      "test/script/workspace-metadata.test.ts",
    ])
  })

  test("keeps module-mocking tests out of same-process deterministic groups", () => {
    const files = [
      "test/code-intelligence/query-native-dispatch.test.ts",
      "test/code-intelligence/query.test.ts",
      "test/session/structured-output-integration.test.ts",
    ]

    expect(pick(files, "e2e")).toContain("test/code-intelligence/query-native-dispatch.test.ts")
    expect(pick(files, "deterministic")).not.toContain("test/code-intelligence/query-native-dispatch.test.ts")
    expect(pick(files, "unit")).not.toContain("test/code-intelligence/query-native-dispatch.test.ts")
  })

  test("keeps quarantined heavy integration tests out of deterministic groups", () => {
    const files = [
      "test/lsp/lsp-cache-integration.test.ts",
      "test/code-intelligence/builder.test.ts",
      "test/control-plane/sse.test.ts",
      "test/lsp/cache.test.ts",
    ]

    expect(pick(files, "deterministic")).toEqual(["test/lsp/cache.test.ts"])
    expect(pick(files, "unit")).toEqual(["test/lsp/cache.test.ts"])
  })
})
