import { describe, expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pick } from "../../script/test-group"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")

describe("test group classification", () => {
  test("package unit script uses the explicit unit group runner", async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf8"))

    expect(pkg.scripts["test:unit"]).toBe("tsx script/test-groups.ts unit")
    expect(pkg.scripts["test:opentui"]).toBe("tsx script/test-groups.ts opentui")
  })

  test("provides an exact OpenTUI package regression group", () => {
    const files = [
      "test/cli/tui/opentui-spinner-renderable.test.ts",
      "test/cli/tui/opentui-spinner.test.ts",
      "test/script/opentui-package-integrity.test.ts",
      "test/session/session.test.ts",
    ]

    expect(pick(files, "opentui")).toEqual([
      "test/cli/tui/opentui-spinner-renderable.test.ts",
      "test/cli/tui/opentui-spinner.test.ts",
      "test/script/opentui-package-integrity.test.ts",
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
