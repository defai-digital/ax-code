import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readJsonFile } from "./auth.js"

describe("quota auth utilities", () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-quota-auth-"))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  const testFile = (name) => path.join(tempRoot, name)

  it("reads JSON files without a preflight existence check", () => {
    const filePath = testFile("auth.json")
    fs.writeFileSync(filePath, JSON.stringify({ accounts: [{ refreshToken: "token" }] }), "utf8")
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === filePath) {
        throw new Error("readJsonFile should not call existsSync before reading")
      }
      return false
    })

    try {
      expect(readJsonFile(filePath)).toEqual({ accounts: [{ refreshToken: "token" }] })
    } finally {
      existsSync.mockRestore()
    }
  })

  it("treats missing and empty JSON files as absent auth", () => {
    const emptyPath = testFile("empty.json")
    fs.writeFileSync(emptyPath, "  \n", "utf8")

    expect(readJsonFile(testFile("missing.json"))).toBeNull()
    expect(readJsonFile(emptyPath)).toBeNull()
  })

  it("returns null for invalid JSON", () => {
    const filePath = testFile("invalid.json")
    fs.writeFileSync(filePath, "{not-json", "utf8")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(readJsonFile(filePath)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to read JSON file:"), expect.any(SyntaxError))
  })
})
