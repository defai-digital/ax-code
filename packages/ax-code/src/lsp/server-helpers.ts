import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import fs from "fs/promises"
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
import { Glob } from "../util/glob"
import { Module } from "@ax-code/util/module"
export * from "./server-releases"

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

type ModuleResolver = (id: string, dir: string) => string | undefined

export const TYPESCRIPT_SERVER_MODULE = "typescript/lib/tsserver.js"

export const resolveTypescriptServer = (input: { directory?: string; resolve?: ModuleResolver } = {}) =>
  (input.resolve ?? Module.resolve)(TYPESCRIPT_SERVER_MODULE, input.directory ?? Instance.directory)

export const resolveTypescriptSdk = (input: { directory?: string; resolve?: ModuleResolver } = {}) => {
  const tsserver = resolveTypescriptServer(input)
  if (!tsserver) return
  return path.dirname(tsserver)
}

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
  const installTimeoutMs = 120_000
  const proc = Process.spawn(input.install, {
    timeout: installTimeoutMs,
    env: input.env,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  })
  const hasExited = () => proc.exitCode !== null || proc.signalCode !== null
  let exit: number
  try {
    exit = await proc.exited
  } catch {
    if (!hasExited()) await Process.killProcessTree(proc).catch(() => {})
    return
  }
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

export const spawnInfo = (
  bin: string,
  root: string,
  args: string[] = [],
  initialization?: Record<string, any>,
): Handle => {
  const handle = {
    process: spawn(bin, args, {
      cwd: root,
      env: { ...Env.sanitize() },
    }),
  }
  if (!initialization) return handle
  return {
    ...handle,
    initialization,
  }
}

export const bunSpawnInfo = (
  root: string,
  script: string,
  args: string[] = [],
  initialization?: Record<string, any>,
): Handle => {
  const handle = {
    process: spawn(BunProc.which(), [script, ...args], {
      cwd: root,
      env: bunEnv(),
    }),
  }
  if (!initialization) return handle
  return {
    ...handle,
    initialization,
  }
}

export const resolveManagedToolBin = async (input: {
  toolName: string
  managedBin: string
  installedBin?: string | null
  exists?: (path: string) => Promise<boolean>
}) => {
  if (input.installedBin && !input.installedBin.startsWith(Global.Path.bin)) return input.installedBin

  if (await (input.exists ?? pathExists)(input.managedBin)) return input.managedBin

  if (input.installedBin) {
    log.warn(`using legacy unmanaged ${input.toolName} install; remove shared-bin copy to switch to pinned managed installs`, {
      bin: input.installedBin,
    })
    return input.installedBin
  }
}

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

export const nodeModuleScript = (...segments: string[]) => path.join(Global.Path.bin, "node_modules", ...segments)

export const serverHandle = (process: ReturnType<typeof spawn> | undefined, initialization?: Record<string, any>) => {
  if (!process) return
  return { process, initialization }
}

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
        timeout: 120_000,
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

export const bunServerHandle = async (
  input: Parameters<typeof bunServer>[0] & {
    initialization?: Record<string, any>
  },
) => serverHandle(await bunServer(input), input.initialization)

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
