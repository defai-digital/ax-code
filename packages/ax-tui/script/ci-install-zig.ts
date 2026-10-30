/**
 * Install the Zig compiler pinned in `.zig-version` for CI.
 *
 * Recent Apple SDKs publish some `.tbd` stubs only as `arm64e-macos`. Zig
 * 0.15.2 then skips them and fails to link libc. On macOS this copies the
 * active SDK and adds an `arm64-macos` target beside `arm64e-macos`, then
 * points both `AX_CODE_TUI_MACOS_SDK` and `xcrun --show-sdk-path` at the copy.
 */
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const ARCHIVES: Record<string, { name: string; sha256: string }> = {
  "linux-x64": {
    name: "zig-x86_64-linux-0.15.2.tar.xz",
    sha256: "02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239",
  },
  "linux-arm64": {
    name: "zig-aarch64-linux-0.15.2.tar.xz",
    sha256: "958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f",
  },
  "darwin-x64": {
    name: "zig-x86_64-macos-0.15.2.tar.xz",
    sha256: "375b6909fc1495d16fc2c7db9538f707456bfc3373b14ee83fdd3e22b3d43f7f",
  },
  "darwin-arm64": {
    name: "zig-aarch64-macos-0.15.2.tar.xz",
    sha256: "3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b",
  },
  "win32-x64": {
    name: "zig-x86_64-windows-0.15.2.zip",
    sha256: "3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c",
  },
  "win32-arm64": {
    name: "zig-aarch64-windows-0.15.2.zip",
    sha256: "b926465f8872bf983422257cd9ec248bb2b270996fbe8d57872cca13b56fc370",
  },
}

export function zigArchive(platform: NodeJS.Platform, arch: string): { name: string; sha256: string } {
  const archive = ARCHIVES[`${platform}-${arch}`]
  if (!archive) throw new Error(`No pinned Zig 0.15.2 archive for ${platform}-${arch}`)
  return archive
}

/** Zig 0.15.2 reads `arm64-macos` from stub targets and ignores a lone `arm64e-macos`. */
export function patchTbdTargets(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("arm64e-macos") || line.includes("arm64-macos")) return line
      return line.replaceAll("arm64e-macos", "arm64-macos, arm64e-macos")
    })
    .join("\n")
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function hostPath(path: string): string {
  if (process.platform !== "win32") return path
  const converted = spawnSync("cygpath", ["-w", path], { encoding: "utf8" })
  if (converted.status !== 0 || !converted.stdout.trim()) return path
  return converted.stdout.trim()
}

function appendFile(path: string | undefined, line: string): void {
  if (path) writeFileSync(path, `${line}\n`, { flag: "a" })
}

function sdkIsCompatible(sdk: string): boolean {
  const stub = join(sdk, "usr/lib/libSystem.tbd")
  return existsSync(stub) && readFileSync(stub, "utf8").includes("arm64-macos")
}

function walkTbd(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walkTbd(path, files)
    else if (entry.isFile() && entry.name.endsWith(".tbd")) files.push(path)
  }
  return files
}

export function prepareMacosSdk(source: string, destination: string): string {
  // A compatible top-level target list does not guarantee that every exported
  // symbol section has arm64-macos targets. Patch the complete SDK copy.
  source = realpathSync(source)
  if (source === resolve(destination)) throw new Error("The SDK copy must not replace the source SDK")
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  const copied = spawnSync("cp", ["-cR", source, destination], { stdio: "inherit" })
  if (copied.status !== 0 || !existsSync(join(destination, "usr/lib"))) {
    rmSync(destination, { recursive: true, force: true })
    const fallback = spawnSync("cp", ["-R", source, destination], { stdio: "inherit" })
    if (fallback.status !== 0) throw new Error(`Failed to copy macOS SDK from ${source}`)
  }
  if (!existsSync(join(destination, "usr/lib"))) throw new Error(`Failed to copy macOS SDK from ${source}`)
  for (const file of walkTbd(destination)) {
    const original = readFileSync(file, "utf8")
    const patched = patchTbdTargets(original)
    if (patched === original) continue
    chmodSync(file, statSync(file).mode | 0o200)
    writeFileSync(file, patched)
  }
  if (!sdkIsCompatible(destination)) throw new Error(`Patched macOS SDK still has no arm64-macos stub: ${destination}`)
  return destination
}

export const MACOS_XCRUN_WRAPPER = [
  "#!/bin/sh",
  "for arg in \"$@\"; do",
  "  if [ \"$arg\" = \"--show-sdk-path\" ]; then",
  "    printf '%s\\n' \"$AX_CODE_TUI_MACOS_SDK\"",
  "    exit 0",
  "  fi",
  "done",
  "exec /usr/bin/xcrun \"$@\"",
  "",
].join("\n")

export function extractZigArchive(archivePath: string, destination: string): void {
  // Git Bash's GNU tar treats a Windows drive letter as a remote host and
  // cannot read ZIP archives. Windows' bundled bsdtar supports both.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
  const extracted = spawnSync(tar, ["-xf", archivePath, "-C", destination], { stdio: "inherit" })
  if (extracted.status !== 0) throw new Error(`Failed to extract ${archivePath}`)
}

function installZig(version: string): string {
  const archive = zigArchive(process.platform, process.arch)
  if (!archive.name.includes(version)) throw new Error(`${archive.name} is not Zig ${version}`)
  const root = join(process.env.RUNNER_TEMP ?? tmpdir(), "ax-tui-zig")
  const archivePath = join(root, archive.name)
  mkdirSync(root, { recursive: true })
  const download = spawnSync(
    "curl",
    ["-fsSL", "-o", archivePath, `https://ziglang.org/download/${version}/${archive.name}`],
    { stdio: "inherit" },
  )
  if (download.status !== 0) throw new Error(`Failed to download ${archive.name}`)
  const bytes = readFileSync(archivePath)
  const actual = sha256(bytes)
  if (actual !== archive.sha256) throw new Error(`${archive.name} sha256 ${actual} != ${archive.sha256}`)
  extractZigArchive(archivePath, root)
  const executable = join(
    root,
    archive.name.replace(/\.tar\.xz$|\.zip$/, ""),
    process.platform === "win32" ? "zig.exe" : "zig",
  )
  if (!existsSync(executable)) throw new Error(`Zig executable is missing: ${executable}`)
  return executable
}

function activeMacosSdk(): string {
  const shown = spawnSync("xcrun", ["--show-sdk-path"], { encoding: "utf8" })
  if (shown.status !== 0 || !shown.stdout.trim()) throw new Error("xcrun --show-sdk-path failed")
  return shown.stdout.trim()
}

function main(): void {
  const version = readFileSync(join(ROOT, ".zig-version"), "utf8").trim()
  const zig = installZig(version)
  const zigDir = dirname(zig)
  appendFile(process.env.GITHUB_PATH, hostPath(zigDir))
  appendFile(process.env.GITHUB_ENV, `AX_CODE_TUI_ZIG=${hostPath(zig)}`)
  if (process.platform === "win32") {
    // GitHub checks out on D: while Zig's default global cache is on C:.
    // Zig 0.15.2 cannot form relative generator paths across drive letters.
    const cache = join(ROOT, "native", "renderer", ".zig-cache", "global")
    mkdirSync(cache, { recursive: true })
    appendFile(process.env.GITHUB_ENV, `ZIG_GLOBAL_CACHE_DIR=${hostPath(cache)}`)
  }

  if (process.platform === "darwin") {
    const destination = join(process.env.RUNNER_TEMP ?? tmpdir(), "ax-tui-macos-sdk", "MacOSX.sdk")
    const sdk = prepareMacosSdk(process.env.AX_CODE_TUI_MACOS_SDK || activeMacosSdk(), destination)
    const wrapper = join(process.env.RUNNER_TEMP ?? tmpdir(), "ax-tui-xcrun")
    mkdirSync(wrapper, { recursive: true })
    const xcrun = join(wrapper, "xcrun")
    writeFileSync(xcrun, MACOS_XCRUN_WRAPPER)
    chmodSync(xcrun, 0o755)
    appendFile(process.env.GITHUB_PATH, hostPath(wrapper))
    appendFile(process.env.GITHUB_ENV, `AX_CODE_TUI_MACOS_SDK=${hostPath(sdk)}`)
  }
  console.log(`Installed Zig ${version} at ${zig}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
