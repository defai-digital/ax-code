import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const OPTIONAL_ENV_FILE_PREFIX = "--optional-env-file="

export function prepareNodeArgs(args, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const exists = options.exists ?? fs.existsSync

  return args.flatMap((arg) => {
    if (!arg.startsWith(OPTIONAL_ENV_FILE_PREFIX)) return [arg]
    const envFile = arg.slice(OPTIONAL_ENV_FILE_PREFIX.length)
    if (!envFile) throw new Error(`${OPTIONAL_ENV_FILE_PREFIX.slice(0, -1)} requires a path`)
    const resolved = path.resolve(cwd, envFile)
    return exists(resolved) ? [`--env-file-if-exists=${resolved}`] : []
  })
}

// Node option flags that consume the following argv token as their value.
// Anything else starting with "--" is treated as value-less when splitting.
const NODE_VALUE_FLAGS = new Set([
  "--import",
  "--loader",
  "--require",
  "-r",
  "--conditions",
  "--input-type",
  "--env-file",
  "--env-file-if-exists",
  "--watch-path",
  "--redirect-warnings",
])

/**
 * Split runner arguments into leading Node option flags, the entry script,
 * and user args. The source launcher hands the runner
 * `--import tsx --import <loader> --conditions=node <entry> [user args…]`;
 * the entry is the first token that is not a Node flag.
 */
export function splitNodeLaunchArgs(args) {
  const nodeFlags = []
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (!arg.startsWith("--") && arg !== "-r") break
    nodeFlags.push(arg)
    index += 1
    if (!arg.includes("=") && NODE_VALUE_FLAGS.has(arg) && index < args.length) {
      nodeFlags.push(args[index])
      index += 1
    }
  }
  const entry = args[index]
  return { nodeFlags, entry, userArgs: entry === undefined ? [] : args.slice(index + 1) }
}

const NODE_OPTIONS_FORBIDDEN_FLAGS = new Set(["--env-file", "--env-file-if-exists"])

/**
 * Split Node flags into those legal in NODE_OPTIONS versus those that must
 * stay on argv. Node rejects `--env-file` / `--env-file-if-exists` in
 * NODE_OPTIONS (`--env-file-if-exists= is not allowed in NODE_OPTIONS`).
 */
export function partitionExecveFlags(nodeFlags) {
  const nodeOptionsFlags = []
  const argvFlags = []
  for (let i = 0; i < nodeFlags.length; i++) {
    const flag = nodeFlags[i]
    const name = flag.split("=")[0]
    if (NODE_OPTIONS_FORBIDDEN_FLAGS.has(name)) {
      argvFlags.push(flag)
      if (!flag.includes("=") && i + 1 < nodeFlags.length && !String(nodeFlags[i + 1]).startsWith("-")) {
        argvFlags.push(nodeFlags[i + 1])
        i += 1
      }
      continue
    }
    nodeOptionsFlags.push(flag)
  }
  return { nodeOptionsFlags, argvFlags }
}

const FILE_IMPORT_EXTENSION = /\.[cm]?[jt]sx?$/i

/**
 * Convert a Node `--import` value for NODE_OPTIONS.
 *
 * Bare package names (`tsx`) stay packages. Filesystem paths must become
 * `file://` URLs: Node treats `src/index.ts` as package `src` (ERR_MODULE_NOT_FOUND),
 * rejects bare Windows absolute paths, and NODE_OPTIONS tokenizes on spaces.
 */
export function toNodeOptionsImportSpecifier(value, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const exists = options.exists ?? fs.existsSync
  if (typeof value !== "string" || value.length === 0) return value
  if (value.startsWith("file:")) return value

  const absolute = path.isAbsolute(value)
  const dottedRelative = value.startsWith(".")
  const hasSeparator = value.includes("/") || value.includes("\\")
  if (!absolute && !dottedRelative && !hasSeparator && !FILE_IMPORT_EXTENSION.test(value)) return value

  const resolved = absolute ? value : path.resolve(cwd, value)
  // `pkg/subpath` is a valid package export. Only rewrite it when it exists
  // as a real file relative to cwd (`src/index-node-tui.ts`).
  if (!absolute && !dottedRelative && !exists(resolved)) return value
  return pathToFileURL(resolved).href
}
