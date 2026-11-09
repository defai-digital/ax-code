import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { nativeSourceDigest } from "./native-source.js"

export const tuiRoot = fileURLToPath(new URL("../", import.meta.url))
export const defaultExperimentDirectory = resolve(tuiRoot, ".internal/text-width")

export function buildTextWidthExperiment(directory = defaultExperimentDirectory) {
  directory = resolve(directory)
  const zig = process.env.AX_CODE_TUI_ZIG || "zig"
  const run = (args: string[]) => {
    const child = spawnSync(zig, args, { cwd: tuiRoot, encoding: "utf8", timeout: 180_000 })
    assert.ifError(child.error)
    assert.equal(child.status, 0, child.stderr)
    return child.stdout.trim()
  }
  const version = readFileSync(join(tuiRoot, ".zig-version"), "utf8").trim()
  assert.equal(run(["version"]), version, `Install Zig ${version} or set AX_CODE_TUI_ZIG`)
  // Read the production dependency pin rather than maintaining a second version.
  const zon = readFileSync(join(tuiRoot, "native/renderer/build.zig.zon"), "utf8")
  const dependency = /\.uucode\s*=\s*\.\{\s*\.url\s*=\s*"([^"]+)"\s*,\s*\.hash\s*=\s*"([^"]+)"/.exec(zon)
  assert.ok(dependency, "Missing production uucode pin")
  const nativeBuild = readFileSync(join(tuiRoot, "native/renderer/build.zig"), "utf8")
  const fieldSelection = /\.fields\s*=\s*@as\(\[\]const \[\]const u8,\s*&\.\{([\s\S]*?)\}\)/.exec(nativeBuild)
  assert.ok(fieldSelection, "Missing production Unicode field selection")
  const unicodeFields = [...fieldSelection[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1])
  assert.ok(unicodeFields.length > 0, "Empty production Unicode field selection")
  const globalCache = join(directory, "cache/global")
  const staging = join(directory, "build")
  mkdirSync(staging, { recursive: true })
  // Use uucode's build graph so its generated Unicode tables and production
  // field selection are identical in both targets. The dependency pin is local.
  writeFileSync(join(staging, "build.zig"), readFileSync(join(tuiRoot, "experiments/text-width/build.zig")))
  writeFileSync(
    join(staging, "build.zig.zon"),
    `.{
    .name = .ax_tui, .version = "1.0.0", .fingerprint = 0x1d785d6553f08b3a,
    .dependencies = .{ .uucode = .{ .url = "${dependency[1]}", .hash = "${dependency[2]}" } },
    .paths = .{ "." },
  }\n`,
  )
  const sourceSha256 = nativeSourceDigest()
  run([
    "build",
    "--build-file",
    join(staging, "build.zig"),
    "--prefix",
    directory,
    "--cache-dir",
    join(directory, "cache/local"),
    "--global-cache-dir",
    globalCache,
    `-Dkernel=${join(tuiRoot, "experiments/text-width/kernel.zig")}`,
    `-Dutf8=${join(tuiRoot, "native/renderer/utf8.zig")}`,
    ...unicodeFields.map((field) => `-Dfields=${field}`),
    "-j4",
  ])
  assert.equal(nativeSourceDigest(), sourceSha256, "Native source changed during experiment build")
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
  const nativeFile =
    process.platform === "win32"
      ? "bin/ax-tui-text-width.dll"
      : `lib/libax-tui-text-width.${process.platform === "darwin" ? "dylib" : "so"}`
  const artifacts = Object.fromEntries(
    [nativeFile, "bin/ax-tui-text-width.wasm"].map((file) => [
      file,
      { sha256: hash(join(directory, file)), bytes: readFileSync(join(directory, file)).byteLength },
    ]),
  )
  const manifest = {
    schemaVersion: 1,
    zigVersion: version,
    optimize: "ReleaseFast",
    nativeTarget: `${process.platform}-${process.arch}`,
    nativeSourceSha256: sourceSha256,
    uucodeHash: dependency[2],
    unicodeFields,
    kernelSha256: hash(join(tuiRoot, "experiments/text-width/kernel.zig")),
    buildSha256: hash(join(tuiRoot, "experiments/text-width/build.zig")),
    wasmFeatures: ["simd128"],
    artifacts,
  }
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3, "Usage: build-text-width-experiment.ts [output-directory]")
  console.log(JSON.stringify(buildTextWidthExperiment(process.argv[2]), null, 2))
}
