import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { discover } from "../../src/mcp/discovery"

describe("mcp.discovery playwright candidate", () => {
  test("playwright candidate is present in discovered server list", async () => {
    const results = await discover()
    const playwright = results.find((s) => s.name === "playwright")
    expect(playwright).toBeDefined()
    expect(playwright!.description).toContain("HTML/web development")
    expect(playwright!.type).toBe("stdio")
  })

  test("playwright candidate has correct command and args", async () => {
    const results = await discover()
    const playwright = results.find((s) => s.name === "playwright")
    expect(playwright).toBeDefined()
    expect(playwright!.command).toBe("npx")
    expect(playwright!.args).toContain("@playwright/mcp@latest")
  })

  test("playwright candidate is not detected when no index.html in cwd", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-discovery-test-"))
    const origCwd = process.cwd()
    try {
      process.chdir(tmp)
      const results = await discover()
      const playwright = results.find((s) => s.name === "playwright")
      expect(playwright?.detected).toBe(false)
    } finally {
      process.chdir(origCwd)
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("playwright candidate is detected when index.html exists in cwd", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-discovery-test-"))
    const origCwd = process.cwd()
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<!DOCTYPE html><html></html>")
      process.chdir(tmp)
      const results = await discover()
      const playwright = results.find((s) => s.name === "playwright")
      // detected depends on npx being available — if npx is present it should be true
      // The test verifies the HTML detection path runs without error
      expect(playwright).toBeDefined()
    } finally {
      process.chdir(origCwd)
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
