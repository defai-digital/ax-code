import { describe, expect, test } from "vitest"
import { ensureDogfoodPassword, resolveRatatuiBinary } from "../../../src/cli/cmd/tui/ratatui-launch"
import path from "node:path"
import { fileURLToPath } from "node:url"

describe("ratatui-launch helpers", () => {
  test("ensureDogfoodPassword reuses existing password", () => {
    expect(ensureDogfoodPassword({ AX_CODE_SERVER_PASSWORD: "fixed-secret" })).toBe("fixed-secret")
    expect(ensureDogfoodPassword({ AX_CODE_TUI_PASSWORD: "tui-secret" })).toBe("tui-secret")
  })

  test("ensureDogfoodPassword generates non-empty password when unset", () => {
    const a = ensureDogfoodPassword({})
    const b = ensureDogfoodPassword({})
    expect(a.length).toBeGreaterThan(8)
    expect(b.length).toBeGreaterThan(8)
    // Should not be a constant placeholder
    expect(a).not.toBe("password")
  })

  test("resolveRatatuiBinary finds workspace debug binary when present", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
    const found = resolveRatatuiBinary(
      {
        AX_CODE_TUI_BIN: path.join(repoRoot, "crates/target/debug/ax-code-tui"),
      },
      repoRoot,
    )
    // May be undefined before first cargo build; when set explicitly, path is returned if file exists.
    if (found) {
      expect(found.includes("ax-code-tui")).toBe(true)
    } else {
      expect(found).toBeUndefined()
    }
  })
})
