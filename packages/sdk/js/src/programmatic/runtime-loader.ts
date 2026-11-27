import type { Agent, AgentOptions } from "./types.js"

export type RuntimeModule = {
  createAgent(options: AgentOptions): Promise<Agent>
}

const RUNTIME_SPECIFIER = "ax-code/sdk/programmatic"

// The SDK root is imported by non-Node bundlers, so keep Node built-ins and the
// runtime import out of the static module graph. The Function wrapper hides the
// specifier from bundlers while still using the host's dynamic importer.
const importModule = Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>

const AX_CODE_SPECIFIER_RE = /['"`]ax-code(?:\/[^'"`\s]+)?['"`]/

/**
 * True only when module resolution failed because the `ax-code` package itself
 * is missing. A missing module inside the runtime, or an unrelated package such
 * as `@ax-code/plugin`, is not a missing runtime.
 */
export function isMissingAxCodeRuntimeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as { code?: unknown; message?: unknown }
  if (value.code !== "ERR_MODULE_NOT_FOUND" && value.code !== "MODULE_NOT_FOUND") return false
  return typeof value.message === "string" && AX_CODE_SPECIFIER_RE.test(value.message)
}

export const MISSING_RUNTIME_MESSAGE = [
  "The in-process createAgent() adapter only works from an AX Code source checkout, in a process where ax-code/sdk/programmatic resolves next to the SDK, from the current working directory, or from the entry script's directory.",
  "Run your script through the runtime package's registration shim, for example: pnpm --dir packages/ax-code exec tsx --import ./script/register-node.ts <your script>. The shim sets up the Node compatibility shim, #db resolution, and .txt loading.",
  "The ax-code runtime package is private and is not published to any registry.",
  "Applications should use @defai-digital/ax-code-sdk/headless or @defai-digital/ax-code-sdk/grpc with a signed ax-code executable.",
].join(" ")

type NodeModuleApi = {
  createRequire(filename: string): { resolve(specifier: string): string }
}
type NodeUrlApi = { pathToFileURL(path: string): { href: string } }
type NodePathApi = {
  dirname(path: string): string
  join(...parts: string[]): string
  resolve(...parts: string[]): string
  isAbsolute(path: string): boolean
}
type NodeFsApi = {
  existsSync(path: string): boolean
  realpathSync(path: string): string
  readFileSync(path: string, encoding: "utf8"): string
}

// Capture the entry path and working directory once, at module evaluation, so a
// later `process.chdir()` cannot change which entry directory resolution uses.
// Guarded and total so non-Node bundles, a deleted working directory, or a
// host `process` without a usable `cwd` can still load this module.
function captureHostProcess(): { argv1?: string; cwd?: string } {
  const captured: { argv1?: string; cwd?: string } = {}
  if (typeof process === "undefined" || !process) return captured
  try {
    captured.argv1 = process.argv?.[1]
  } catch {
    // Leave argv1 undefined when the host process does not expose it.
  }
  if (typeof process.cwd === "function") {
    try {
      captured.cwd = process.cwd()
    } catch {
      // Leave cwd undefined when the working directory is deleted or unusable.
    }
  }
  return captured
}

const hostProcess = captureHostProcess()

async function loadNodeBuiltins() {
  const [module, url, path, fs] = await Promise.all([
    importModule<NodeModuleApi>("node:module"),
    importModule<NodeUrlApi>("node:url"),
    importModule<NodePathApi>("node:path"),
    importModule<NodeFsApi>("node:fs"),
  ])
  return { module, url, path, fs }
}

/**
 * True only for a manifest that can resolve `ax-code` subpaths without falling
 * back to `NODE_PATH`: it must be named `ax-code` and expose an `exports` map.
 */
function isAxCodePackageManifest(fs: NodeFsApi, packageJson: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(packageJson, "utf8")) as { name?: unknown; exports?: unknown }
    return manifest.name === "ax-code" && manifest.exports !== undefined
  } catch {
    return false
  }
}

/**
 * Resolve `ax-code/sdk/programmatic` from `base` without consulting global
 * folders such as `NODE_PATH`. Walk from `base` to the filesystem root; at each
 * directory, a `package.json` named `ax-code` with an `exports` field is a
 * self-reference, and a `node_modules/ax-code/package.json` with the same shape
 * is a workspace dependency. An unshaped package is treated as no match so a
 * CommonJS fallback cannot defeat this resolver. The first hit for the base wins,
 * and a resolve failure for that confirmed package propagates unchanged.
 */
function resolveRuntimeFromBase(
  module: NodeModuleApi,
  path: NodePathApi,
  fs: NodeFsApi,
  base: string,
): string | undefined {
  let cursor = base
  while (true) {
    for (const packageJson of [
      path.join(cursor, "package.json"),
      path.join(cursor, "node_modules", "ax-code", "package.json"),
    ]) {
      if (!fs.existsSync(packageJson) || !isAxCodePackageManifest(fs, packageJson)) continue
      return module.createRequire(packageJson).resolve(RUNTIME_SPECIFIER)
    }
    const parent = path.dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

/**
 * Resolve `ax-code/sdk/programmatic` from the host process, trying the current
 * working directory first and the entry script's directory second. Returns
 * `undefined` when neither base can find the `ax-code` package. Resolution and
 * import failures for a confirmed `ax-code` package propagate unchanged.
 */
export async function loadRuntimeFromHost(): Promise<RuntimeModule | undefined> {
  const { module, url, path, fs } = await loadNodeBuiltins()
  const bases: string[] = []
  const addBase = (base: string | undefined) => {
    if (base && fs.existsSync(base) && !bases.includes(base)) bases.push(base)
  }

  addBase(hostProcess.cwd)
  if (hostProcess.argv1) {
    try {
      const entry = path.isAbsolute(hostProcess.argv1)
        ? hostProcess.argv1
        : hostProcess.cwd
          ? path.resolve(hostProcess.cwd, hostProcess.argv1)
          : undefined
      if (entry) addBase(path.dirname(fs.realpathSync(entry)))
    } catch {
      // The entry script is missing or unreadable; skip that base.
    }
  }

  for (const base of bases) {
    const resolved = resolveRuntimeFromBase(module, path, fs, base)
    if (!resolved) continue
    return await importModule<RuntimeModule>(url.pathToFileURL(resolved).href)
  }

  return undefined
}

export async function loadRuntime(): Promise<RuntimeModule> {
  try {
    return await importModule<RuntimeModule>(RUNTIME_SPECIFIER)
  } catch (error) {
    if (!isMissingAxCodeRuntimeError(error)) throw error
    const fallback = await loadRuntimeFromHost()
    if (fallback) return fallback
    throw new Error(MISSING_RUNTIME_MESSAGE, { cause: error })
  }
}
