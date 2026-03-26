import fg from "fast-glob"
import { minimatch } from "minimatch"

export namespace Glob {
  export interface Options {
    cwd?: string
    absolute?: boolean
    include?: "file" | "all"
    dot?: boolean
    symlink?: boolean
  }

  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    return fg(pattern, {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      followSymbolicLinks: options.symlink ?? false,
      onlyFiles: options.include !== "all",
    })
  }

  export function scanSync(pattern: string, options: Options = {}): string[] {
    return fg.sync(pattern, {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      followSymbolicLinks: options.symlink ?? false,
      onlyFiles: options.include !== "all",
    })
  }

  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }
}
