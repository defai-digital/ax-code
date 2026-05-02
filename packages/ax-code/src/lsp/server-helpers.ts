import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { gunzipSync } from "zlib"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Process } from "../util/process"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Env } from "../util/env"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { which } from "../util/which"
import { spawn } from "./launch"
import { Archive } from "../util/archive"
import { Glob } from "../util/glob"
import { Ssrf } from "../util/ssrf"

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
export const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

const bunEnv = () => ({
  ...Env.sanitize(),
  BUN_BE_BUN: "1",
})

export const globalBin = (name: string, platform = process.platform) =>
  path.join(Global.Path.bin, name + (platform === "win32" ? ".exe" : ""))

export const globalPath = () => (process.env["PATH"] ?? "") + path.delimiter + Global.Path.bin

export const globalTool = (name: string) =>
  which(name, {
    PATH: globalPath(),
  })

export const ensureTool = async (input: {
  name: string
  install: string[]
  env?: Record<string, string | undefined>
  require?: string[]
  missing?: string
  missingLevel?: "info" | "error"
  title?: string
}) => {
  let bin = globalTool(input.name)
  if (bin) return bin

  if (input.require?.some((item) => !which(item))) {
    log[input.missingLevel ?? "error"](input.missing ?? `${input.name} requirements are missing`)
    return
  }

  if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return

  log.info(input.title ?? `installing ${input.name}`)
  // Use "ignore" for stdout/stderr instead of "pipe" — nothing reads the
  // streams here and a "pipe" whose reader is never attached will fill
  // the OS pipe buffer (~64KB on Linux) and the child process will block
  // on write, deadlocking `await proc.exited`. Installers like npm/pnpm
  // produce well more than 64KB of output.
  const proc = Process.spawn(input.install, {
    env: input.env,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  })
  const exit = await proc.exited
  if (exit !== 0) {
    log.error(`Failed to install ${input.name}`)
    return
  }

  bin = globalBin(input.name)
  log.info(`installed ${input.name}`, { bin })
  return bin
}

export const toolBin = async (input: {
  name: string
  install: string[]
  env?: Record<string, string | undefined>
  require?: string[]
  missing?: string
  missingLevel?: "info" | "error"
  title?: string
  global?: (name: string) => string | undefined
  ensure?: typeof ensureTool
}) =>
  (input.global ?? globalTool)(input.name) ??
  (await (input.ensure ?? ensureTool)({
    name: input.name,
    install: input.install,
    env: input.env,
    require: input.require,
    missing: input.missing,
    missingLevel: input.missingLevel,
    title: input.title,
  }))

export const spawnInfo = (bin: string, root: string, args: string[] = [], initialization?: Record<string, any>) => ({
  process: spawn(bin, args, {
    cwd: root,
    env: { ...Env.sanitize() },
  }),
  initialization,
})

export const toolServer = async (
  root: string,
  input: Parameters<typeof toolBin>[0] & {
    args?: string[]
    initialization?: Record<string, any>
  },
) => {
  const bin = await toolBin(input)
  if (!bin) return
  return spawnInfo(bin, root, input.args, input.initialization)
}

export const bunServerArgs = (script: string, args: string[] = []) => ["run", script, ...args]

export const bunServer = async (input: {
  root: string
  binary: string
  script: string
  pkg: string
  args?: string[]
}) => {
  let bin = which(input.binary) ?? null
  let args = [...(input.args ?? [])]

  if (!bin) {
    if (!(await Filesystem.exists(input.script))) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      // Same deadlock hazard as ensureTool above: "pipe" without a
      // reader will block the child once the OS pipe buffer fills.
      // Nothing in this path reads the streams, so discard them.
      await Process.spawn([BunProc.which(), "install", input.pkg], {
        cwd: Global.Path.bin,
        env: bunEnv(),
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      }).exited
    }
    bin = BunProc.which() ?? null
    if (!bin) return
    args = bunServerArgs(input.script, input.args)
  }

  return spawn(bin, args, {
    cwd: input.root,
    env: bunEnv(),
  })
}

export const venvPaths = (root: string) =>
  [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
    (item): item is string => item !== undefined,
  )

export const venvPython = async (root: string) => {
  for (const venv of venvPaths(root)) {
    const isWindows = process.platform === "win32"
    const candidate = isWindows ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python")
    if (await Filesystem.exists(candidate)) return candidate
  }
}

export const venvBin = async (root: string, name: string) => {
  for (const venv of venvPaths(root)) {
    const isWindows = process.platform === "win32"
    const candidate = isWindows ? path.join(venv, "Scripts", `${name}.exe`) : path.join(venv, "bin", name)
    if (await Filesystem.exists(candidate)) return candidate
  }
}

const ZLS = [
  "zls-x86_64-linux.tar.xz",
  "zls-x86_64-macos.tar.xz",
  "zls-x86_64-windows.zip",
  "zls-aarch64-linux.tar.xz",
  "zls-aarch64-macos.tar.xz",
  "zls-aarch64-windows.zip",
  "zls-x86-linux.tar.xz",
  "zls-x86-windows.zip",
]

export const zlsAsset = (platform: string, arch: string) => {
  let host = platform
  if (platform === "darwin") host = "macos"
  if (platform === "win32") host = "windows"

  let cpu = arch
  if (arch === "arm64") cpu = "aarch64"
  if (arch === "x64") cpu = "x86_64"
  if (arch === "ia32") cpu = "x86"

  const ext = platform === "win32" ? "zip" : "tar.xz"
  const name = `zls-${cpu}-${host}.${ext}`
  if (ZLS.includes(name)) return name
}

type Asset = {
  name?: string
  browser_download_url?: string
  digest?: string
}

export const releaseAsset = (assets: Asset[], name: string) =>
  assets.find((item) => item.name === name && item.browser_download_url)

type ReleaseResponse = {
  ok: boolean
  status?: number
  body?: any
  arrayBuffer?: () => Promise<ArrayBuffer>
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

type GitHubRelease = {
  tag_name?: string
  assets?: Asset[]
}

// These pins are intentionally explicit so runtime installs stay
// reproducible. Update them deliberately after verifying upstream
// release compatibility.
export const PINNED_GITHUB_LSP_RELEASES = {
  clangd: { repo: "llvm/llvm-project", tag: "llvmorg-22.1.3" },
  luaLs: { repo: "LuaLS/lua-language-server", tag: "3.15.0" },
  texlab: { repo: "latex-lsp/texlab", tag: "v5.24.0" },
  tinymist: { repo: "Myriad-Dreamin/tinymist", tag: "v0.14.0" },
  elixirLs: { repo: "elixir-lsp/elixir-ls", tag: "v0.30.0" },
} as const

export const PINNED_CHECKSUM_LSP_RELEASES = {
  jdtls: {
    version: "1.58.0",
    assetName: "jdt-language-server-1.58.0-202604151538.tar.gz",
  },
  kotlinLs: { version: "262.2310.0" },
  terraformLs: { version: "0.38.6" },
} as const

export const PINNED_DIRECT_LSP_RELEASES = {
  eslint: {
    version: "3.0.24",
    assetName: "vscode-eslint-3.0.24.vsix.gz",
    sha256: "838bbd653b278529598a08374ba24c89d57994baebd217d0fb8667276a885e56",
    url: "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/dbaeumer/vsextensions/vscode-eslint/3.0.24/vspackage",
  },
} as const

// Keep auto-managed zls installs deterministic. Nightly/dev Zig builds
// must provide their own zls because there is no stable pinned match.
const ZLS_RELEASE_BY_ZIG_MINOR: Record<string, string> = {
  "0.13": "0.13.0",
  "0.14": "0.14.0",
  "0.15": "0.15.1",
  "0.16": "0.16.0",
}

export const managedToolDir = (name: string, version: string, platform = process.platform, arch = process.arch) =>
  path.join(Global.Path.bin, ".managed", name, version, `${platform}-${arch}`)

export const managedToolPath = (
  name: string,
  version: string,
  relativePath: string,
  platform = process.platform,
  arch = process.arch,
) => path.join(managedToolDir(name, version, platform, arch), relativePath)

export const managedToolBin = (name: string, version: string, platform = process.platform, arch = process.arch) =>
  path.join(managedToolDir(name, version, platform, arch), name + (platform === "win32" ? ".exe" : ""))

export const releaseVersion = (tag: string) => tag.replace(/^v/, "")

export const llvmReleaseVersion = (tag: string) => tag.replace(/^llvmorg-/, "")

export const zlsReleaseForZig = (version: string) => {
  const stable = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!stable) return
  return ZLS_RELEASE_BY_ZIG_MINOR[`${stable[1]}.${stable[2]}`]
}

export const releaseAssetSha256 = (asset: Asset) => {
  const match = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)
  return match?.[1].toLowerCase()
}

export const checksumManifestSha256 = (content: string, assetName?: string) => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i)
    if (!match) continue
    if (!assetName) return match[1].toLowerCase()
    if (!match[2]) return match[1].toLowerCase()
    if (match[2]?.trim() === assetName) return match[1].toLowerCase()
  }
}

export const fetchChecksumSha256 = async (input: {
  url: string
  assetName?: string
  label?: string
  fetcher?: (url: string) => Promise<ReleaseResponse>
}) => {
  const fetcher =
    input.fetcher ??
    ((url: string) =>
      Ssrf.pinnedFetch(url, {
        label: input.label ?? "lsp.checksum",
        signal: AbortSignal.timeout(30_000),
      }))
  const response = await fetcher(input.url)
  if (!response.ok) return

  const text =
    (response.text && (await response.text())) ??
    (response.arrayBuffer && Buffer.from(await response.arrayBuffer()).toString("utf8"))
  if (!text) return

  return checksumManifestSha256(text, input.assetName)
}

export const fetchGitHubReleaseByTag = async (input: {
  repo: string
  tag: string
  fetcher?: (url: string) => Promise<ReleaseResponse>
}) => {
  const fetcher =
    input.fetcher ??
    ((url: string) =>
      Ssrf.pinnedFetch(url, {
        label: `github.release.${input.repo.replace("/", ".")}`,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      }))
  const response = await fetcher(`https://api.github.com/repos/${input.repo}/releases/tags/${input.tag}`)
  if (!response.ok || !response.json) return

  const release = (await response.json()) as GitHubRelease
  if (!Array.isArray(release.assets)) return
  return release
}

export const texlabAsset = (platform: string, arch: string) => {
  const texArch = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined
  const texPlatform =
    platform === "darwin" ? "macos" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : undefined
  if (!texArch || !texPlatform) return
  const ext = platform === "win32" ? "zip" : "tar.gz"
  return `texlab-${texArch}-${texPlatform}.${ext}`
}

export const tinymistAsset = (platform: string, arch: string) => {
  const tinymistArch = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined
  let tinymistPlatform: string | undefined
  let ext: string | undefined

  if (platform === "darwin") {
    tinymistPlatform = "apple-darwin"
    ext = "tar.gz"
  } else if (platform === "win32") {
    tinymistPlatform = "pc-windows-msvc"
    ext = "zip"
  } else if (platform === "linux") {
    tinymistPlatform = "unknown-linux-gnu"
    ext = "tar.gz"
  }

  if (!tinymistArch || !tinymistPlatform || !ext) return
  return `tinymist-${tinymistArch}-${tinymistPlatform}.${ext}`
}

export const luaLsReleaseTarget = (platform: string, arch: string) => {
  const luaPlatform =
    platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "win32" : undefined
  const luaArch = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : arch === "ia32" ? "ia32" : undefined
  const ext = platform === "win32" ? "zip" : "tar.gz"
  if (!luaPlatform || !luaArch) return

  const supportedCombos = new Set([
    "darwin-arm64.tar.gz",
    "darwin-x64.tar.gz",
    "linux-x64.tar.gz",
    "linux-arm64.tar.gz",
    "win32-x64.zip",
    "win32-ia32.zip",
  ])

  const assetSuffix = `${luaPlatform}-${luaArch}.${ext}`
  if (!supportedCombos.has(assetSuffix)) return
  return {
    arch: luaArch,
    ext,
    platform: luaPlatform,
  }
}

export const luaLsAsset = (tag: string, platform: string, arch: string) => {
  const target = luaLsReleaseTarget(platform, arch)
  if (!target) return
  return `lua-language-server-${tag}-${target.platform}-${target.arch}.${target.ext}`
}

export const llvmClangdAsset = (tag: string, platform: string, arch: string) => {
  const version = llvmReleaseVersion(tag)
  if (!version) return

  if (platform === "darwin" && arch === "arm64") return `LLVM-${version}-macOS-ARM64.tar.xz`
  if (platform === "linux" && arch === "arm64") return `LLVM-${version}-Linux-ARM64.tar.xz`
  if (platform === "linux" && arch === "x64") return `LLVM-${version}-Linux-X64.tar.xz`
  if (platform === "win32" && arch === "arm64") return `clang+llvm-${version}-aarch64-pc-windows-msvc.tar.xz`
  if (platform === "win32" && arch === "x64") return `clang+llvm-${version}-x86_64-pc-windows-msvc.tar.xz`
}

export const terraformLsReleaseTarget = (platform: string, arch: string) => {
  const tfPlatform =
    platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : undefined
  const tfArch =
    arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : arch === "ia32" ? "386" : arch === "arm" ? "arm" : undefined
  if (!tfPlatform || !tfArch) return

  const supportedCombos = new Set([
    "darwin_amd64.zip",
    "darwin_arm64.zip",
    "linux_386.zip",
    "linux_amd64.zip",
    "linux_arm.zip",
    "linux_arm64.zip",
    "windows_386.zip",
    "windows_amd64.zip",
    "windows_arm64.zip",
  ])

  const assetSuffix = `${tfPlatform}_${tfArch}.zip`
  if (!supportedCombos.has(assetSuffix)) return
  return {
    arch: tfArch,
    platform: tfPlatform,
  }
}

export const terraformLsAsset = (version: string, platform: string, arch: string) => {
  const target = terraformLsReleaseTarget(platform, arch)
  if (!target) return
  return `terraform-ls_${version}_${target.platform}_${target.arch}.zip`
}

export const terraformLsAssetUrl = (version: string, platform: string, arch: string) => {
  const asset = terraformLsAsset(version, platform, arch)
  if (!asset) return
  return `https://releases.hashicorp.com/terraform-ls/${version}/${asset}`
}

export const terraformLsChecksumUrl = (version: string) =>
  `https://releases.hashicorp.com/terraform-ls/${version}/terraform-ls_${version}_SHA256SUMS`

export const kotlinLsReleaseTarget = (platform: string, arch: string) => {
  const kotlinPlatform =
    platform === "darwin" ? "mac" : platform === "linux" ? "linux" : platform === "win32" ? "win" : undefined
  const kotlinArch = arch === "arm64" ? "aarch64" : arch === "x64" ? "x64" : undefined
  if (!kotlinPlatform || !kotlinArch) return
  return {
    arch: kotlinArch,
    platform: kotlinPlatform,
  }
}

export const kotlinLsAsset = (version: string, platform: string, arch: string) => {
  const target = kotlinLsReleaseTarget(platform, arch)
  if (!target) return
  return `kotlin-lsp-${version}-${target.platform}-${target.arch}.zip`
}

export const kotlinLsAssetUrl = (version: string, platform: string, arch: string) => {
  const asset = kotlinLsAsset(version, platform, arch)
  if (!asset) return
  return `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${asset}`
}

export const kotlinLsChecksumUrl = (version: string, platform: string, arch: string) => {
  const asset = kotlinLsAsset(version, platform, arch)
  if (!asset) return
  return `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${asset}.sha256`
}

export const jdtlsAssetUrl = (assetName: string) =>
  `https://www.eclipse.org/downloads/download.php?file=/jdtls/milestones/${PINNED_CHECKSUM_LSP_RELEASES.jdtls.version}/${assetName}`

export const jdtlsChecksumUrl = (assetName: string) =>
  `https://download.eclipse.org/jdtls/milestones/${PINNED_CHECKSUM_LSP_RELEASES.jdtls.version}/${assetName}.sha256`

export const installPinnedGitHubReleaseAsset = async (input: {
  id: string
  repo: string
  tag: string
  assetName: string
  bin: string
  installDir?: string
  platform?: string
  tarArgs?: string[]
  fetchRelease?: typeof fetchGitHubReleaseByTag
  installRelease?: typeof installReleaseBin
}) => {
  const release = await (input.fetchRelease ?? fetchGitHubReleaseByTag)({
    repo: input.repo,
    tag: input.tag,
  })
  if (!release) {
    log.error(`Failed to fetch ${input.id} release info`, { repo: input.repo, tag: input.tag })
    return
  }

  const asset = releaseAsset(release.assets ?? [], input.assetName)
  const sha256 = asset ? releaseAssetSha256(asset) : undefined
  if (!asset?.browser_download_url || !sha256) {
    log.error(`Could not find a verifiable ${input.assetName} asset in ${input.id} release ${input.tag}`)
    return
  }

  return (input.installRelease ?? installReleaseBin)({
    id: input.id,
    assetName: input.assetName,
    url: asset.browser_download_url,
    bin: input.bin,
    installDir: input.installDir,
    platform: input.platform,
    sha256,
    tarArgs: input.tarArgs,
  })
}

export const installPinnedChecksumReleaseAsset = async (input: {
  id: string
  assetName: string
  url: string
  checksumUrl: string
  bin: string
  installDir?: string
  verifyPath?: string
  platform?: string
  tarArgs?: string[]
  archiveType?: "zip" | "tar"
  inflateGzip?: boolean
  skipChmod?: boolean
  fetchChecksum?: typeof fetchChecksumSha256
  installRelease?: typeof installReleaseBin
}) => {
  const sha256 = await (input.fetchChecksum ?? fetchChecksumSha256)({
    assetName: input.assetName,
    label: `lsp.checksum.${input.id}`,
    url: input.checksumUrl,
  })
  if (!sha256) {
    log.error(`Could not find a verifiable checksum for ${input.assetName} in ${input.id} release metadata`)
    return
  }

  return (input.installRelease ?? installReleaseBin)({
    id: input.id,
    assetName: input.assetName,
    url: input.url,
    bin: input.bin,
    installDir: input.installDir,
    verifyPath: input.verifyPath,
    platform: input.platform,
    sha256,
    tarArgs: input.tarArgs,
    archiveType: input.archiveType,
    inflateGzip: input.inflateGzip,
    skipChmod: input.skipChmod,
  })
}

export const installReleaseBin = async (input: {
  id: string
  assetName: string
  url: string
  bin: string
  installDir?: string
  verifyPath?: string
  sha256?: string
  tarArgs?: string[]
  platform?: string
  archiveType?: "zip" | "tar"
  inflateGzip?: boolean
  skipChmod?: boolean
  fetcher?: (url: string) => Promise<ReleaseResponse>
  write?: (path: string, content: string | Buffer | Uint8Array) => Promise<void>
  writeStream?: (path: string, body: any) => Promise<void>
  extractZip?: (from: string, to: string) => Promise<unknown>
  run?: typeof run
  remove?: (path: string, opts: { force: boolean; recursive?: boolean }) => Promise<unknown>
  exists?: (path: string) => Promise<boolean>
  chmod?: (path: string, mode: number) => Promise<unknown>
}) => {
  const fetcher =
    input.fetcher ??
    ((url: string) =>
      Ssrf.pinnedFetch(url, {
        label: `lsp.release.${input.id}`,
        signal: AbortSignal.timeout(60_000),
      }))
  const response = await fetcher(input.url)
  if (!response.ok) {
    log.error(`Failed to download ${input.id}`)
    return
  }

  const installDir = input.installDir ?? path.dirname(input.bin)
  await fs.mkdir(installDir, { recursive: true })

  const temp = path.join(installDir, input.assetName)
  let downloadedArchive: Buffer | undefined
  if (input.sha256) {
    if (!response.arrayBuffer) {
      log.error(`Failed to verify ${input.id} download integrity`)
      return
    }

    const archive = Buffer.from(await response.arrayBuffer())
    const actual = createHash("sha256").update(archive).digest("hex")
    if (actual !== input.sha256.toLowerCase()) {
      log.error(`Failed to verify ${input.id} download integrity`, {
        actual,
        expected: input.sha256.toLowerCase(),
      })
      return
    }
    downloadedArchive = archive
    await (input.write ?? Filesystem.write)(temp, archive)
  } else if (response.body) {
    await (input.writeStream ?? Filesystem.writeStream)(temp, response.body)
  } else if (response.arrayBuffer) {
    const archive = Buffer.from(await response.arrayBuffer())
    downloadedArchive = archive
    await (input.write ?? Filesystem.write)(temp, archive)
  } else {
    log.error(`Failed to download ${input.id}`)
    return
  }

  const archiveType =
    input.archiveType ?? (input.assetName.endsWith(".zip") || input.assetName.endsWith(".vsix") ? "zip" : "tar")
  const extracted = input.inflateGzip ? path.join(installDir, input.assetName.replace(/\.gz$/i, "")) : undefined
  const archive = extracted ?? temp

  try {
    if (extracted) {
      const gz = downloadedArchive ?? (await fs.readFile(temp))
      await (input.write ?? Filesystem.write)(extracted, gunzipSync(gz))
    }

    if (archiveType === "zip") {
      const ok = await (input.extractZip ?? Archive.extractZip)(archive, installDir)
        .then(() => true)
        .catch((error) => {
          log.error(`Failed to extract ${input.id} archive`, { error })
          return false
        })
      if (!ok) return
    } else {
      const tarArgs = input.tarArgs ?? ["-xf"]
      const result = await (input.run ?? run)(["tar", tarArgs[0] ?? "-xf", archive, ...tarArgs.slice(1)], {
        cwd: installDir,
      })
      if (typeof result?.code === "number" && result.code !== 0) {
        log.error(`Failed to extract ${input.id} archive`, {
          code: result.code,
          stderr: result.stderr?.toString(),
        })
        return
      }
    }
  } finally {
    await (input.remove ?? fs.rm)(temp, { force: true })
    if (extracted) {
      await (input.remove ?? fs.rm)(extracted, { force: true })
    }
  }

  const verifyPath = input.verifyPath ?? input.bin
  if (!(await (input.exists ?? Filesystem.exists)(verifyPath))) {
    log.error(`Failed to extract ${input.id} binary`)
    return
  }

  const platform = input.platform ?? process.platform
  if (!input.skipChmod && platform !== "win32") {
    await (input.chmod ?? fs.chmod)(input.bin, 0o755).catch(() => {})
  }

  log.info(`installed ${input.id}`, { bin: input.bin })
  return input.bin
}

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

export type RootFunction = (file: string) => Promise<string | undefined>

export interface ServerInfo {
  id: string
  extensions: string[]
  semantic?: boolean
  priority?: number
  concurrency?: number
  capabilityHints?: Partial<
    Record<
      "hover" | "definition" | "references" | "implementation" | "documentSymbol" | "workspaceSymbol" | "callHierarchy",
      boolean
    >
  >
  global?: boolean
  root: RootFunction
  spawn(root: string): Promise<Handle | undefined>
}

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file) => {
    const hasGlob = (pattern: string) => /[*?[\]{}]/.test(pattern)
    let current = path.dirname(file)
    while (true) {
      if (excludePatterns) {
        for (const pattern of excludePatterns) {
          if (hasGlob(pattern)) {
            const matches = await Glob.scan(pattern, {
              cwd: current,
              absolute: true,
              include: "all",
              dot: true,
            }).catch(() => [])
            if (matches.length > 0) return undefined
          } else if (await Filesystem.exists(path.join(current, pattern))) return undefined
        }
      }
      for (const pattern of includePatterns) {
        if (hasGlob(pattern)) {
          const matches = await Glob.scan(pattern, {
            cwd: current,
            absolute: true,
            include: "all",
            dot: true,
          }).catch(() => [])
          if (matches.length > 0) return current
        } else if (await Filesystem.exists(path.join(current, pattern))) return current
      }
      if (current === Instance.directory) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return Instance.directory
  }
}
