import { createHash } from "node:crypto"
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { verifyNativeArtifacts } from "../native/source/resolve.js"

const race = vi.hoisted(() => ({ beforeOpen: undefined as ((file: unknown) => void) | undefined }))

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>()
  return {
    ...fs,
    openSync(...args: Parameters<typeof fs.openSync>) {
      const callback = race.beforeOpen
      race.beforeOpen = undefined
      callback?.(args[0])
      return fs.openSync(...args)
    },
  }
})

test("rejects an artifact replaced between pathname inspection and descriptor opening", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ax-tui-native-race-"))
  const library = Buffer.from("native-library")
  const license = Buffer.from("MIT license")
  const hash = (data: Buffer): string => createHash("sha256").update(data).digest("hex")
  const target = path.join(directory, "library.bin")
  try {
    writeFileSync(target, library)
    writeFileSync(path.join(directory, "replacement.bin"), library)
    writeFileSync(path.join(directory, "LICENSE"), license)
    race.beforeOpen = (file) => {
      expect(file).toBe(target)
      renameSync(target, path.join(directory, "original.bin"))
      renameSync(path.join(directory, "replacement.bin"), target)
    }
    expect(() =>
      verifyNativeArtifacts(directory, {
        lib: { file: "library.bin", size: library.length, sha256: hash(library) },
        licenseSha256: hash(license),
      }),
    ).toThrow(/Invalid ax-tui native artifact/)
  } finally {
    race.beforeOpen = undefined
    rmSync(directory, { recursive: true, force: true })
  }
})
