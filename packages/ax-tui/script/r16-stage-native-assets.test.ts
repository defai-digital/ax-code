import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { stageNativeAssets } from "./stage-native-assets"

test("a conflicting artifact is rejected before any asset is written", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r16-stage-"))
  try {
    const library = Buffer.from("library")
    const license = Buffer.from("license")
    const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
    const vendor = path.join(root, "vendor/linux-x64")
    await mkdir(vendor, { recursive: true })
    await writeFile(path.join(vendor, "libaxtui.so"), library)
    await writeFile(path.join(vendor, "LICENSE"), license)
    await writeFile(
      path.join(root, "vendor/manifest.json"),
      JSON.stringify({
        targets: {
          "linux-x64": {
            lib: { file: "libaxtui.so", size: library.length, sha256: sha256(library) },
            licenseSha256: sha256(license),
          },
        },
      }),
    )
    const output = path.join(root, "staged")
    await mkdir(output, { recursive: true })
    await writeFile(path.join(output, "ax-tui-native-linux-x64-LICENSE"), "conflict")

    await expect(stageNativeAssets(root, output)).rejects.toThrow("Refusing to replace")
    expect(existsSync(path.join(output, "ax-tui-native-linux-x64-libaxtui.so"))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
