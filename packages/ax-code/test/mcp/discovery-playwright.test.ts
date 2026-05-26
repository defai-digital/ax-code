import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { discover, checkTcpPort, isHtmlOrWebProject } from "../../src/mcp/discovery"

describe("mcp.discovery playwright candidate", () => {
  test("playwright candidate is present in discovered server list", async () => {
    const results = await discover()
    const playwright = results.find((s) => s.name === "playwright")
    expect(playwright).toBeDefined()
    expect(playwright!.description).toContain("HTML/web development")
    expect(playwright!.type).toBe("stdio")
  })

  test("playwright candidate has correct command and args structure", async () => {
    const results = await discover()
    const playwright = results.find((s) => s.name === "playwright")
    expect(playwright).toBeDefined()
    expect(playwright!.command).toBe("npx")
    expect(playwright!.args).toContain("@playwright/mcp@latest")
  })

  test("playwright candidate args contain either --cdp-url or --headless (never both)", async () => {
    const results = await discover()
    const playwright = results.find((s) => s.name === "playwright")
    if (!playwright?.detected) return // skip if not detected in this environment
    const args = playwright.args ?? []
    const hasCdp = args.some((a) => a.includes("--cdp-url"))
    const hasHeadless = args.includes("--headless")
    // exactly one of the two modes must be set
    expect(hasCdp !== hasHeadless).toBe(true)
  })
})

describe("mcp.discovery isHtmlOrWebProject", () => {
  test("returns false for an empty directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      expect(await isHtmlOrWebProject(tmp)).toBe(false)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns true when index.html exists", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<!DOCTYPE html>")
      expect(await isHtmlOrWebProject(tmp)).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns true when index.htm exists", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.writeFile(path.join(tmp, "index.htm"), "<!DOCTYPE html>")
      expect(await isHtmlOrWebProject(tmp)).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns true when src/app directory exists (web-app project type)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.mkdir(path.join(tmp, "src/app"), { recursive: true })
      expect(await isHtmlOrWebProject(tmp)).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns true when app directory exists", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.mkdir(path.join(tmp, "app"), { recursive: true })
      expect(await isHtmlOrWebProject(tmp)).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns true when package.json has playwright dependency", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.writeFile(
        path.join(tmp, "package.json"),
        JSON.stringify({ devDependencies: { playwright: "^1.0.0" } }),
      )
      expect(await isHtmlOrWebProject(tmp)).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns true when package.json has @playwright/test dependency", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.writeFile(
        path.join(tmp, "package.json"),
        JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      )
      expect(await isHtmlOrWebProject(tmp)).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("returns false for a backend-only Node project", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-html-detect-"))
    try {
      await fs.writeFile(
        path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { express: "^4.0.0" }, main: "index.js" }),
      )
      await fs.mkdir(path.join(tmp, "server"), { recursive: true })
      expect(await isHtmlOrWebProject(tmp)).toBe(false)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("mcp.discovery checkTcpPort", () => {
  test("returns false for a port that is not listening", async () => {
    // Port 1 is almost never open and requires no privileges to test
    const result = await checkTcpPort(1, "127.0.0.1", 200)
    expect(result).toBe(false)
  })
})
