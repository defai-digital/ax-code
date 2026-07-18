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
