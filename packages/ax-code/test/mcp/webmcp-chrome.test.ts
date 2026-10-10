import { afterEach, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { WebMcpChrome } from "../../src/mcp/webmcp-chrome"

const dirs: string[] = []
afterEach(async () => {
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
