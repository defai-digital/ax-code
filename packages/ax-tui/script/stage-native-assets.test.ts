import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { stageNativeAssets } from "./stage-native-assets"

test("stages only verified native and license bytes and rejects replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-stage-"))
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
    const result = await stageNativeAssets(root, output)
    expect(result).toEqual([
      { name: "ax-tui-native-linux-x64-libaxtui.so", size: library.length, sha256: sha256(library) },
      { name: "ax-tui-native-linux-x64-LICENSE", size: license.length, sha256: sha256(license) },
    ])
    expect(await readFile(path.join(output, result[0].name))).toEqual(library)
    expect(await stageNativeAssets(root, output)).toEqual(result)
    await writeFile(path.join(output, result[0].name), "other")
    await expect(stageNativeAssets(root, output)).rejects.toThrow("Refusing to replace")
    await writeFile(path.join(vendor, "LICENSE"), "invalid")
    await expect(stageNativeAssets(root, path.join(root, "invalid"))).rejects.toThrow("SHA-256 mismatch")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
