// Ambient declarations that replace `@types/bun`. The `Bun` global is provided
// at runtime by `src/bun/node-compat.ts` (`installNodeBunCompat`) under Node,
// and by the real Bun runtime on the legacy macOS compiled channel. Only the
// surface ax-code actually uses is typed here — the project no longer depends
// on `bun-types`. This file is a global script (no top-level import/export), so
// its declarations are ambient.

interface BunFile {
  text(): Promise<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>
  arrayBuffer(): Promise<ArrayBuffer>
  exists(): Promise<boolean>
}

interface BunShellResult {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
}

interface BunShellPromise extends Promise<BunShellResult> {
  quiet(): BunShellPromise
  nothrow(): BunShellPromise
  cwd(dir: string): BunShellPromise
  env(env: Record<string, string>): BunShellPromise
  text(): Promise<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>
}

interface BunShell {
  (strings: TemplateStringsArray, ...values: unknown[]): BunShellPromise
  env(env?: Record<string, string | undefined>): BunShell
  cwd(dir?: string): BunShell
  ShellError: new (message?: string) => Error & { stderr: Buffer; exitCode: number }
}

interface BunGlobScanOptions {
  cwd?: string
  absolute?: boolean
  onlyFiles?: boolean
  dot?: boolean
}

interface BunGlob {
  scan(input?: BunGlobScanOptions | string): AsyncIterableIterator<string>
  scanSync(input?: BunGlobScanOptions | string): IterableIterator<string>
}

interface BunSocket {
  end(): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface BunServer {
  port?: number
  stop(closeActiveConnections?: boolean): void | Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface BunNamespace {
  version: string
  file(path: string | URL): BunFile
  write(path: string | URL, content: string | Uint8Array | ArrayBuffer): Promise<number>
  hash(input: string | Uint8Array | ArrayBuffer): bigint
  Glob: new (pattern: string) => BunGlob
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(input: { hostname?: string; port: number; socket?: any }): Promise<BunSocket>
  stringWidth(input: string): number
  which(command: string): string | null
  resolveSync(id: string, parent: string): string
  stdin: { text(): Promise<string> }
  $: BunShell
  // Real Bun only; the Node path uses @hono/node-server instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serve(options: any): BunServer
  // Test-runtime extras installed by test/support/vitest.setup.ts.
  sleep(ms: number): Promise<void>
  gc(force?: boolean): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawn(input: any): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawnSync(input: any): any
}

// eslint-disable-next-line no-var
declare var Bun: BunNamespace

// Bun throws a `ResolveMessage` on module-resolution failures; the Node compat
// shim installs a stub so `err instanceof ResolveMessage` resolves under Node.
interface ResolveMessageInstance extends Error {
  code?: string
  specifier?: string
  referrer?: string
  position?: unknown
  importKind?: string
}
// eslint-disable-next-line no-var
declare var ResolveMessage: { new (message?: string): ResolveMessageInstance }

// Bun exposes a global `Timer` type alias for the value setTimeout/setInterval
// return. Node returns NodeJS.Timeout; alias to it so existing annotations hold.
type Timer = ReturnType<typeof setTimeout>

// Bun's `fetch` accepts a superset of the standard RequestInit; the codebase
// annotates one fetch override with it. Alias to the standard init under Node.
type BunFetchRequestInit = RequestInit

// Bun augments ImportMeta with `main` (true when the module is the entry point);
// Node 24+ provides the same. (`import.meta.dir` is Bun-only — use `dirname`.)
interface ImportMeta {
  main?: boolean
}

// The `bun` module surface the test suite imports (aliased to a Node shim at
// runtime by vitest.config.ts).
declare module "bun" {
  export const $: BunShell
  export class Glob {
    constructor(pattern: string)
    scan(input?: BunGlobScanOptions | string): AsyncIterableIterator<string>
    scanSync(input?: BunGlobScanOptions | string): IterableIterator<string>
  }
}

// Tools import their prompt/description text as `import D from "./x.txt"`. Bun
// loads `.txt` as a string; the Node build and vitest both apply a text loader.
declare module "*.txt" {
  const content: string
  export default content
}

// Windows console FFI; loaded via createRequire only when running under Bun.
// Kept so win32.ts (which guards the require behind process.versions.bun) type-checks.
declare module "bun:ffi" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function dlopen(path: string, symbols: any): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function ptr(input: any): any
}
