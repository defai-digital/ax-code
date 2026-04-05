import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Process } from "../util/process"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { which } from "../util/which"
import { spawn } from "./launch"
import { Archive } from "../util/archive"

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
export const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

const bunEnv = () => ({
  ...process.env,
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
  const proc = Process.spawn(input.install, {
    env: input.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
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
      await Process.spawn([BunProc.which(), "install", input.pkg], {
        cwd: Global.Path.bin,
        env: bunEnv(),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
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
}

export const releaseAsset = (assets: Asset[], name: string) =>
  assets.find((item) => item.name === name && item.browser_download_url)

export const installReleaseBin = async (input: {
  id: string
  assetName: string
  url: string
  bin: string
  tarArgs?: string[]
  platform?: string
  fetcher?: (url: string) => Promise<{ ok: boolean; body?: any }>
  writeStream?: (path: string, body: any) => Promise<void>
  extractZip?: (from: string, to: string) => Promise<unknown>
  run?: typeof run
  remove?: (path: string, opts: { force: boolean }) => Promise<unknown>
  exists?: (path: string) => Promise<boolean>
  chmod?: (path: string, mode: number) => Promise<unknown>
}) => {
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(input.url)
  if (!response.ok) {
    log.error(`Failed to download ${input.id}`)
    return
  }

  const temp = path.join(Global.Path.bin, input.assetName)
  if (response.body) {
    await (input.writeStream ?? Filesystem.writeStream)(temp, response.body)
  }

  if (input.assetName.endsWith(".zip")) {
    const ok = await (input.extractZip ?? Archive.extractZip)(temp, Global.Path.bin)
      .then(() => true)
      .catch((error) => {
        log.error(`Failed to extract ${input.id} archive`, { error })
        return false
      })
    if (!ok) return
  } else {
    await (input.run ?? run)(["tar", ...(input.tarArgs ?? ["-xf"]), temp], { cwd: Global.Path.bin })
  }

  await (input.remove ?? fs.rm)(temp, { force: true })

  if (!(await (input.exists ?? Filesystem.exists)(input.bin))) {
    log.error(`Failed to extract ${input.id} binary`)
    return
  }

  const platform = input.platform ?? process.platform
  if (platform !== "win32") {
    await (input.chmod ?? fs.chmod)(input.bin, 0o755).catch(() => {})
  }

  log.info(`installed ${input.id}`, { bin: input.bin })
  return input.bin
}

export const clangdAsset = (assets: Asset[], tag: string, platform: string) => {
  const token: Record<string, string> = {
    darwin: "mac",
    linux: "linux",
    win32: "windows",
  }
  const host = token[platform]
  if (!host) return

  const valid = (item: Asset) => {
    if (!item.name) return false
    if (!item.browser_download_url) return false
    if (!item.name.includes(host)) return false
    return item.name.includes(tag)
  }

  return (
    assets.find((item) => valid(item) && item.name?.endsWith(".zip")) ??
    assets.find((item) => valid(item) && item.name?.endsWith(".tar.xz")) ??
    assets.find((item) => valid(item))
  )
}

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

export type RootFunction = (file: string) => Promise<string | undefined>

export interface ServerInfo {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string): Promise<Handle | undefined>
}

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: Instance.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return Instance.directory
    return path.dirname(first.value)
  }
}
