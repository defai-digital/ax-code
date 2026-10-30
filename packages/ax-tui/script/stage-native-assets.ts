import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isNativeTarget, nativeAssetNames, nativeMetadata, verifyNativeArtifacts } from "../native/resolve.js"

export async function stageNativeAssets(packageRoot: string, outputDir: string) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "vendor/manifest.json"), "utf8"))
  const artifacts: Array<{ name: string; bytes: Buffer }> = []
  const targets = Object.keys(manifest.targets ?? {})
    .sort()
    .map((target) => {
      if (!isNativeTarget(target)) throw new Error(`Unsupported ax-tui native target: ${target}`)
      return target
    })
  for (const target of targets) {
    const entry = nativeMetadata(packageRoot, target)
    const paths = verifyNativeArtifacts(path.join(packageRoot, "vendor", target), entry)
    const names = nativeAssetNames(target, entry)
    artifacts.push({ name: names.library, bytes: await readFile(paths.libraryPath) })
    artifacts.push({ name: names.license, bytes: await readFile(paths.licensePath) })
  }
  if (!artifacts.length) throw new Error("No ax-tui native assets found in the manifest")
  // Verify the captured bytes too: the source may change between its first
  // validation and read. The upload must describe the exact staged content.
  for (const target of targets) {
    const entry = nativeMetadata(packageRoot, target)
    const names = nativeAssetNames(target, entry)
    for (const [name, expected] of [
      [names.library, entry.lib.sha256],
      [names.license, entry.licenseSha256],
    ]) {
      const artifact = artifacts.find((item) => item.name === name)!
      if (createHash("sha256").update(artifact.bytes).digest("hex") !== expected) {
        throw new Error(`Native asset changed during staging: ${name}`)
      }
    }
  }
  await mkdir(outputDir, { recursive: true })
  for (const artifact of artifacts) {
    const destination = path.join(outputDir, artifact.name)
    try {
      await writeFile(destination, artifact.bytes, { flag: "wx" })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (!(await readFile(destination)).equals(artifact.bytes)) {
        throw new Error(`Refusing to replace a different staged native asset: ${artifact.name}`)
      }
    }
  }
  return artifacts.map(({ name, bytes }) => ({
    name,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const output = process.argv[2]
  if (!output) throw new Error("Usage: tsx script/stage-native-assets.ts <output-directory>")
  const result = await stageNativeAssets(root, path.resolve(output))
  console.log(`Staged ${result.length} manifest-verified native assets`)
}
