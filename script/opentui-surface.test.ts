import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TUI_OPENTUI_JSX, TUI_OPENTUI_JSX_UNUSED } from "./opentui-surface"

describe("script.opentui-surface", () => {
  test("JSX runtime types only expose the TUI allowlist", () => {
    const text = readFileSync(join("packages", "opentui-solid", "jsx-runtime.d.ts"), "utf8")
    expect(text).toContain("box: BoxProps")
    expect(text).toContain("scrollbox: ScrollBoxProps")
    expect(text).toContain("markdown: MarkdownProps")
    expect(text).toContain("code: CodeProps")
    for (const tag of TUI_OPENTUI_JSX_UNUSED) {
      expect(text).not.toContain(`${tag}:`)
    }
    expect(TUI_OPENTUI_JSX).toContain("diff")
    expect(TUI_OPENTUI_JSX).toContain("line_number")
  })
})
