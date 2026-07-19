import path from "node:path"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { assertDesktopReadFileAllowed, isInsideOrSameDirectory } = require("./desktop-read-file-policy.js")

describe("desktop read file policy", () => {
  test("allows Windows home paths that differ only by drive-letter or segment case", () => {
    expect(() =>
      assertDesktopReadFileAllowed("c:\\users\\alice\\project\\README.md", {
        home: "C:\\Users\\Alice",
        tmp: "C:\\Users\\Alice\\AppData\\Local\\Temp",
        pathTools: path.win32,
      }),
    ).not.toThrow()
  })

  test("rejects Windows sibling paths outside the home allowlist", () => {
    expect(() =>
      assertDesktopReadFileAllowed("C:\\Users\\Alice2\\project\\README.md", {
        home: "C:\\Users\\Alice",
        tmp: "C:\\Users\\Alice\\AppData\\Local\\Temp",
        pathTools: path.win32,
      }),
    ).toThrow("File is outside the allowed workspace")
  })

  test("keeps denying secret directories after path normalization", () => {
    expect(() =>
      assertDesktopReadFileAllowed("C:\\Users\\Alice\\.ssh\\id_rsa", {
        home: "C:\\Users\\Alice",
        tmp: "C:\\Users\\Alice\\AppData\\Local\\Temp",
        pathTools: path.win32,
      }),
    ).toThrow("Access to this path is not allowed")
  })

  test("keeps denying secret-looking filenames outside denied directories", () => {
    expect(() =>
      assertDesktopReadFileAllowed("/Users/alice/project/private.pem", {
        home: "/Users/alice",
        tmp: "/tmp",
        pathTools: path.posix,
      }),
    ).toThrow("Access to this path is not allowed")
  })

  test("denies credential stores and browser profiles under home", () => {
    const options = { home: "/Users/alice", tmp: "/tmp", pathTools: path.posix }
    for (const target of [
      "/Users/alice/.netrc",
      "/Users/alice/.npmrc",
      "/Users/alice/.docker/config.json",
      "/Users/alice/.kube/config",
      "/Users/alice/.config/gh/hosts.yml",
      "/Users/alice/Library/Application Support/Google/Chrome/Default/Cookies",
    ]) {
      expect(() => assertDesktopReadFileAllowed(target, options)).toThrow("Access to this path is not allowed")
    }
  })

  test("allows temp files outside home", () => {
    expect(() =>
      assertDesktopReadFileAllowed("/tmp/ax-code/screenshot.png", {
        home: "/Users/alice",
        tmp: "/tmp",
        pathTools: path.posix,
      }),
    ).not.toThrow()
  })

  test("treats a sibling prefix as outside", () => {
    expect(isInsideOrSameDirectory("/tmp/project", "/tmp/project-copy/file.txt", path.posix)).toBe(false)
  })
})
