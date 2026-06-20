// Vitest setup (Node test runner). Installs the production Bun→Node compat
// shim, plus test-only Bun.* APIs the suite uses that production src does not
// (kept here so the `check:bun-compat` guard on src stays meaningful), and the
// jest-extended-style matchers Bun's `expect` bundles but vitest lacks.
import { installNodeBunCompat } from "../../src/bun/node-compat"
import { expect } from "vitest"
import { spawnSync as nodeSpawnSync, spawn as nodeSpawn } from "node:child_process"

installNodeBunCompat()

const B = (globalThis as { Bun: Record<string, unknown> }).Bun
B.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
B.gc = () => (globalThis as { gc?: () => void }).gc?.()
B.spawnSync = (input: { cmd: string[]; cwd?: string; env?: Record<string, string> } | string[]) => {
  const cmd = Array.isArray(input) ? input : input.cmd
  const opts = Array.isArray(input) ? {} : input
  const r = nodeSpawnSync(cmd[0]!, cmd.slice(1), { cwd: opts.cwd, env: opts.env ?? process.env })
  return {
    exitCode: r.status ?? (r.signal ? 1 : 0),
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: r.stderr ?? Buffer.alloc(0),
    success: r.status === 0,
    signalCode: r.signal ?? null,
    pid: r.pid ?? 0,
  }
}
B.spawn = (input: { cmd: string[]; cwd?: string; env?: Record<string, string> } | string[]) => {
  const cmd = Array.isArray(input) ? input : input.cmd
  const opts = Array.isArray(input) ? {} : input
  const child = nodeSpawn(cmd[0]!, cmd.slice(1), { cwd: opts.cwd, env: opts.env ?? process.env })
  return {
    pid: child.pid,
    exited: new Promise<number>((res) => child.on("exit", (c) => res(c ?? 0))),
    kill: (sig?: string) => child.kill(sig as NodeJS.Signals),
    stdout: child.stdout,
    stderr: child.stderr,
    stdin: child.stdin,
  }
}

expect.extend({
  toBeFunction: (r) => ({ pass: typeof r === "function", message: () => `expected ${r} to be a function` }),
  toBeNil: (r) => ({ pass: r == null, message: () => `expected ${r} to be nil` }),
  toBeArray: (r) => ({ pass: Array.isArray(r), message: () => `expected ${r} to be an array` }),
  toBeTrue: (r) => ({ pass: r === true, message: () => `expected ${r} to be true` }),
  toBeFalse: (r) => ({ pass: r === false, message: () => `expected ${r} to be false` }),
  toStartWith: (r, p) => ({
    pass: typeof r === "string" && r.startsWith(p),
    message: () => `expected ${r} to start with ${p}`,
  }),
  toEndWith: (r, s) => ({
    pass: typeof r === "string" && r.endsWith(s),
    message: () => `expected ${r} to end with ${s}`,
  }),
  toInclude: (r, s) => ({
    pass: typeof r === "string" && r.includes(s),
    message: () => `expected ${r} to include ${s}`,
  }),
})
