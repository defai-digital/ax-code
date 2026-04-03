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
