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
 * Dangling symlinks are rejected so write-mode tools do not silently replace
 * them with regular files.
 */
export async function assertSymlinkInsideProject(target: string): Promise<void> {
  const projectRoot = path.resolve(Instance.directory)
  const targetPath = path.resolve(target)
  if (!Filesystem.contains(projectRoot, targetPath)) return
  if (targetPath === projectRoot) return

  const lstat = await fs.lstat(targetPath).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") return null
    throw err
  })
  if (lstat?.isSymbolicLink()) {
    const real = await fs.realpath(targetPath).catch(() => null)
    if (!real) throw new Error("Access denied: symlink target is dangling or inaccessible")
    if (!Filesystem.contains(projectRoot, real)) {
      throw new Error("Access denied: symlink target escapes project directory")
    }
  }

  let ancestor = path.dirname(targetPath)
  while (ancestor !== projectRoot && Filesystem.contains(projectRoot, ancestor)) {
    const stat = await fs.lstat(ancestor).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") return null
      throw err
    })
    if (!stat) {
      const next = path.dirname(ancestor)
      if (next === ancestor) break
      ancestor = next
      continue
    }

    const realAncestor = await fs.realpath(ancestor).catch(() => null)
    if (!realAncestor) throw new Error("Access denied: parent directory is dangling or inaccessible")
    if (!Filesystem.contains(projectRoot, realAncestor)) {
      throw new Error("Access denied: parent directory escapes project directory")
    }
    break
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
