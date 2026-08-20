import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AX_TUI_JSX, AX_TUI_JSX_UNUSED } from "./tui-surface"

describe("script.tui-surface", () => {
  test("JSX runtime types only expose the TUI allowlist", () => {
    const text = readFileSync(join("packages", "ax-code-tui", "solid", "jsx-runtime.d.ts"), "utf8")
    expect(text).toContain("box: BoxProps")
    expect(text).toContain("scrollbox: ScrollBoxProps")
    expect(text).toContain("markdown: MarkdownProps")
    expect(text).toContain("code: CodeProps")
    for (const tag of AX_TUI_JSX_UNUSED) {
      expect(text).not.toContain(`${tag}:`)
    }
    expect(AX_TUI_JSX).toContain("diff")
    expect(AX_TUI_JSX).toContain("line_number")
  })
})
