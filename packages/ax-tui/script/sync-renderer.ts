import { spawnSync } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifestPath = path.join(root, "renderer-artifacts.json")
const check = process.argv.includes("--check")
const staging = await mkdtemp(path.join(os.tmpdir(), "ax-tui-renderer-"))

type ArtifactManifest = { compiler: string; files: string[] }

function safeArtifact(file: string): void {
  if (path.isAbsolute(file) || file.split(/[\\/]/).some((part) => part === ".." || part.startsWith("."))) {
    throw new Error(`Invalid renderer artifact path: ${file}`)
  }
  if (!file.endsWith(".js") && !file.endsWith(".d.ts")) throw new Error(`Invalid renderer artifact: ${file}`)
}

try {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", path.join(root, "script/build-renderer.ts"), staging],
    {
      cwd: root,
      stdio: "inherit",
    },
  )
  if (result.status !== 0) throw result.error ?? new Error("Renderer build failed")
  const generatedText = await readFile(path.join(staging, "renderer-artifacts.json"), "utf8")
  const generated: ArtifactManifest = JSON.parse(generatedText)
  const previous: ArtifactManifest = JSON.parse(await readFile(manifestPath, "utf8"))
  for (const file of [...previous.files, ...generated.files]) safeArtifact(file)

  if (check) {
    const mismatches: string[] = []
    for (const file of new Set([...previous.files, ...generated.files])) {
      try {
        const [actual, expected] = await Promise.all([
          readFile(path.join(root, file)),
          readFile(path.join(staging, file)),
        ])
        if (!actual.equals(expected)) mismatches.push(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        mismatches.push(file)
      }
    }
    if (generatedText !== (await readFile(manifestPath, "utf8"))) mismatches.push("renderer-artifacts.json")
    if (mismatches.length)
      throw new Error(`Renderer artifacts are stale; run pnpm run build:renderer:\n${mismatches.join("\n")}`)
    console.log(`Renderer artifacts match TypeScript source (${generated.files.length} files)`)
  } else {
    // Remove only files in the previous generated-artifact inventory.
    for (const file of previous.files) {
      if (!generated.files.includes(file)) await rm(path.join(root, file), { force: true })
    }
    for (const file of generated.files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await copyFile(path.join(staging, file), path.join(root, file))
    }
    await writeFile(manifestPath, generatedText)
    console.log(`Updated ${generated.files.length} renderer artifacts`)
  }
} finally {
  await rm(staging, { recursive: true, force: true })
}
