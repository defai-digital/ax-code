import { describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AX_ENGINE_RUNTIME_REQUIRED_FILES } from "../../src/provider/ax-engine/payload"
import { stageAxEngineRuntime } from "../../script/stage-ax-engine-runtime"

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
})
