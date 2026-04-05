import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Process } from "../util/process"
import { Log } from "../util/log"

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
export const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

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
