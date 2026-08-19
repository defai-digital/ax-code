/**
 * Sets up the `ax-code` command globally so it can be run from anywhere.
 *
 * Usage: pnpm run setup:cli
 *
 * By default this installs a launcher that targets the locally built bundled
 * CLI, matching the Homebrew/curl runtime. Pass `--source` to install a
 * contributor-only launcher that forwards to Node from this checkout.
 */

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { candidateBinaryTargets } from "../packages/ax-code/script/binary-targets"
import { sourceLauncherScript as generateSourceLauncherScript } from "../packages/ax-code/script/source-launcher"
import { whichAllSync, whichSync } from "./which"

export const ROOT = path.resolve(import.meta.dirname, "..")

type WhichFn = (command: string) => string | null | undefined
type WhichAllFn = (command: string) => string[]

type SetupCliOptions = {
  args?: string[]
  root?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  avx2?: boolean
  musl?: boolean
  version?: string
  exists?: (target: string) => boolean
  mkdirSync?: typeof fs.mkdirSync
  readFileSync?: (p: string) => string
  writeFileSync?: typeof fs.writeFileSync
  spawnSync?: typeof childProcess.spawnSync
  log?: (msg: string) => void
  which?: WhichFn
  whichAll?: WhichAllFn
  realpathSync?: (p: string) => string
}

// A package-manager-managed install must not be overwritten: Homebrew links
// bin/ax-code into the read-only Cellar, so writing through it fails with
// EACCES (and would be clobbered by the next brew upgrade anyway).
export function isHomebrewManagedBinary(
  binaryPath: string,
  realpathSync: (p: string) => string = (p) => fs.realpathSync(p),
): boolean {
  try {
    return realpathSync(binaryPath).includes(`${path.sep}Cellar${path.sep}`)
  } catch {
    return false
  }
}

export function getInstallBinDir(
  env: NodeJS.ProcessEnv = process.env,
  which: WhichFn = whichSync,
  platform: NodeJS.Platform = process.platform,
  realpathSync: (p: string) => string = (p) => fs.realpathSync(p),
): string {
  if (env.AX_CODE_BIN_DIR) return env.AX_CODE_BIN_DIR
  const existing = which("ax-code")
  if (existing && !isHomebrewManagedBinary(existing, realpathSync)) return path.dirname(existing)
  if (env.PNPM_HOME) return env.PNPM_HOME
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ax-code", "bin")
  }
  return path.join(os.homedir(), ".local", "bin")
}

export function preferredBundledTarget(input: {
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  avx2?: boolean
  musl?: boolean
}) {
  const selection = candidateBinaryTargets({
    platform: input.platform ?? process.platform,
    arch: input.arch ?? process.arch,
    avx2: input.avx2,
    musl: input.musl,
  })
  if (selection.unsupported) throw new Error(selection.unsupported)
  const preferred = selection.names[0]
  if (!preferred) {
    throw new Error(
      `Unsupported local bundled target for setup:cli: ${input.platform ?? process.platform} ${input.arch ?? process.arch}`,
    )
  }
  return {
    binary: selection.binary,
    legacyName: preferred.replace(/^@[^/]+\//, ""),
  }
}

export function bundledBinaryPath(input: {
  root?: string
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  avx2?: boolean
  musl?: boolean
}) {
  const preferred = preferredBundledTarget(input)
  return path.join(input.root ?? ROOT, "packages", "ax-code", "dist", preferred.legacyName, "bin", preferred.binary)
}

export function bundledBuildMarkerPath(binary: string) {
  return path.join(path.dirname(binary), ".built-from")
}

export function readBundledBuildMarker(
  marker: string,
  readFileSync: (p: string) => string = (p) => fs.readFileSync(p, "utf8"),
) {
  try {
    return readFileSync(marker).trim() || undefined
  } catch {
    return undefined
  }
}

export function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

export function sourceLauncherScript(input: { root?: string; windows?: boolean }) {
  return generateSourceLauncherScript({ root: input.root ?? ROOT, windows: input.windows })
}

export function bundledLauncherScript(input: { binaryPath: string; windows?: boolean }) {
  if (input.windows) {
    return `@echo off\nset AX_CODE_ORIGINAL_CWD=%CD%\n"${input.binaryPath}" %*\n`
  }
  return `#!/bin/sh\nAX_CODE_ORIGINAL_CWD="\$(pwd)" exec "${input.binaryPath.replace(/\\/g, "/")}" "$@"\n`
}

export function setupCliPathNotes(input: {
  binDir: string
  launcherPath: string
  onPath: string | null | undefined
  allOnPath: string[]
  isHomebrew: (binaryPath: string) => boolean
}): string[] {
  const lines: string[] = []
  if (input.onPath && path.dirname(input.onPath) !== input.binDir) {
    lines.push(`Note: "ax-code" currently resolves to ${input.onPath}, which shadows this install.`)
    if (input.isHomebrew(input.onPath)) {
      lines.push(`It is managed by Homebrew — run "brew unlink ax-code" to use this launcher instead.`)
    }
    return lines
  }

  const brewLater = input.allOnPath.filter((p) => path.dirname(p) !== input.binDir && input.isHomebrew(p))
  if (brewLater[0]) {
    lines.push(`Note: this launcher at ${input.launcherPath} is earlier on PATH than Homebrew's ${brewLater[0]}.`)
    lines.push(`"brew upgrade ax-code" will not change the ax-code command until you move this launcher aside:`)
    lines.push(`  mv ${input.launcherPath} ${input.launcherPath}.bak`)
    lines.push(`  hash -r`)
  }
  return lines
}

export function ensureBundledBinary(input: {
  root?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  avx2?: boolean
  musl?: boolean
  version?: string
  rebuild?: boolean
  exists?: (target: string) => boolean
  spawnSync?: typeof childProcess.spawnSync
  readFileSync?: (p: string) => string
  writeFileSync?: typeof fs.writeFileSync
  log?: (msg: string) => void
}) {
  const root = input.root ?? ROOT
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const exists = input.exists ?? fs.existsSync
  const spawnSync = input.spawnSync ?? childProcess.spawnSync
  const readFileSync = input.readFileSync ?? ((p: string) => fs.readFileSync(p, "utf8"))
  const writeFileSync = input.writeFileSync ?? fs.writeFileSync
  const log = input.log ?? console.log
  const preferred = preferredBundledTarget({
    platform,
    arch,
    avx2: input.avx2,
    musl: input.musl,
  })
  const binary = bundledBinaryPath({
    root,
    platform,
    arch,
    avx2: input.avx2,
    musl: input.musl,
  })
  const marker = bundledBuildMarkerPath(binary)
  const expectedRoot = path.resolve(root)
  if (!input.rebuild && exists(binary)) {
    const recordedRoot = exists(marker) ? readBundledBuildMarker(marker, readFileSync) : undefined
    if (recordedRoot && path.resolve(recordedRoot) === expectedRoot) {
      log(`Using existing bundled ax-code CLI for ${preferred.legacyName}: ${binary}`)
      return binary
    }
    log(
      recordedRoot
        ? `Rebuilding bundled ax-code CLI: existing binary was built from ${recordedRoot}, current checkout is ${expectedRoot}`
        : `Rebuilding bundled ax-code CLI: existing binary has no build marker, cannot verify it matches ${expectedRoot}`,
    )
  }

  const version =
    input.version ??
    (JSON.parse(fs.readFileSync(path.join(root, "packages", "ax-code", "package.json"), "utf8")).version as string)
  const channel = buildChannelForVersion(version)
  const buildArgs = ["--dir", "packages/ax-code", "run", "build", "--", "--single"]
  if (preferred.legacyName.includes("-baseline")) buildArgs.push("--baseline")
  if (preferred.legacyName.includes("-musl")) buildArgs.push("--include-abi")
  log(`Building bundled ax-code CLI (${channel}) for ${preferred.legacyName}...`)

  const cmd = platform === "win32" ? "pnpm.cmd" : "pnpm"
  const result = spawnSync(cmd, buildArgs, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...env,
      AX_CODE_VERSION: `v${version}`,
      AX_CODE_CHANNEL: channel,
    },
  })
  if (result.error) throw result.error
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`Failed to build bundled ax-code CLI (exit ${result.status})`)
  }
  if (!exists(binary)) {
    throw new Error(`Bundled ax-code CLI was built, but ${binary} was not found`)
  }
  try {
    writeFileSync(marker, `${expectedRoot}\n`)
  } catch (err) {
    log(`Warning: failed to write bundled build marker at ${marker}: ${(err as Error).message}`)
  }
  return binary
}

export function setupCli(input: SetupCliOptions = {}) {
  const args = input.args ?? process.argv.slice(2)
  const root = input.root ?? ROOT
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const avx2 = input.avx2
  const musl = input.musl
  const version = input.version
  const exists = input.exists ?? fs.existsSync
  const mkdirSync = input.mkdirSync ?? fs.mkdirSync
  const readFileSync = input.readFileSync ?? ((p: string) => fs.readFileSync(p, "utf8"))
  const writeFileSync = input.writeFileSync ?? fs.writeFileSync
  const spawnSync = input.spawnSync ?? childProcess.spawnSync
  const log = input.log ?? console.log
  const which = input.which ?? whichSync
  const whichAll =
    input.whichAll ??
    (input.which
      ? (command: string) => {
          const hit = which(command)
          return hit ? [hit] : []
        }
      : whichAllSync)
  const realpathSync = input.realpathSync ?? ((p: string) => fs.realpathSync(p))
  const windows = platform === "win32"
  const binDir = getInstallBinDir(env, which, platform, realpathSync)

  if (!exists(binDir)) {
    mkdirSync(binDir, { recursive: true })
  }

  const sourceMode = args.includes("--source")
  const bundledMode = !sourceMode
  const rebuildBundled = args.includes("--rebuild")
  const bundledBinary = bundledMode
    ? ensureBundledBinary({
        root,
        env,
        platform,
        arch,
        avx2,
        musl,
        version,
        rebuild: rebuildBundled,
        exists,
        spawnSync,
        readFileSync,
        writeFileSync,
        log,
      })
    : undefined
  const launcher = bundledMode
    ? {
        unix: bundledLauncherScript({
          binaryPath: bundledBinary!,
          windows: false,
        }),
        windows: bundledLauncherScript({
          binaryPath: bundledBinary!,
          windows: true,
        }),
        mode: "bundled",
      }
    : {
        unix: sourceLauncherScript({ root, windows: false }),
        windows: sourceLauncherScript({ root, windows: true }),
        mode: "source",
      }

  if (windows) {
    const cmdPath = path.join(binDir, "ax-code.cmd")
    writeFileSync(cmdPath, launcher.windows)
    log(`Created: ${cmdPath}`)

    const bashPath = path.join(binDir, "ax-code")
    writeFileSync(bashPath, launcher.unix, { mode: 0o755 })
    log(`Created: ${bashPath}`)
  } else {
    const shPath = path.join(binDir, "ax-code")
    try {
      writeFileSync(shPath, launcher.unix, { mode: 0o755 })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EACCES") {
        throw new Error(
          `Permission denied writing ${shPath}. Set AX_CODE_BIN_DIR to a writable directory ` +
            `(e.g. AX_CODE_BIN_DIR="$HOME/.local/bin") or fix the directory's permissions.`,
        )
      }
      throw err
    }
    log(`Created: ${shPath}`)
  }

  // PATH can hide this launcher behind Homebrew, or hide Homebrew behind this
  // launcher. Either way the user types `ax-code` and does not get the binary
  // they just installed / upgraded.
  const launcherPath = windows ? path.join(binDir, "ax-code.cmd") : path.join(binDir, "ax-code")
  const pathNotes = setupCliPathNotes({
    binDir,
    launcherPath,
    onPath: which("ax-code"),
    allOnPath: whichAll("ax-code"),
    isHomebrew: (binaryPath) => isHomebrewManagedBinary(binaryPath, realpathSync),
  })
  if (pathNotes.length) {
    log("")
    for (const line of pathNotes) log(line)
  }

  log("")
  log(`ax-code CLI installed globally (${launcher.mode} launcher)!`)
  log("")
  log("Try it:")
  log("  ax-code --help")
  log("  ax-code providers list")
  log("  ax-code mcp add")
  if (!bundledMode) {
    log("")
    log("Need the packaged-runtime launcher instead?")
    log("  pnpm run setup:cli")
  } else {
    log("")
    log("Need to refresh the bundled binary first?")
    log("  pnpm run setup:cli -- --rebuild")
    log("")
    log("Need a source checkout launcher for development?")
    log("  pnpm run setup:cli -- --source")
  }
  log("")
  log(`If "ax-code" is not found, ensure ${binDir} is in your PATH.`)
}

if (import.meta.main) {
  setupCli()
}
