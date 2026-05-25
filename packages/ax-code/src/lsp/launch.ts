import type { ChildProcessWithoutNullStreams } from "child_process"
import { Process } from "../util/process"
import { Env } from "../util/env"
import { Shell } from "../shell/shell"

type Child = Process.Child & ChildProcessWithoutNullStreams
type SpawnOptions = Process.Options & {
  onStderr?: (chunk: Buffer | string) => void
}

export function spawn(cmd: string, args: string[], opts?: SpawnOptions): Child
export function spawn(cmd: string, opts?: SpawnOptions): Child
export function spawn(cmd: string, argsOrOpts?: string[] | SpawnOptions, opts?: SpawnOptions) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts
  const { onStderr, ...processOptions } = cfg ?? {}
  const proc = Process.spawn([cmd, ...args], {
    ...processOptions,
    detached: process.platform !== "win32",
    env: processOptions.env ?? { ...Env.sanitize() },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as Child

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")
  if (onStderr) proc.stderr.on("data", onStderr)

  const kill = () => {
    void Shell.killTree(proc).catch(() => {})
  }
  process.once("exit", kill)
  proc.on("close", () => process.removeListener("exit", kill))

  return proc
}
