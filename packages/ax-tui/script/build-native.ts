import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { NATIVE_TARGETS, type BuildTarget } from "./native-targets.js"
import { NATIVE_SOURCE_ROOT, nativeSourceDigest } from "./native-source.js"
import { assertBinaryFormat, sha256, type NativeBuildEntry, type NativeBuildManifest } from "./vendor-tui-native.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** Replace the inode so mapped native libraries keep their original signed pages. */
export function writeNativeArtifact(file: string, bytes: string | Uint8Array): void {
  const staging = mkdtempSync(join(dirname(file), ".native-stage-"))
  try {
    const temporary = join(staging, basename(file))
    writeFileSync(temporary, bytes)
    renameSync(temporary, file)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function selectNativeTargets(
  args: string[],
  host = `${process.platform}-${process.arch}`,
): readonly BuildTarget[] {
  if (args.length === 1 && args[0] === "--all") return NATIVE_TARGETS
  if (args.length > 1 || (args.length === 1 && !args[0]!.startsWith("--target="))) {
    throw new Error("Usage: build-native.ts [--all | --target=<target> | --test]")
  }
  const key = args[0]?.slice("--target=".length) ?? host
  const target = NATIVE_TARGETS.find((item) => item.key === key)
  if (!target) throw new Error(`Unsupported native target: ${key}`)
  return [target]
}

function run(): void {
  const args = process.argv.slice(2)
  const test = args.length === 1 && args[0] === "--test"
  const hostLibc =
    process.platform === "linux" &&
    (process.env.AX_CODE_TUI_LIBC === "musl" ||
      (!process.env.AX_CODE_TUI_LIBC &&
        !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime))
      ? "-musl"
      : ""
  const targets = test ? [] : selectNativeTargets(args, `${process.platform}-${process.arch}${hostLibc}`)
  const zig = process.env.AX_CODE_TUI_ZIG || "zig"
  const zigVersion = readFileSync(join(ROOT, ".zig-version"), "utf8").trim()
  const installed = spawnSync(zig, ["version"], { encoding: "utf8" })
  if (installed.error)
    throw new Error(`Install Zig ${zigVersion}, or set AX_CODE_TUI_ZIG to its executable`, { cause: installed.error })
  if (installed.status !== 0 || installed.stdout.trim() !== zigVersion)
    throw new Error(`Native builds require Zig ${zigVersion}`)

  const sourceSha256 = nativeSourceDigest()
  const buildArgs = [
    "build",
    ...(test ? ["test"] : ["-Doptimize=ReleaseFast", targets.length > 1 ? "-Dall" : `-Dtarget=${targets[0]!.zig}`]),
    "-j4",
    "--summary",
    "all",
  ]
  if (process.env.AX_CODE_TUI_MACOS_SDK) buildArgs.push(`-Dmacos-sdk=${resolve(process.env.AX_CODE_TUI_MACOS_SDK)}`)
  const result = spawnSync(zig, buildArgs, { cwd: NATIVE_SOURCE_ROOT, stdio: "inherit" })
  if (result.status !== 0) throw result.error ?? new Error("Native build failed; vendor artifacts were not updated")
  if (nativeSourceDigest() !== sourceSha256)
    throw new Error("Native source changed during the build; retry before staging artifacts")
  if (test) return

  const license = Buffer.from(
    `${readFileSync(join(NATIVE_SOURCE_ROOT, "LICENSE"), "utf8").trim()}\n\n${readFileSync(join(NATIVE_SOURCE_ROOT, "THIRD_PARTY_LICENSES.txt"), "utf8")}`,
  )
  const artifacts = targets.map((target) => {
    const library = readFileSync(join(NATIVE_SOURCE_ROOT, "lib", target.output, target.libFile))
    assertBinaryFormat(library, target)
    const entry: NativeBuildEntry = {
      os: target.os,
      cpu: target.cpu,
      ...(target.libc ? { libc: target.libc } : {}),
      build: { sourceSha256, zigVersion, target: target.zig, optimize: "ReleaseFast" },
      lib: { file: target.libFile, size: library.byteLength, sha256: sha256(library) },
      licenseSha256: sha256(license),
    }
    return { target, library, entry }
  })
  const manifestPath = join(ROOT, "vendor/manifest.json")
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined
  const entries: Record<string, NativeBuildEntry> = previous?.schemaVersion === 2 ? previous.targets : {}
  for (const { target, library, entry } of artifacts) {
    const directory = join(ROOT, "vendor", target.key)
    mkdirSync(directory, { recursive: true })
    writeNativeArtifact(join(directory, target.libFile), library)
    writeNativeArtifact(join(directory, "LICENSE"), license)
    const previousFile = previous?.targets?.[target.key]?.lib?.file
    if (typeof previousFile === "string" && previousFile !== target.libFile) {
      if (basename(previousFile) !== previousFile || !/\.(?:so|dylib|dll)$/.test(previousFile)) {
        throw new Error(`Invalid previous native library filename: ${previousFile}`)
      }
      rmSync(join(directory, previousFile), { force: true })
    }
    entries[target.key] = entry
  }
  const manifest: NativeBuildManifest = {
    schemaVersion: 2,
    origin: {
      repository: "https://github.com/anomalyco/opentui",
      version: "0.4.1",
      commit: "b7e0bb9c3d2a75c2bc267d2af27b7237f734d13b",
      license: "MIT",
    },
    builtAt: new Date().toISOString(),
    targets: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  }
  writeNativeArtifact(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Built and verified ${targets.length} native libraries from local source ${sourceSha256.slice(0, 12)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
