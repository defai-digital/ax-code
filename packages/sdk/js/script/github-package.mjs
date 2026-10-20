import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const publicName = "@defai-digital/ax-code-sdk"
export const registry = "https://npm.pkg.github.com"
export const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../../..")
// SDK generation removes packages/sdk/js/.tmp. Release evidence must survive it.
export const artifactDir = path.join(repoRoot, ".tmp/sdk-github-package")
export const tarballName = (version) => `defai-digital-ax-code-sdk-${version}.tgz`

export function publicManifest(workspace, catalog) {
  assert.equal(workspace.name, "@ax-code/sdk")
  assert.equal(workspace.private, true)
  assert.match(workspace.version, /^\d+\.\d+\.\d+$/)
  const dependencies = Object.fromEntries(
    Object.entries(workspace.dependencies).map(([name, value]) => {
      if (value === "catalog:") {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        value = catalog.match(new RegExp(`^  ["']?${escaped}["']?:\\s*["']([^"']+)["']\\s*$`, "m"))?.[1]
      }
      assert.equal(typeof value, "string", `Unresolved runtime dependency: ${name}`)
      assert.match(value, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `Runtime dependency must be pinned: ${name}`)
      return [name, value]
    }),
  )
  const exports = Object.fromEntries(
    Object.entries(workspace.exports).map(([entry, target]) => {
      assert.match(entry, /^(?:\.|\.\/[a-z0-9/-]+)$/)
      assert.match(target, /^\.\/dist\/[a-z0-9/-]+\.js$/)
      assert(!target.includes(".."), "Export cannot escape dist")
      return [entry, { types: target.replace(/\.js$/, ".d.ts"), import: target }]
    }),
  )
  assert(exports["."], "Missing root export")
  return {
    name: publicName,
    version: workspace.version,
    description: "Typed AX Code runtime client for internal applications",
    type: "module",
    license: "Apache-2.0",
    engines: { node: ">=26" },
    repository: { type: "git", url: "https://github.com/defai-digital/ax-code.git", directory: "packages/sdk/js" },
    publishConfig: { registry, access: "restricted" },
    types: "./dist/index.d.ts",
    exports,
    dependencies,
    files: ["dist", "README.md", "ARCHITECTURE.md", "LICENSE"],
  }
}

export async function validateDist(dir, manifest) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    assert(!entry.isSymbolicLink(), `Symlink in SDK payload: ${file}`)
    if (entry.isDirectory()) {
      await validateDist(file, manifest)
      continue
    }
    assert(entry.isFile(), `Unexpected SDK payload: ${file}`)
    assert(/\.(?:js|d\.ts|proto)$/.test(entry.name), `Unexpected SDK build file: ${file}`)
    if (entry.name.endsWith(".js")) await fs.access(file.replace(/\.js$/, ".d.ts"))
  }
}

export async function pack() {
  const workspace = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"))
  const manifest = publicManifest(workspace, await fs.readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"))
  const versionSource = await fs.readFile(path.join(packageRoot, "src/version.ts"), "utf8")
  assert(versionSource.includes(`export const SDK_VERSION = "${manifest.version}"`), "SDK_VERSION mismatch")
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-sdk-pack-"))
  try {
    await fs.mkdir(artifactDir, { recursive: true })
    await validateDist(path.join(packageRoot, "dist"), manifest)
    await fs.cp(path.join(packageRoot, "dist"), path.join(stage, "dist"), { recursive: true })
    for (const entry of Object.values(manifest.exports)) {
      await fs.access(path.join(stage, entry.import))
      await fs.access(path.join(stage, entry.types))
    }
    await fs.access(path.join(stage, "dist/proto/ax_code/v1/headless.proto"))
    for (const name of ["README.md", "ARCHITECTURE.md"])
      await fs.copyFile(path.join(packageRoot, name), path.join(stage, name))
    await fs.copyFile(path.join(repoRoot, "LICENSE"), path.join(stage, "LICENSE"))
    await fs.writeFile(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
    // A temporary directory has no packageManager field. Invoking the global
    // shim there can select a different pnpm and produce different gzip bytes.
    const pnpmExecutable = process.env.npm_execpath
    assert(
      pnpmExecutable && path.isAbsolute(pnpmExecutable),
      "Run packaging through pnpm run pack:github or test:tarball",
    )
    const expected = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"))
      .packageManager.split("@")
      .at(-1)
    const actual = execFileSync(process.execPath, [pnpmExecutable, "--version"], {
      cwd: stage,
      encoding: "utf8",
    }).trim()
    assert.equal(actual, expected, "SDK packaging must use the pinned pnpm version")
    execFileSync(process.execPath, [pnpmExecutable, "pack", "--pack-destination", artifactDir], {
      cwd: stage,
      stdio: "inherit",
    })
    const filename = tarballName(manifest.version)
    const bytes = await fs.readFile(path.join(artifactDir, filename))
    const receipt = {
      name: manifest.name,
      version: manifest.version,
      registry,
      filename,
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
    await fs.writeFile(path.join(artifactDir, "package-receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
    return receipt
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await pack()
