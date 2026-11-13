import { describe, expect, test } from "vitest"
import { parsePastedFilePath } from "../../../src/cli/tui/component/prompt/prompt-filepath"

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

  test("decodes shell-escaped spaces in Windows drive paths", () => {
    expect(parsePastedFilePath("C:\\Program\\ Files\\App\\app.exe")).toBe("C:\\Program Files\\App\\app.exe")
    expect(parsePastedFilePath("C:\\My\\ Docs\\a.txt")).toBe("C:\\My Docs\\a.txt")
  })

  test("preserves raw Windows UNC paths", () => {
    expect(parsePastedFilePath("\\\\server\\share\\Screenshot 1.png")).toBe("\\\\server\\share\\Screenshot 1.png")
  })

  test("only strips wrapping quotes when both ends are quoted", () => {
    expect(parsePastedFilePath("'Screenshot\\ 1.png'")).toBe("Screenshot 1.png")
    expect(parsePastedFilePath("'Screenshot\\ 1.png")).toBe("'Screenshot 1.png")
    expect(parsePastedFilePath('Screenshot\\ 1.png"')).toBe('Screenshot 1.png"')
  })

  test("preserves Windows relative paths and literal backslash names", () => {
    expect(parsePastedFilePath("..\\src\\index.ts")).toBe("..\\src\\index.ts")
    expect(parsePastedFilePath("bin\\run.exe")).toBe("bin\\run.exe")
    expect(parsePastedFilePath("foo\\bar.txt")).toBe("foo\\bar.txt")
  })

  test("decodes an escaped backslash", () => {
    expect(parsePastedFilePath("foo\\\\bar.txt")).toBe("foo\\bar.txt")
  })

  test("a lone quote character is not unwrapped to an empty path", () => {
    expect(parsePastedFilePath("'")).toBe("'")
    expect(parsePastedFilePath('"')).toBe('"')
  })
})
