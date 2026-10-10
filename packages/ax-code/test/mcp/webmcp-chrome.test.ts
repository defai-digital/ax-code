import { afterEach, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Config } from "../../src/config/config"
import { McpTrust } from "../../src/mcp/trust"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { WebMcpChrome } from "../../src/mcp/webmcp-chrome"

const dirs: string[] = []
afterEach(async () => {
  await Instance.disposeAll()
  await fs.rm(process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR!, { recursive: true, force: true })
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function fakeChrome(output: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webmcp-chrome-"))
  dirs.push(dir)
  const file = path.join(dir, "chrome")
  await fs.writeFile(file, `#!/bin/sh\necho "${output}"\n`, { mode: 0o755 })
  return file
}

test.skipIf(process.platform === "win32")("an explicit Chrome at the minimum major is ready", async () => {
  const file = await fakeChrome("Google Chrome 150.0.7000.1")
  expect(await WebMcpChrome.status(file)).toEqual({ state: "ready", major: 150, executable: file })
})

test.skipIf(process.platform === "win32")("an explicit stale Chrome is outdated and never falls back", async () => {
  const file = await fakeChrome("Google Chrome 149.0.1.1")
  expect(await WebMcpChrome.status(file)).toEqual({ state: "outdated", major: 149, minimum: 150 })
})

test.skipIf(process.platform === "win32")("a non-Chrome explicit executable is unreadable", async () => {
  const file = await fakeChrome("Some Other Browser 200.0")
  const result = await WebMcpChrome.status(file)
  expect(result.state).toBe("unreadable")
})

test("an explicit path that does not exist is missing", async () => {
  expect(await WebMcpChrome.status(path.join(os.tmpdir(), "no-such-chrome-binary"))).toEqual({
    state: "missing",
    minimum: 150,
  })
})

test("well-known locations are platform specific and PATH names skip win32", () => {
  expect(WebMcpChrome.knownPaths("darwin", "/Users/a")[0]).toContain("Google Chrome.app")
  expect(WebMcpChrome.knownPaths("linux", "/home/a")).toEqual([])
  expect(
    WebMcpChrome.knownPaths("win32", "C:/u", { ProgramFiles: "C:/PF" }).some((p) => p.endsWith("chrome.exe")),
  ).toBe(true)
  expect(WebMcpChrome.pathCandidates("win32", { PATH: "/a" })).toEqual([])
  expect(WebMcpChrome.pathCandidates("linux", { PATH: "/a:/b" })).toContain(path.join("/b", "chromium"))
})

test.skipIf(process.platform === "win32")(
  "installed candidates are probed concurrently, in candidate order",
  async () => {
    const slow = async (output: string) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webmcp-chrome-"))
      dirs.push(dir)
      const file = path.join(dir, "chrome")
      await fs.writeFile(file, `#!/bin/sh\nsleep 2\necho "${output}"\n`, { mode: 0o755 })
      return dir
    }
    const [first, second] = await Promise.all([slow("Google Chrome 149.0.0.1"), slow("Google Chrome 151.0.0.1")])
    const previous = process.env.PATH
    process.env.PATH = `${first}:${second}`
    try {
      const started = Date.now()
      const result = await WebMcpChrome.status(undefined, "linux")
      // Two 2 s probes run side by side: well under the 4 s a sequential walk needs.
      expect(Date.now() - started).toBeLessThan(3_600)
      expect(result).toEqual({ state: "ready", major: 151, executable: path.join(second, "chrome") })
    } finally {
      process.env.PATH = previous
    }
  },
)

async function recordingChrome() {
  const file = await fakeChrome("Google Chrome 150.0.7000.1")
  const marker = path.join(path.dirname(file), "executed")
  await fs.writeFile(file, `#!/bin/sh\ntouch "${marker}"\necho "Google Chrome 150.0.7000.1"\n`, { mode: 0o755 })
  return { file, marker }
}

test.skipIf(process.platform === "win32")("an untrusted project Chrome probe cannot execute its binary", async () => {
  const { file, marker } = await recordingChrome()
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const bridge = WebMcpProfile.config({ executablePath: file, allowedOrigins: [] }, false)
      await fs.writeFile(path.join(dir, "ax-code.json"), JSON.stringify({ mcp: { bridge } }))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await WebMcpChrome.statusForServer("bridge")
      expect(await fs.stat(marker).catch(() => undefined)).toBeUndefined()
      expect(result).toBeUndefined()
      const entry = (await Config.mcpEntry("bridge"))!
      if (!("type" in entry.config)) throw new Error("Expected a full MCP entry")
      await McpTrust.trust("bridge", entry.config, entry.source)
      expect(await WebMcpChrome.statusForServer("bridge")).toEqual({ state: "ready", major: 150, executable: file })
      expect(await fs.stat(marker)).toBeDefined()
    },
  })
})

test.skipIf(process.platform === "win32")(
  "managed WebMCP denial prevents even an advisory Chrome process",
  async () => {
    const { file, marker } = await recordingChrome()
    const managed = process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR!
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(
      path.join(managed, "ax-code.json"),
      JSON.stringify({
        webmcp: { allow: false },
        mcp: { bridge: WebMcpProfile.config({ executablePath: file, allowedOrigins: [] }, false) },
      }),
    )
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await WebMcpChrome.statusForServer("bridge")).toBeUndefined()
        expect(await fs.stat(marker).catch(() => undefined)).toBeUndefined()
      },
    })
  },
)

test("a failing config lookup makes the advisory probe report no status instead of rejecting", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const get = vi.spyOn(Config, "get").mockRejectedValueOnce(new Error("config unreadable"))
      try {
        expect(await WebMcpChrome.statusForServer("bridge")).toBeUndefined()
      } finally {
        get.mockRestore()
      }
    },
  })
})

test("Chrome discovery ignores relative home, install, and PATH roots", () => {
  expect(WebMcpChrome.pathCandidates("linux", { PATH: "./tools:../bin:/usr/bin" })).toEqual([
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/chrome",
  ])
  expect(WebMcpChrome.knownPaths("win32", "C:/u", { ProgramFiles: "relative" })).toEqual([])
  expect(WebMcpChrome.knownPaths("darwin", "relative")).not.toContain(
    "relative/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  )
})
