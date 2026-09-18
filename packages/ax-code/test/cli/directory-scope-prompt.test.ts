import { afterEach, beforeEach, describe, test, expect, vi } from "vitest"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { confirmDirectoryScope } from "../../src/cli/directory-scope-prompt"
import { DirectoryScopeTrust } from "../../src/config/directory-scope-trust"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const statePath = path.join(Global.Path.state, "directory-scope-trust.json")
const globalConfigPath = path.join(Global.Path.config, "config.json")
const stdin = process.stdin as typeof process.stdin & { isTTY?: boolean }
const stdout = process.stdout as typeof process.stdout & { isTTY?: boolean }
const originalStdinTTY = stdin.isTTY
const originalStdoutTTY = stdout.isTTY

async function withCleanTrustState(fn: () => Promise<void>) {
  const previous = await fs.readFile(statePath, "utf-8").catch(() => undefined)
  await fs.rm(statePath, { force: true })
  try {
    await fn()
  } finally {
    if (previous === undefined) await fs.rm(statePath, { force: true })
    else await fs.writeFile(statePath, previous)
  }
}

async function withGlobalConfig(content: unknown, fn: () => Promise<void>) {
  const previous = await fs.readFile(globalConfigPath, "utf-8").catch(() => undefined)
  await fs.mkdir(Global.Path.config, { recursive: true })
  await fs.writeFile(globalConfigPath, JSON.stringify(content))
  try {
    await fn()
  } finally {
    if (previous === undefined) await fs.rm(globalConfigPath, { force: true })
    else await fs.writeFile(globalConfigPath, previous)
  }
}

beforeEach(() => {
  delete process.env.AX_CODE_ALLOW_BROAD_DIR
})

afterEach(() => {
  stdin.isTTY = originalStdinTTY
  stdout.isTTY = originalStdoutTTY
  delete process.env.AX_CODE_ALLOW_BROAD_DIR
  vi.restoreAllMocks()
})

describe("confirmDirectoryScope", () => {
  test("proceeds without prompting for an ordinary project directory", () =>
    withCleanTrustState(async () => {
      await using tmp = await tmpdir()
      const confirmSpy = vi.spyOn(prompts, "confirm")
      const result = await confirmDirectoryScope(tmp.path)
      expect(result.proceed).toBe(true)
      expect(confirmSpy).not.toHaveBeenCalled()
    }))

  test("non-interactive: refuses a broad directory by default", () =>
    withCleanTrustState(async () => {
      stdin.isTTY = false
      stdout.isTTY = false
      const result = await confirmDirectoryScope(Global.Path.home)
      expect(result.proceed).toBe(false)
      expect(result.message).toMatch(/AX_CODE_ALLOW_BROAD_DIR/)
    }))

  test("AX_CODE_ALLOW_BROAD_DIR=1 skips the check entirely, even non-interactively", () =>
    withCleanTrustState(async () => {
      stdin.isTTY = false
      stdout.isTTY = false
      process.env.AX_CODE_ALLOW_BROAD_DIR = "1"
      const result = await confirmDirectoryScope(Global.Path.home)
      expect(result.proceed).toBe(true)
    }))

  test("interactive: confirming proceeds and caches the trust decision", () =>
    withCleanTrustState(async () => {
      stdin.isTTY = true
      stdout.isTTY = true
      vi.spyOn(prompts.log, "warn").mockImplementation(() => {})
      const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(true)

      const first = await confirmDirectoryScope(Global.Path.home)
      expect(first.proceed).toBe(true)
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(await DirectoryScopeTrust.isTrusted(Filesystem.resolve(Global.Path.home))).toBe(true)

      // Second call should skip the prompt entirely — already trusted.
      confirmSpy.mockClear()
      const second = await confirmDirectoryScope(Global.Path.home)
      expect(second.proceed).toBe(true)
      expect(confirmSpy).not.toHaveBeenCalled()
    }))

  test("a malformed global config (non-boolean enabled, negative maxTopLevelEntries) doesn't crash or flag every directory", () =>
    withCleanTrustState(() =>
      withGlobalConfig({ directoryScope: { enabled: "yes", maxTopLevelEntries: -50 } }, async () => {
        await using tmp = await tmpdir()
        const result = await confirmDirectoryScope(tmp.path)
        expect(result.proceed).toBe(true)
      }),
    ))

  test("interactive: declining aborts without caching trust", () =>
    withCleanTrustState(async () => {
      stdin.isTTY = true
      stdout.isTTY = true
      vi.spyOn(prompts.log, "warn").mockImplementation(() => {})
      vi.spyOn(prompts, "confirm").mockResolvedValue(false)

      const result = await confirmDirectoryScope(Global.Path.home)
      expect(result.proceed).toBe(false)
      expect(result.message).toMatch(/Aborted/)
      expect(await DirectoryScopeTrust.isTrusted(Filesystem.resolve(Global.Path.home))).toBe(false)
    }))
})
