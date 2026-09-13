import fs from "node:fs"
import path from "node:path"

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
