// Test harness for @ax-code/ax-code-intel.
//
// The package is environment-agnostic: everything it needs from the outside
// world is injected through the host port (src/host.ts). The ax-code core
// wires a production implementation in packages/ax-code/src/lsp-glue.ts; the
// tests in this package wire a minimal local one instead, so the package's
// unit tests never depend on the core (which would invert the dependency
// graph).
//
// The `Instance`, `Global`, and `Log` exports deliberately mirror the core
// test idioms (`Instance.provide`, `Global.Path.bin`, `Log.init`) so tests
// moved out of packages/ax-code/test keep their original body — only the
// import specifiers change.

import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import spawn from "cross-spawn"
import { configureCodeIntelHost } from "../src/host"

let current = { directory: process.cwd(), worktree: process.cwd() }

export const Instance = {
  provide: async <T>(input: { directory: string; fn: () => T | Promise<T> }): Promise<T> => {
    const previous = current
    current = { directory: input.directory, worktree: input.directory }
    try {
      return await input.fn()
    } finally {
      current = previous
    }
  },
}

export const Global = {
  Path: {
    bin: path.join(os.tmpdir(), "ax-code-intel-test-bin"),
    home: os.homedir(),
  },
}

// Core's Log.init prepares file logging; the package logger (src/internal/log)
// needs no setup, so this is a no-op keeping moved test bodies intact.
export const Log = {
  init: async (_input?: { print?: boolean }) => {},
}

// Per-workspace memoized state, mirroring the core Instance.state contract.
const stateStore = new Map<string, Map<() => unknown, { value: unknown }>>()

configureCodeIntelHost({
  projectRoot: () => current.directory,
  worktreeRoot: () => current.worktree,
  binDir: () => Global.Path.bin,
  homeDir: () => Global.Path.home,
  flags: () => ({
    // Matches the plain-truthiness check the tests themselves perform on this
    // variable, so the flag and the expectation can never disagree.
    disableLspDownload: Boolean(process.env["AX_CODE_DISABLE_LSP_DOWNLOAD"]),
    experimentalLspTy: false,
  }),
  lspConfig: async () => ({}),
  runtime: {
    executable: () => process.execPath,
    kind: () => "node",
    npmExecutable: () => "npm",
    toolRunner: () => ({ command: ["npx", "--yes"] }),
  },
  killTree: async (proc, opts) => {
    if (opts?.exited?.()) return
    proc.kill("SIGTERM")
    const deadline = Date.now() + 2_000
    while (!opts?.exited?.() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!opts?.exited?.()) proc.kill("SIGKILL")
  },
  // Not exercised by this package's tests; hosts with real workspaces provide
  // a ripgrep/glob-backed implementation.
  listFiles: async function* () {},
  subscribeRootMarkerChange: () => () => {},
  publishUpdated: () => {},
  publishClientDiagnostics: () => {},
  state: <S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) => {
    const root = current.directory
    let scoped = stateStore.get(root)
    if (!scoped) {
      scoped = new Map()
      stateStore.set(root, scoped)
    }
    const entries = scoped
    const get = (() => {
      let entry = entries.get(init as () => unknown)
      if (!entry) {
        entry = { value: init() }
        entries.set(init as () => unknown, entry)
      }
      return entry.value as S
    }) as (() => S) & { invalidate: () => Promise<void> }
    get.invalidate = async () => {
      const entry = entries.get(init as () => unknown)
      entries.delete(init as () => unknown)
      if (entry && dispose) await dispose((await entry.value) as Awaited<S>)
    }
    return get
  },
})

// Portable command runner for the tmpdir fixture (same shape as the core
// fixture, which this is ported from).
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
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}

// Ported from packages/ax-code/test/fixture/fixture.ts. The `config` option is
// dropped: it writes a core config file, which this package knows nothing
// about, and no test here uses it.
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
