import { createHash } from "node:crypto"
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { verifyNativeArtifacts } from "../native/source/resolve.js"

const race = vi.hoisted(() => ({
  beforeOpen: undefined as ((file: unknown) => void) | undefined,
  afterFstat: undefined as ((fd: number) => void) | undefined,
  readLengths: [] as number[],
}))

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
    fstatSync(fd: number, options?: { bigint?: boolean }) {
      const result = fs.fstatSync(fd, options)
      const callback = race.afterFstat
      race.afterFstat = undefined
      callback?.(fd)
      return result
    },
    readSync(fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) {
      race.readLengths.push(length)
      return fs.readSync(fd, buffer, offset, length, position)
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

test("reads only the inspected size when the artifact grows after inspection", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ax-tui-native-race-"))
  const library = Buffer.from("native-library")
  const license = Buffer.from("MIT license")
  const hash = (data: Buffer): string => createHash("sha256").update(data).digest("hex")
  const target = path.join(directory, "library.bin")
  try {
    writeFileSync(target, library)
    writeFileSync(path.join(directory, "LICENSE"), license)
    race.readLengths.length = 0
    race.afterFstat = () => appendFileSync(target, "appended-after-stat")
    const paths = verifyNativeArtifacts(directory, {
      lib: { file: "library.bin", size: library.length, sha256: hash(library) },
      licenseSha256: hash(license),
    })
    expect(paths.libraryPath).toBe(target)
    expect(race.readLengths[0]).toBe(library.length)
  } finally {
    race.afterFstat = undefined
    race.readLengths.length = 0
    rmSync(directory, { recursive: true, force: true })
  }
})
