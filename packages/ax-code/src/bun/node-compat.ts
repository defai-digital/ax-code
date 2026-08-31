import crypto from "crypto"
import fs from "fs"
import net from "net"
import path from "path"
import { spawn as cpSpawn } from "child_process"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { minimatch } from "minimatch"
import whichLib from "which"
import stripAnsi from "strip-ansi"

type BunFileLike = {
  text: () => Promise<string>
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
  exists: () => Promise<boolean>
}

function normalizePath(input: string | URL) {
  return input instanceof URL ? fileURLToPath(input) : input
}

function file(input: string | URL): BunFileLike {
  const target = normalizePath(input)
  return {
    text: () => fs.promises.readFile(target, "utf8"),
    json: async () => JSON.parse(await fs.promises.readFile(target, "utf8")),
    arrayBuffer: async () => {
      const buffer = await fs.promises.readFile(target)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    },
    exists: () =>
      fs.promises
        .access(target)
        .then(() => true)
        .catch(() => false),
  }
}

async function write(target: string | URL, content: string | Uint8Array | ArrayBuffer) {
  const resolved = normalizePath(target)
  const bytes =
    typeof content === "string"
      ? Buffer.byteLength(content)
      : content instanceof ArrayBuffer
        ? content.byteLength
        : content.byteLength
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true })
  await fs.promises.writeFile(resolved, content instanceof ArrayBuffer ? new Uint8Array(content) : content)
  return bytes
}

// Minimal stand-in for Bun's `$` shell. Supports the surface ax-code uses:
// tagged-template invocation, `.env()`/`.cwd()` binding, `.quiet()`/`.nothrow()`,
// `.text()`/`.json()`, and awaiting (→ { exitCode, stdout, stderr }).
type ShellOpts = { env?: Record<string, string>; cwd?: string }
type ShellResult = { exitCode: number; stdout: Buffer; stderr: Buffer }

class ShellPromise implements PromiseLike<ShellResult> {
  private _quiet = false
  private _nothrow = false
  private _promise: Promise<ShellResult> | undefined
  constructor(
    private readonly cmd: string,
    private opts: ShellOpts,
  ) {}
  quiet() {
    this._quiet = true
    return this
  }
  nothrow() {
    this._nothrow = true
    return this
  }
  cwd(dir: string) {
    this.opts = { ...this.opts, cwd: dir }
    return this
  }
  env(env: Record<string, string>) {
    this.opts = { ...this.opts, env }
    return this
  }
  // Memoized like a real Promise: `$` callers routinely await a ShellPromise
  // and then separately call `.text()`/`.json()`, or chain `.catch()` after
  // an earlier `await`. Re-spawning per accessor would run the underlying
  // command more than once for commands with side effects (e.g. plugin
  // shells running `git commit`, file writes).
  private run(): Promise<ShellResult> {
    if (this._promise) return this._promise
    this._promise = new Promise((resolve, reject) => {
      const child = cpSpawn(this.cmd, {
        shell: true,
        cwd: this.opts.cwd,
        // Bun's `$.env(obj)` REPLACES the environment with `obj` (the shell
        // inherits process.env only when .env() is never called). Do not merge
        // process.env in as a base: callers pass an already-prepared env (e.g.
        // `Env.sanitize(process.env)` for plugin shells, which strips secret
        // keys by omitting them). Merging would reintroduce every stripped
        // secret from process.env, letting a plugin exfiltrate provider tokens.
        env: this.opts.env ?? process.env,
      })
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout?.on("data", (d: Buffer) => {
        out.push(d)
        if (!this._quiet) process.stdout.write(d)
      })
      child.stderr?.on("data", (d: Buffer) => {
        err.push(d)
        if (!this._quiet) process.stderr.write(d)
      })
      child.once("error", reject)
      child.once("close", (code) => {
        const result: ShellResult = { exitCode: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }
        if (result.exitCode !== 0 && !this._nothrow) {
          reject(new Error(`command failed (exit ${result.exitCode}): ${this.cmd}\n${result.stderr.toString()}`))
          return
        }
        resolve(result)
      })
    })
    return this._promise
  }
  async text() {
    return (await this.run()).stdout.toString()
  }
  async json() {
    return JSON.parse((await this.run()).stdout.toString())
  }
  then<R1 = ShellResult, R2 = never>(
    onF?: ((v: ShellResult) => R1 | PromiseLike<R1>) | null,
    onR?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onF, onR)
  }
  // Bun's ShellPromise supports the full Promise surface, including `.catch()`
  // and `.finally()`; callers chain these directly off `$\`...\`.cwd().quiet()`.
  catch<R = never>(onR?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<ShellResult | R> {
    return this.run().catch(onR)
  }
  finally(onFinally?: (() => void) | null): Promise<ShellResult> {
    return this.run().finally(onFinally)
  }
}

// Single-quote one interpolated value so the shell treats it as one literal arg.
function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function makeShell(base: ShellOpts = {}) {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let cmd = ""
    strings.forEach((s, i) => {
      cmd += s
      if (i < values.length) {
        const value = values[i]
        // Bun's `$` flattens an interpolated array into separate, individually
        // escaped, space-separated arguments (e.g. ${["a", "b"]} → 'a' 'b').
        // Plain `String([...])` would instead produce the comma-joined "a,b".
        cmd += Array.isArray(value) ? value.map(shellQuote).join(" ") : shellQuote(value)
      }
    })
    return new ShellPromise(cmd, base)
  }
  tag.env = (env: Record<string, string>) => makeShell({ ...base, env })
  tag.cwd = (cwd: string) => makeShell({ ...base, cwd })
  return tag
}

export function hash(input: string | Uint8Array | ArrayBuffer) {
  const value =
    typeof input === "string"
      ? Buffer.from(input)
      : input instanceof ArrayBuffer
        ? Buffer.from(input)
        : Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  return BigInt(`0x${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`)
}

export class Glob {
  constructor(private readonly pattern: string) {}

  private options(input: { cwd?: string; absolute?: boolean; onlyFiles?: boolean; dot?: boolean } | string = {}) {
    return typeof input === "string" ? { cwd: input } : input
  }

  async *scan(input: { cwd?: string; absolute?: boolean; onlyFiles?: boolean; dot?: boolean } | string = {}) {
    const options = this.options(input)
    const cwd = options.cwd ?? process.cwd()
    const stack = [cwd]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        const relative = path.relative(cwd, full).split(path.sep).join("/")
        if (entry.isDirectory()) {
          if (options.onlyFiles === false && minimatch(relative, this.pattern, { dot: options.dot ?? false })) {
            yield options.absolute ? full : relative
          }
          stack.push(full)
          continue
        }
        if (!minimatch(relative, this.pattern, { dot: options.dot ?? false })) continue
        yield options.absolute ? full : relative
      }
    }
  }

  *scanSync(input: { cwd?: string; absolute?: boolean; onlyFiles?: boolean; dot?: boolean } | string = {}) {
    const options = this.options(input)
    const cwd = options.cwd ?? process.cwd()
    const stack = [cwd]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        const relative = path.relative(cwd, full).split(path.sep).join("/")
        if (entry.isDirectory()) {
          if (options.onlyFiles === false && minimatch(relative, this.pattern, { dot: options.dot ?? false })) {
            yield options.absolute ? full : relative
          }
          stack.push(full)
          continue
        }
        if (!minimatch(relative, this.pattern, { dot: options.dot ?? false })) continue
        yield options.absolute ? full : relative
      }
    }
  }
}

async function connect(input: { hostname?: string; port: number }) {
  return new Promise<{ end: () => void }>((resolve, reject) => {
    const socket = net.connect({ host: input.hostname, port: input.port })
    socket.once("connect", () => resolve({ end: () => socket.end() }))
    socket.once("error", reject)
  })
}

// Emoji/dingbat code points the TUI's native renderer (vendored from upstream
// sst/opentui; see packages/ax-code-tui/vendor/manifest.json and the
// `eawToWidth` table in that project's packages/core/src/zig/utf8.zig) always
// draws two columns wide, even though their Unicode East Asian Width property
// is Ambiguous/Neutral rather than Wide/Fullwidth. This table is transcribed
// from that native function so this shim's notion of "wide" stays in lockstep
// with what actually lands on screen; a blanket 0x1f300-0x1faff range both
// missed wide symbols below 0x1f300 (e.g. U+231A watch, U+2705 check mark,
// U+26A1-adjacent status glyphs) and over-counted narrow gaps inside that
// range, so cursor/wrap/truncate math drifted from the real render for any
// line containing them. Sorted, non-overlapping — keep it that way for the
// binary search in isNativeWideEmoji.
const NATIVE_WIDE_EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2622, 0x2623],
  [0x2630, 0x2637],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x269b, 0x269b],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d1, 0x26d1],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2760, 0x2767],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x1f000, 0x1f02b],
  [0x1f030, 0x1f093],
  [0x1f0a0, 0x1f0ae],
  [0x1f0b1, 0x1f0bf],
  [0x1f0c1, 0x1f0cf],
  [0x1f0d1, 0x1f0f5],
  [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f3ff],
  [0x1f400, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f700, 0x1f773],
  [0x1f780, 0x1f7d8],
  [0x1f7e0, 0x1f7eb],
  [0x1f800, 0x1f80b],
  [0x1f810, 0x1f847],
  [0x1f850, 0x1f859],
  [0x1f860, 0x1f887],
  [0x1f890, 0x1f8ad],
  [0x1f8b0, 0x1f8b1],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1fa53],
  [0x1fa60, 0x1fa6d],
  [0x1fa70, 0x1fa74],
  [0x1fa78, 0x1fa7c],
  [0x1fa80, 0x1fa86],
  [0x1fa90, 0x1faac],
  [0x1fab0, 0x1faba],
  [0x1fac0, 0x1fac5],
  [0x1fad0, 0x1fad9],
  [0x1fae0, 0x1fae7],
  [0x1faf0, 0x1faf8],
]

function isNativeWideEmoji(cp: number): boolean {
  let lo = 0
  let hi = NATIVE_WIDE_EMOJI_RANGES.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end] = NATIVE_WIDE_EMOJI_RANGES[mid]
    if (cp < start) hi = mid - 1
    else if (cp > end) lo = mid + 1
    else return true
  }
  return false
}

// Terminal column width, approximating Bun.stringWidth: ANSI escapes count as
// 0, zero-width/combining marks as 0, wide CJK/emoji as 2, everything else 1.
// The previous shim counted code points, which misaligns TUI layout for wide
// characters and ANSI-styled strings.
function charWidth(cp: number): number {
  if (cp === 0) return 0
  // C0/C1 control characters
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  // Combining marks / zero-width
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0xfeff ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff)
  )
    return 0
  // Wide ranges: CJK, Hangul, Kana, fullwidth forms, common emoji blocks
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    isNativeWideEmoji(cp)
  )
    return 2
  return 1
}

export function stringWidth(input: string) {
  let width = 0
  for (const ch of stripAnsi(input)) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

function which(command: string): string | null {
  return whichLib.sync(command, { nothrow: true })
}

export function resolveSync(id: string, parent: string): string {
  // Bun.resolveSync(id, dir) resolves relative to a directory. createRequire
  // needs a "from" path; a (possibly non-existent) file inside the dir gives
  // node the right resolution base. Throws on failure, like Bun.resolveSync.
  return createRequire(path.join(parent, "_ax_resolve_base_.js")).resolve(id)
}

// Bun throws a `ResolveMessage` instance on module-resolution failures and code
// does `err instanceof ResolveMessage`. Node has no such global; define a stub
// so the instanceof check resolves to false instead of a ReferenceError.
class ResolveMessage extends Error {
  code?: string
  specifier?: string
  referrer?: string
  position?: unknown
  importKind?: string
  constructor(message?: string) {
    super(message)
    this.name = "ResolveMessage"
  }
}

async function stdinText() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

export function installNodeBunCompat() {
  const g = globalThis as { Bun?: unknown; ResolveMessage?: unknown }
  // Always expose ResolveMessage (a separate global from Bun) so `instanceof`
  // checks in error handling don't throw under Node.
  if (!g.ResolveMessage) g.ResolveMessage = ResolveMessage
  if (g.Bun) return
  g.Bun = {
    version: process.version.replace(/^v/, ""),
    file,
    write,
    hash,
    Glob,
    connect,
    stringWidth,
    which,
    resolveSync,
    stdin: { text: stdinText },
    $: makeShell(),
  }
}
