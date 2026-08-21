import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { assertWikiDirectorySafe, normalizePath, resolveInside, safeRelativePath, sanitizeWikiDir } from "../src"

describe("AX Wiki path containment", () => {
  test("sanitizeWikiDir falls back for unsafe or empty input", () => {
    expect(sanitizeWikiDir(undefined)).toBe("ax-wiki")
    expect(sanitizeWikiDir("")).toBe("ax-wiki")
    expect(sanitizeWikiDir("   ")).toBe("ax-wiki")
    expect(sanitizeWikiDir("/etc/passwd")).toBe("ax-wiki")
    expect(sanitizeWikiDir("C:/wiki")).toBe("ax-wiki")
    expect(sanitizeWikiDir("../outside")).toBe("ax-wiki")
    expect(sanitizeWikiDir("a/../b")).toBe("ax-wiki")
    expect(sanitizeWikiDir(".")).toBe("ax-wiki")
    expect(sanitizeWikiDir("/abs", "custom")).toBe("custom")
  })

  test("sanitizeWikiDir normalizes safe relative input", () => {
    expect(sanitizeWikiDir("docs/wiki")).toBe("docs/wiki")
    expect(sanitizeWikiDir("./wiki")).toBe("wiki")
    expect(sanitizeWikiDir("a//b/./c")).toBe("a/b/c")
    expect(sanitizeWikiDir("docs\\wiki")).toBe("docs/wiki")
  })

  test("safeRelativePath rejects absolute and escaping paths", () => {
    expect(safeRelativePath("a/b.md")).toBe("a/b.md")
    expect(safeRelativePath("./a")).toBe("a")
    expect(safeRelativePath("a\\b")).toBe("a/b")
    expect(safeRelativePath("")).toBeUndefined()
    expect(safeRelativePath(".")).toBeUndefined()
    expect(safeRelativePath("/abs")).toBeUndefined()
    expect(safeRelativePath("C:/x")).toBeUndefined()
    expect(safeRelativePath("../x")).toBeUndefined()
    expect(safeRelativePath("a/../b")).toBeUndefined()
  })

  test("resolveInside keeps paths inside the root", () => {
    expect(resolveInside("/repo", "a/b")).toBe(path.resolve("/repo", "a/b"))
    expect(resolveInside("/repo", ".")).toBe(path.resolve("/repo"))
    expect(() => resolveInside("/repo", "../escape")).toThrow("escapes repository root")
    // Prefix-sibling trap: naive startsWith("/repo") would accept "/repo-other".
    expect(() => resolveInside("/repo", "../repo-other/x")).toThrow("escapes repository root")
  })

  test("normalizePath converts separators and strips leading ./", () => {
    expect(normalizePath("a\\b")).toBe("a/b")
    expect(normalizePath("./a")).toBe("a")
  })
})

describe("assertWikiDirectorySafe", () => {
  let tmp: string

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-safety-"))
  })

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test("accepts missing and real directory output paths", async () => {
    await expect(assertWikiDirectorySafe(tmp, "not/there/yet")).resolves.toBeUndefined()
    await mkdir(path.join(tmp, "docs", "wiki"), { recursive: true })
    await expect(assertWikiDirectorySafe(tmp, "docs/wiki")).resolves.toBeUndefined()
  })

  test("rejects symlinked output segments", async () => {
    await mkdir(path.join(tmp, "real"), { recursive: true })
    await symlink(path.join(tmp, "real"), path.join(tmp, "linked"))
    await expect(assertWikiDirectorySafe(tmp, "linked")).rejects.toThrow("refuses symlinked output paths")
  })

  test("rejects non-directory output segments", async () => {
    await writeFile(path.join(tmp, "file.md"), "content")
    await expect(assertWikiDirectorySafe(tmp, "file.md")).rejects.toThrow("not a directory")
  })
})
