/**
 * Sets up the `ax-code` command globally so it can be run from anywhere.
 *
 * Usage: pnpm run setup:cli
 *
 * By default this installs a launcher that targets the locally built bundled
 * CLI so the linked command matches npm/Homebrew runtime behavior. Pass
 * `--source` to install the old source/dev launcher that forwards to Bun.
 */

import childProcess from "child_process"
import fs from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { sourceLauncherScript as generateSourceLauncherScript } from "../packages/ax-code/script/source-launcher"

export const ROOT = path.resolve(import.meta.dir, "..")
const require = createRequire(import.meta.url)
const { candidatePackageNames } = require("./../packages/ax-code/bin/binary-selection.cjs") as {
  candidatePackageNames(options?: { platform?: string; arch?: string; avx2?: boolean; musl?: boolean }): {
    binary: string
    names: string[]
    unsupported?: string
  }
}

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
  writeFileSync?: typeof fs.writeFileSync
  spawnSync?: typeof childProcess.spawnSync
  log?: (msg: string) => void
  which?: typeof Bun.which
}

export function getBunBinDir(
  env: NodeJS.ProcessEnv = process.env,
  which: typeof Bun.which = Bun.which,
): string {
  const bunExe = which("bun")
  if (bunExe) return path.dirname(bunExe)
  const bunPath = env.BUN_INSTALL || path.join(os.homedir(), ".bun")
  return path.join(bunPath, "bin")
}

export function preferredBundledTarget(input: {
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  avx2?: boolean
  musl?: boolean
}) {
  const selection = candidatePackageNames({
    platform: normalizeBinarySelectionPlatform(input.platform ?? process.platform),
    arch: input.arch ?? process.arch,
    avx2: input.avx2,
    musl: input.musl,
  })
  if (selection.unsupported) throw new Error(selection.unsupported)
  const preferred = selection.names[0]
  if (!preferred) {
    throw new Error(`Unsupported local bundled target for setup:cli: ${input.platform ?? process.platform} ${input.arch ?? process.arch}`)
  }
  return {
    binary: selection.binary,
    packageName: preferred,
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
  return path.join(
    input.root ?? ROOT,
    "packages",
    "ax-code",
    "dist",
    preferred.legacyName,
    "bin",
    preferred.binary,
  )
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

export function ensureBundledBinary(input: {
  root?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  avx2?: boolean
  musl?: boolean
  version?: string
  exists?: (target: string) => boolean
  spawnSync?: typeof childProcess.spawnSync
  log?: (msg: string) => void
}) {
  const root = input.root ?? ROOT
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const exists = input.exists ?? fs.existsSync
  const spawnSync = input.spawnSync ?? childProcess.spawnSync
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

  const version =
    input.version
    ?? (JSON.parse(fs.readFileSync(path.join(root, "packages", "ax-code", "package.json"), "utf8")).version as string)
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
  const writeFileSync = input.writeFileSync ?? fs.writeFileSync
  const spawnSync = input.spawnSync ?? childProcess.spawnSync
  const log = input.log ?? console.log
  const which = input.which ?? Bun.which
  const windows = platform === "win32"
  const binDir = getBunBinDir(env, which)

  if (!exists(binDir)) {
    mkdirSync(binDir, { recursive: true })
  }

  // Default to source launcher to avoid Bun compiled-binary bugs
  // (oven-sh/bun#26762, #29124, #27766) that cause TUI hangs in
  // Worker-based architectures. Use --bundled to opt into the compiled
  // binary if needed for distribution.
  const bundledMode = args.includes("--bundled")
  const bundledBinary = bundledMode ? ensureBundledBinary({ root, env, platform, arch, avx2, musl, version, exists, spawnSync, log }) : undefined
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
    writeFileSync(shPath, launcher.unix, { mode: 0o755 })
    log(`Created: ${shPath}`)
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
    log("Need a compiled binary launcher instead?")
    log("  pnpm run setup:cli -- --bundled")
  }
  log("")
  log(`If "ax-code" is not found, ensure ${binDir} is in your PATH.`)
}

if (import.meta.main) {
  setupCli()
}

function normalizeBinarySelectionPlatform(platform: NodeJS.Platform) {
  if (platform === "win32") return "windows"
  return platform
}
