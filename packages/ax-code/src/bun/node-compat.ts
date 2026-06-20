import crypto from "crypto"
import fs from "fs"
import net from "net"
import path from "path"
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
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
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
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true })
  await fs.promises.writeFile(resolved, content instanceof ArrayBuffer ? new Uint8Array(content) : content)
}

function hash(input: string | Uint8Array | ArrayBuffer) {
  const value =
    typeof input === "string"
      ? Buffer.from(input)
      : input instanceof ArrayBuffer
        ? Buffer.from(input)
        : Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  return BigInt(`0x${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`)
}

class Glob {
  constructor(private readonly pattern: string) {}

  async *scan(input: { cwd?: string; absolute?: boolean } = {}) {
    const cwd = input.cwd ?? process.cwd()
    const stack = [cwd]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        const relative = path.relative(cwd, full).split(path.sep).join("/")
        if (!minimatch(relative, this.pattern, { dot: true })) continue
        yield input.absolute ? full : relative
      }
    }
  }

  *scanSync(input: { cwd?: string; absolute?: boolean } = {}) {
    const cwd = input.cwd ?? process.cwd()
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
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        const relative = path.relative(cwd, full).split(path.sep).join("/")
        if (!minimatch(relative, this.pattern, { dot: true })) continue
        yield input.absolute ? full : relative
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
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2
  return 1
}

function stringWidth(input: string) {
  let width = 0
  for (const ch of stripAnsi(input)) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

function which(command: string): string | null {
  return whichLib.sync(command, { nothrow: true })
}

function resolveSync(id: string, parent: string): string {
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
  }
}
