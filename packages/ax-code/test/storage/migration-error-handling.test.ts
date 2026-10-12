import { beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"

// Drives the real Storage migrations against the per-file isolated data dir.
// Each test re-seeds the legacy layout; the migration marker is absent so the
// first Storage access replays migrations from 0.
const dataDir = Global.Path.data
const storageDir = path.join(dataDir, "storage")
const legacyProject = path.join(dataDir, "project", "legacyproj")

async function writeJsonFile(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value))
}

async function writeRawFile(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

async function seedLegacyProject() {
  const infoDir = path.join(legacyProject, "storage", "session", "info")
  await writeRawFile(path.join(infoDir, "ses_bad.json"), "{ nope")
  await writeJsonFile(path.join(infoDir, "ses_ok.json"), { id: "ses_ok", directory: "/nonexistent-legacy" })
  await writeJsonFile(path.join(legacyProject, "storage", "session", "message", "ses_ok", "msg_1.json"), {
    id: "msg_1",
  })
  await writeJsonFile(path.join(legacyProject, "storage", "session", "part", "ses_ok", "msg_1", "prt_1.json"), {
    id: "prt_1",
    type: "text",
    text: "ok",
  })
}

describe("Storage migration error handling", () => {
  beforeEach(async () => {
    await fs.rm(storageDir, { recursive: true, force: true })
    await fs.rm(path.join(dataDir, "project"), { recursive: true, force: true })
  })

  test("skips an unparseable legacy session file and completes the migration", async () => {
    await seedLegacyProject()
    vi.resetModules()
    const { Storage } = await import("../../src/storage/storage")

    await Storage.write(["probe"], { ok: true })

    expect(await Storage.read(["probe"])).toEqual({ ok: true })
    expect(await Filesystem.exists(path.join(storageDir, "session", "legacyproj", "ses_ok.json"))).toBe(true)
    expect(await Filesystem.exists(path.join(storageDir, "message", "ses_ok", "msg_1.json"))).toBe(true)
    expect(await Filesystem.exists(path.join(storageDir, "part", "msg_1", "prt_1.json"))).toBe(true)
    expect(await Filesystem.exists(path.join(storageDir, "session", "legacyproj", "ses_bad.json"))).toBe(false)
    expect(await fs.readFile(path.join(storageDir, "migration"), "utf-8")).toBe("2")
  })

  test("propagates a destination write failure and retries on the next access", async () => {
    await seedLegacyProject()
    vi.resetModules()
    const { Filesystem: ScopedFilesystem } = await import("../../src/util/filesystem")
    const { Storage } = await import("../../src/storage/storage")

    const dest = path.join(storageDir, "session", "legacyproj", "ses_ok.json")
    const original = ScopedFilesystem.writeJson
    const spy = vi.spyOn(ScopedFilesystem, "writeJson").mockImplementation(async (file, value, mode) => {
      if (file === dest) throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" })
      return original(file, value, mode)
    })
    try {
      await expect(Storage.write(["probe"], { ok: true })).rejects.toMatchObject({ code: "ENOSPC" })
      // The failed copy must not advance the marker, so the next startup
      // retries the file instead of leaving it silently unmigrated.
      expect(await Filesystem.exists(path.join(storageDir, "migration"))).toBe(false)
    } finally {
      spy.mockRestore()
    }

    // lazy() drops a rejected initializer, so a later access retries instead
    // of replaying the failure for the rest of the process.
    await Storage.write(["probe"], { ok: true })
    expect(await fs.readFile(path.join(storageDir, "migration"), "utf-8")).toBe("2")
    expect(await Filesystem.exists(dest)).toBe(true)
  })
})
