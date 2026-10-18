import { statSync } from "node:fs"
import path from "node:path"
import type { Argv } from "yargs"

export function withProjectDirectory<T>(yargs: Argv<T>) {
  return yargs.option("dir", {
    type: "string",
    describe: "project directory (defaults to the current directory; file arguments remain relative to the caller)",
  })
}

/** Resolve the project without changing process cwd or file argument semantics. */
export function projectDirectory(args: { dir?: unknown }): string {
  if (args.dir === undefined) return process.cwd()
  if (typeof args.dir !== "string" || !args.dir.trim()) throw new Error("--dir must name an existing directory")
  // @scan-suppress security_scan - The local CLI caller explicitly selects the project directory; stat below requires a directory.
  const directory = path.resolve(args.dir)
  let isDirectory: boolean
  try {
    isDirectory = statSync(directory).isDirectory()
  } catch (cause) {
    throw new Error("--dir must name an accessible existing directory", { cause })
  }
  if (!isDirectory) throw new Error("--dir must name an existing directory")
  return directory
}
