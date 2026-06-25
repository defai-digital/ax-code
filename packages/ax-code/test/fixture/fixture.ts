import spawn from "cross-spawn"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"

// Portable command runner (replaces Bun's `$` so the fixture works under both
// `bun test` and the Node/vitest runner). cross-spawn is already a dependency.
function run(cmd: string, args: string[], opts: { cwd: string; nothrow?: boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: "ignore" })
    child.on("exit", (code) =>
      code === 0 || opts.nothrow ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`)),
    )
    child.on("error", (err) => (opts.nothrow ? resolve() : reject(err)))
  })
}

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

function exists(dir: string) {
  return fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)
}

function clean(dir: string) {
  return fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

async function stop(dir: string) {
  if (!(await exists(dir))) return
  await run("git", ["fsmonitor--daemon", "stop"], { cwd: dir, nothrow: true })
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    await run("git", ["init"], { cwd: dirpath })
    await run("git", ["config", "core.fsmonitor", "false"], { cwd: dirpath })
    await run("git", ["config", "user.email", "test@opencode.test"], { cwd: dirpath })
    await run("git", ["config", "user.name", "Test"], { cwd: dirpath })
    await run("git", ["commit", "--allow-empty", "-m", `root commit ${dirpath}`], { cwd: dirpath })
  }
  if (options?.config) {
    await fs.writeFile(
      path.join(dirpath, "ax-code.json"),
      JSON.stringify({
        $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
        ...options.config,
      }),
    )
  }
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const extra = await options?.init?.(realpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      try {
        await options?.dispose?.(realpath)
      } finally {
        if (options?.git) await stop(realpath).catch(() => undefined)
        await clean(realpath).catch(() => undefined)
      }
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}
