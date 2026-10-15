import fg from "fast-glob"
import { minimatch } from "minimatch"
import path from "path"

// fast-glob always returns forward-slash paths; normalize to OS separator
function normalizePaths(paths: string[]): string[] {
  if (path.sep === "/") return paths
  return paths.map((p) => p.replace(/\//g, path.sep))
}

export namespace Glob {
  export interface Options {
    cwd?: string
    absolute?: boolean
    include?: "file" | "all"
    dot?: boolean
    symlink?: boolean
  }

  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    const results = await fg(pattern, {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      followSymbolicLinks: options.symlink ?? false,
      onlyFiles: options.include !== "all",
    })
    return normalizePaths(results)
  }

  export function scanSync(pattern: string, options: Options = {}): string[] {
    const results = fg.sync(pattern, {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      followSymbolicLinks: options.symlink ?? false,
      onlyFiles: options.include !== "all",
    })
    return normalizePaths(results)
  }

  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }
}
