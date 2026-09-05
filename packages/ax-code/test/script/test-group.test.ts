import { describe, expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { check, list, pick } from "../../script/test-group"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")

describe("test group classification", () => {
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

  test("provides an exact AX Code TUI package regression group", () => {
    const files = [
      "test/cli/tui/tui-spinner-renderable.test.ts",
      "test/cli/tui/tui-spinner.test.ts",
      "test/script/tui-package-integrity.test.ts",
      "test/session/session.test.ts",
    ]

    expect(pick(files, "tui-renderer")).toEqual([
      "test/cli/tui/tui-spinner-renderable.test.ts",
      "test/cli/tui/tui-spinner.test.ts",
      "test/script/tui-package-integrity.test.ts",
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
