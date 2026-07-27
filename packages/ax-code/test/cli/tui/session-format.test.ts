import { describe, expect, test } from "vitest"
import path from "node:path"
import { capLines, detail, diagnostics, filetype, normalize, workdir } from "../../../src/cli/cmd/tui/routes/session/format"

describe("tui session format", () => {
  test("normalizes paths inside and outside cwd", () => {
    const cwd = process.cwd()
    expect(normalize(cwd)).toBe(".")
    expect(normalize("src/index.ts")).toBe("src/index.ts")
    expect(normalize("/tmp/ax-code-outside.txt")).toBe("/tmp/ax-code-outside.txt")
  })

  test("normalizes cwd-local paths whose first segment starts with dots", () => {
    const local = path.join(process.cwd(), "..cache", "trace.log")
    expect(normalize(local)).toBe("..cache/trace.log")
  })

  test("formats primitive tool input details and omits excluded keys", () => {
    expect(detail({ a: 1, b: "two", c: true, d: { nested: true } }, ["b"])).toBe("[a=1, c=true]")
    expect(detail({ nested: { ok: true } })).toBe("")
  })

  test("normalizes javascript-like filetypes to typescript", () => {
    expect(filetype("a.tsx")).toBe("typescript")
    expect(filetype("a.jsx")).toBe("typescript")
    expect(filetype("a.bash")).toBe("shellscript")
    expect(filetype("a.unknown")).toBe("none")
    expect(filetype()).toBe("none")
  })

  test("limits diagnostics to top three errors for the normalized path", () => {
    const file = "/tmp/demo.ts"
    expect(
      diagnostics(
        {
          [file]: [
            { severity: 1, message: "a" },
            { severity: 2, message: "skip" },
            { severity: 1, message: "b" },
            { severity: 1, message: "c" },
            { severity: 1, message: "d" },
          ],
        },
        file,
      ).map((item) => item.message),
    ).toEqual(["a", "b", "c"])
  })

  test("formats bash workdir relative to base and home", () => {
    expect(workdir("/repo", "/Users/demo", ".")).toBeUndefined()
    expect(workdir("/repo", "/Users/demo", "apps/web")).toBe("/repo/apps/web")
    expect(workdir("/Users/demo/project", "/Users/demo", "docs")).toBe("~/project/docs")
    expect(workdir("/Users/demo-other", "/Users/demo", "project")).toBe("/Users/demo-other/project")
  })

  test("caps expanded tool output and reports the full line count", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`)
    const capped = capLines(lines, 500)
    expect(capped.truncated).toBe(true)
    expect(capped.total).toBe(600)
    expect(capped.text.split("\n")).toHaveLength(500)
    expect(capped.text.endsWith("line 500")).toBe(true)
  })

  test("passes output through when it fits the expanded cap", () => {
    const small = capLines(["a", "b"], 500)
    expect(small.truncated).toBe(false)
    expect(small.total).toBe(2)
    expect(small.text).toBe("a\nb")
    expect(capLines([], 500)).toEqual({ text: "", total: 0, truncated: false })
  })
})
