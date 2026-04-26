import path from "path"
import { promises as fs } from "fs"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

/**
 * Reject when `target` lives inside the project but resolves through a symlink
 * to a path outside the project. No-op for paths already outside the project —
 * those go through the `assertExternalDirectory` permission flow above.
 *
 * Stricter variants (e.g. `write.ts`'s lstat-first dangling-symlink rejection,
 * or `read.ts`'s typed error) intentionally inline their own check.
 */
export async function assertSymlinkInsideProject(target: string): Promise<void> {
  if (!Filesystem.contains(Instance.directory, target)) return
  const real = await fs.realpath(target).catch(() => null)
  if (real && !Filesystem.contains(Instance.directory, real)) {
    throw new Error("Access denied: symlink target escapes project directory")
  }
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  if (Instance.containsPath(target)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? target : path.dirname(target)
  const glob = path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
