import { describe, expect, test } from "vitest"
import { pick } from "../../script/test-group"

describe("test group classification", () => {
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
