import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { assertShellOpenPathSucceeded, collectOpenPathCandidates, normalizeCandidate } = require("./open-paths.js")

describe("normalizeCandidate", () => {
  test("resolves relative paths against cwd", () => {
    expect(
      normalizeCandidate("repo", {
        cwd: "/Users/example/work",
        platform: "darwin",
      }),
    ).toBe("/Users/example/work/repo")
  })

  test("decodes file urls", () => {
    expect(
      normalizeCandidate("file:///Users/example/My%20Repo", {
        cwd: "/tmp",
        platform: "darwin",
      }),
    ).toBe("/Users/example/My Repo")
  })

  test("rejects flags, non-file urls, and the app executable", () => {
    expect(
      normalizeCandidate("--inspect", {
        cwd: "/tmp",
        platform: "darwin",
      }),
    ).toBeNull()
    expect(
      normalizeCandidate("https://example.com/repo", {
        cwd: "/tmp",
        platform: "darwin",
      }),
    ).toBeNull()
    expect(
      normalizeCandidate("/Applications/AX Code.app/Contents/MacOS/AX Code", {
        cwd: "/tmp",
        platform: "darwin",
        appExecutablePath: "/Applications/AX Code.app/Contents/MacOS/AX Code",
      }),
    ).toBeNull()
  })

  test("rejects the app executable case-insensitively on Windows", () => {
    expect(
      normalizeCandidate("c:\\program files\\ax code\\ax code.exe", {
        cwd: "C:\\Users\\Example",
        platform: "win32",
        appExecutablePath: "C:\\Program Files\\AX Code\\AX Code.exe",
      }),
    ).toBeNull()
  })
})

describe("collectOpenPathCandidates", () => {
  test("deduplicates candidates with platform path semantics", () => {
    expect(
      collectOpenPathCandidates(
        ["C:\\Users\\Example\\Repo", "c:\\Users\\Example\\Repo", "--enable-logging", "nested"],
        {
          cwd: "C:\\Users\\Example",
          platform: "win32",
          appExecutablePath: "C:\\Program Files\\AX Code\\AX Code.exe",
        },
      ),
    ).toEqual(["C:\\Users\\Example\\Repo", "C:\\Users\\Example\\nested"])
  })
})

describe("assertShellOpenPathSucceeded", () => {
  test("accepts Electron shell.openPath success values", () => {
    expect(() => assertShellOpenPathSucceeded("")).not.toThrow()
    expect(() => assertShellOpenPathSucceeded(undefined)).not.toThrow()
  })

  test("throws Electron shell.openPath failure messages", () => {
    expect(() => assertShellOpenPathSucceeded("The system cannot find the file specified.")).toThrow(
      "The system cannot find the file specified.",
    )
  })
})
