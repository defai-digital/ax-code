import { describe, expect, test } from "bun:test"
import { parsePastedFilePath } from "../../../src/cli/cmd/tui/component/prompt/prompt-filepath"

describe("parsePastedFilePath", () => {
  test("decodes shell-escaped macOS iCloud paths", () => {
    expect(
      parsePastedFilePath(
        "/Users/akiralam/Library/Mobile\\ Documents/com\\~apple\\~CloudDocs/Desktop/Screenshot\\ 2026-05-04.png",
      ),
    ).toBe("/Users/akiralam/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Screenshot 2026-05-04.png")
  })

  test("decodes shell-escaped linux paths", () => {
    expect(parsePastedFilePath("/home/me/Pictures/Screenshot\\ \\(1\\).png")).toBe(
      "/home/me/Pictures/Screenshot (1).png",
    )
  })

  test("preserves raw Windows drive paths", () => {
    expect(parsePastedFilePath("C:\\Users\\me\\Desktop\\Screenshot 1.png")).toBe(
      "C:\\Users\\me\\Desktop\\Screenshot 1.png",
    )
  })

  test("preserves raw Windows UNC paths", () => {
    expect(parsePastedFilePath("\\\\server\\share\\Screenshot 1.png")).toBe("\\\\server\\share\\Screenshot 1.png")
  })

  test("only strips wrapping quotes when both ends are quoted", () => {
    expect(parsePastedFilePath("'Screenshot\\ 1.png'")).toBe("Screenshot 1.png")
    expect(parsePastedFilePath("'Screenshot\\ 1.png")).toBe("'Screenshot 1.png")
    expect(parsePastedFilePath('Screenshot\\ 1.png"')).toBe('Screenshot 1.png"')
  })
})
