import { describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { AX_ENGINE_BINARY_RELEASE } from "../../src/provider/ax-engine/constants"
import { AX_ENGINE_RUNTIME_REQUIRED_FILES, isMachOFile } from "../../src/provider/ax-engine/payload"
import { defaultLocalEngineArchive, stageAxEngineRuntime } from "../../script/stage-ax-engine-runtime"

describe("stageAxEngineRuntime", () => {
  test("extracts a self-contained archive into engine/<version>", async () => {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), "axe-stage-"))
    try {
      for (const name of AX_ENGINE_RUNTIME_REQUIRED_FILES) {
        const target = path.join(stage, name)
        if (name === "ax-engine" || name === "ax-engine-server") {
          await fs.writeFile(target, "#!/bin/sh\necho ax-engine\n", { mode: 0o755 })
        } else {
          await fs.writeFile(target, `${name}\n`)
        }
      }
      const tarPath = path.join(stage, "artifact.tar.gz")
      execFileSync("tar", ["-czf", tarPath, "-C", stage, ...AX_ENGINE_RUNTIME_REQUIRED_FILES])
      const sha256 = createHash("sha256")
        .update(await fs.readFile(tarPath))
        .digest("hex")
      const destRoot = path.join(stage, "runtime")
      const result = stageAxEngineRuntime({
        destRoot,
        archivePath: tarPath,
        required: true,
        release: {
          version: "9.9.9",
          assetName: "artifact.tar.gz",
          url: "https://example.com/artifact.tar.gz",
          sha256,
        },
      })
      expect(result?.version).toBe("9.9.9")
      expect(result?.dir).toBe(path.join(destRoot, "engine", "9.9.9"))
      await fs.access(path.join(result!.dir, "ax-engine"))
      await fs.access(path.join(result!.dir, "mlx.metallib"))
    } finally {
      await fs.rm(stage, { recursive: true, force: true })
    }
  })

  test("refuses an archive whose digest does not match the pin", async () => {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), "axe-stage-bad-"))
    try {
      const tarPath = path.join(stage, "artifact.tar.gz")
      await fs.writeFile(tarPath, "not-a-tarball")
      expect(() =>
        stageAxEngineRuntime({
          destRoot: path.join(stage, "runtime"),
          archivePath: tarPath,
          required: true,
          release: {
            version: "9.9.9",
            assetName: "artifact.tar.gz",
            url: "https://example.com/artifact.tar.gz",
            sha256: "a".repeat(64),
          },
        }),
      ).toThrow("SHA-256 mismatch")
    } finally {
      await fs.rm(stage, { recursive: true, force: true })
    }
  })

  test("does not treat a shell launcher as Mach-O", async () => {
    const file = path.join(os.tmpdir(), `axe-script-${process.pid}`)
    await fs.writeFile(file, "#!/bin/sh\necho ax-engine\n", { mode: 0o755 })
    try {
      expect(isMachOFile(file)).toBe(false)
    } finally {
      await fs.rm(file, { force: true })
    }
  })

  const pinnedArchive = defaultLocalEngineArchive()
  test.skipIf(process.platform !== "darwin" || !pinnedArchive || !existsSync(pinnedArchive))(
    "keeps Developer ID signatures on the pinned self-contained archive",
    async () => {
      const destRoot = await fs.mkdtemp(path.join(os.tmpdir(), "axe-stage-live-"))
      try {
        const result = stageAxEngineRuntime({ destRoot, required: true })
        expect(result?.version).toBe(AX_ENGINE_BINARY_RELEASE.version)
        const launcher = path.join(result!.dir, "ax-engine")
        expect(isMachOFile(launcher)).toBe(true)
        expect(isMachOFile(path.join(result!.dir, "libmlx.dylib"))).toBe(true)
        execFileSync("codesign", ["--verify", "--strict", launcher])
        const info = spawnSync("codesign", ["-dv", "--verbose=4", launcher], { encoding: "utf8" })
        expect(`${info.stdout}${info.stderr}`).toContain("TeamIdentifier=N5ZUZDUJS6")
      } finally {
        await fs.rm(destRoot, { recursive: true, force: true })
      }
    },
  )
})
