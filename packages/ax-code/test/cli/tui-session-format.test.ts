import { describe, expect, test } from "bun:test"
import { detail, diagnostics, filetype, normalize, workdir } from "../../src/cli/cmd/tui/routes/session/format"

describe("tui session format", () => {
  test("normalizes paths inside and outside cwd", () => {
    const cwd = process.cwd()
    expect(normalize(cwd)).toBe(".")
    expect(normalize("src/index.ts")).toBe("src/index.ts")
    expect(normalize("/tmp/ax-code-outside.txt")).toBe("/tmp/ax-code-outside.txt")
  })

  test("formats primitive tool input details and omits excluded keys", () => {
    expect(detail({ a: 1, b: "two", c: true, d: { nested: true } }, ["b"])).toBe("[a=1, c=true]")
    expect(detail({ nested: { ok: true } })).toBe("")
  })

  test("normalizes javascript-like filetypes to typescript", () => {
    expect(filetype("a.tsx")).toBe("typescript")
    expect(filetype("a.jsx")).toBe("typescript")
    expect(filetype("a.bash")).toBe("shellscript")
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
  })
})
