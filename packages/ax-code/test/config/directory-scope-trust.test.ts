import { afterEach, describe, test, expect } from "vitest"
import fs from "fs/promises"
import path from "path"
import { DirectoryScopeTrust } from "../../src/config/directory-scope-trust"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"

const statePath = path.join(Global.Path.state, "directory-scope-trust.json")

async function withBackup(fn: () => Promise<void>) {
  const previous = await fs.readFile(statePath, "utf-8").catch(() => undefined)
  try {
    await fn()
  } finally {
    if (previous === undefined) await fs.rm(statePath, { force: true, recursive: true })
    else await fs.writeFile(statePath, previous)
  }
}

afterEach(async () => {
  await fs.rm(statePath, { force: true, recursive: true })
})

describe("DirectoryScopeTrust", () => {
  test("a directory starts untrusted", () =>
    withBackup(async () => {
      await fs.rm(statePath, { force: true })
      expect(await DirectoryScopeTrust.isTrusted("/some/project")).toBe(false)
    }))

  test("trust() persists the decision for that exact resolved path", () =>
    withBackup(async () => {
      await fs.rm(statePath, { force: true })
      const resolved = Filesystem.resolve(process.cwd())
      expect(await DirectoryScopeTrust.isTrusted(resolved)).toBe(false)

      await DirectoryScopeTrust.trust(resolved)
      expect(await DirectoryScopeTrust.isTrusted(resolved)).toBe(true)

      const other = path.join(resolved, "nested")
      expect(await DirectoryScopeTrust.isTrusted(other)).toBe(false)
    }))

  test("trusting one path does not clobber a previously trusted path", () =>
    withBackup(async () => {
      await fs.rm(statePath, { force: true })
      await DirectoryScopeTrust.trust("/one")
      await DirectoryScopeTrust.trust("/two")
      expect(await DirectoryScopeTrust.isTrusted("/one")).toBe(true)
      expect(await DirectoryScopeTrust.isTrusted("/two")).toBe(true)
    }))

  // Regression: isTrusted() runs on nearly every CLI startup. A corrupted
  // cache file must degrade to "not trusted", never throw — a thrown error
  // here would break every ax-code invocation, not just broad-directory ones.
  test("a corrupted state file is treated as empty instead of throwing", () =>
    withBackup(async () => {
      await fs.writeFile(statePath, "{ not valid json")
      await expect(DirectoryScopeTrust.isTrusted("/some/project")).resolves.toBe(false)
    }))

  test("trust() write failures do not throw", () =>
    withBackup(async () => {
      await fs.rm(statePath, { force: true })
      await fs.mkdir(statePath, { recursive: true })
      await expect(DirectoryScopeTrust.trust("/blocked")).resolves.toBeUndefined()
    }))
})
