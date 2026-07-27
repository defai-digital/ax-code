import { describe, expect, test } from "vitest"

import type { FileNode } from "@/components/files/types"

import {
  getFilesViewParentDirectoryPath,
  isDirectoryReadError,
  isFileMissingError,
  isFilesViewAbsolutePath,
  shouldIgnoreFilesViewEntryName,
  shouldIgnoreFilesViewPath,
  sortFilesViewNodes,
} from "./filesViewTreeUtils"

const node = (name: string, type: FileNode["type"]): FileNode => ({ name, path: `/${name}`, type })

describe("sortFilesViewNodes", () => {
  test("sorts directories before files, alphabetically within each group", () => {
    const input = [node("b.ts", "file"), node("zeta", "directory"), node("a.ts", "file"), node("alpha", "directory")]
    expect(sortFilesViewNodes(input).map((item) => item.name)).toEqual(["alpha", "zeta", "a.ts", "b.ts"])
  })

  test("does not mutate the input array", () => {
    const input = [node("b.ts", "file"), node("a.ts", "file")]
    sortFilesViewNodes(input)
    expect(input.map((item) => item.name)).toEqual(["b.ts", "a.ts"])
  })
})

describe("isFilesViewAbsolutePath", () => {
  test("accepts POSIX, UNC, and Windows drive paths", () => {
    expect(isFilesViewAbsolutePath("/usr/local")).toBe(true)
    expect(isFilesViewAbsolutePath("//server/share")).toBe(true)
    expect(isFilesViewAbsolutePath("C:/Users/Alice")).toBe(true)
  })

  test("rejects relative and drive-relative paths", () => {
    expect(isFilesViewAbsolutePath("src/app.ts")).toBe(false)
    expect(isFilesViewAbsolutePath("C:src/app.ts")).toBe(false)
    expect(isFilesViewAbsolutePath("")).toBe(false)
  })
})

describe("ignore rules", () => {
  test("ignores node_modules entry names", () => {
    expect(shouldIgnoreFilesViewEntryName("node_modules")).toBe(true)
    expect(shouldIgnoreFilesViewEntryName("src")).toBe(false)
  })

  test("ignores node_modules at any depth, including backslash separators", () => {
    expect(shouldIgnoreFilesViewPath("node_modules")).toBe(true)
    expect(shouldIgnoreFilesViewPath("a/node_modules")).toBe(true)
    expect(shouldIgnoreFilesViewPath("a/node_modules/pkg")).toBe(true)
    expect(shouldIgnoreFilesViewPath("a\\node_modules\\pkg")).toBe(true)
  })

  test("does not ignore similarly named directories", () => {
    expect(shouldIgnoreFilesViewPath("a/node_modules2")).toBe(false)
    expect(shouldIgnoreFilesViewPath("a/my_node_modules")).toBe(false)
  })
})

describe("error classifiers", () => {
  test("detects directory-read errors from Error instances and plain values", () => {
    expect(isDirectoryReadError(new Error("EISDIR: illegal operation on a directory"))).toBe(true)
    expect(isDirectoryReadError("path is a directory")).toBe(true)
    expect(isDirectoryReadError(new Error("permission denied"))).toBe(false)
    expect(isDirectoryReadError(undefined)).toBe(false)
  })

  test("detects missing-file errors case-insensitively", () => {
    expect(isFileMissingError(new Error("ENOENT: no such file or directory"))).toBe(true)
    expect(isFileMissingError(new Error("File not found"))).toBe(true)
    expect(isFileMissingError("target does not exist")).toBe(true)
    expect(isFileMissingError(new Error("EISDIR"))).toBe(false)
    expect(isFileMissingError(null)).toBe(false)
  })
})

describe("getFilesViewParentDirectoryPath", () => {
  test("returns the parent of a nested POSIX path", () => {
    expect(getFilesViewParentDirectoryPath("/Users/Alice/project/src/app.ts")).toBe("/Users/Alice/project/src")
  })

  test("keeps filesystem roots as their own parent", () => {
    expect(getFilesViewParentDirectoryPath("/")).toBe("/")
    expect(getFilesViewParentDirectoryPath("C:/")).toBe("C:/")
  })

  test("returns the root for top-level entries", () => {
    expect(getFilesViewParentDirectoryPath("/Users")).toBe("/")
    expect(getFilesViewParentDirectoryPath("C:/Users")).toBe("C:/")
  })

  test("returns the input for empty or slash-less paths", () => {
    expect(getFilesViewParentDirectoryPath("")).toBe("")
    expect(getFilesViewParentDirectoryPath("relative")).toBe("relative")
  })
})
