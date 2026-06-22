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

async function canonicalizePermissionTarget(target: string, kind: Kind) {
  const requested = path.resolve(target)
  if (kind === "directory") {
    const parentDir = await fs.realpath(requested).catch(() => requested)
    return {
      filepath: parentDir,
      parentDir,
    }
  }

  const realTarget = await fs.realpath(requested).catch(() => undefined)
  if (realTarget) {
    return {
      filepath: realTarget,
      parentDir: path.dirname(realTarget),
    }
  }

  const requestedParent = path.dirname(requested)
  const parentDir = await fs.realpath(requestedParent).catch(() => requestedParent)
  return {
    filepath: path.join(parentDir, path.basename(requested)),
    parentDir,
  }
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
  const targetPath = path.resolve(target)
  const roots = [Instance.directory]
  if (Instance.worktree !== "/") roots.push(Instance.worktree)
  const projectRoot = roots
    .map((root) => path.resolve(root))
    .filter((root, index, all) => all.indexOf(root) === index)
    .filter((root) => Filesystem.contains(root, targetPath))
    .sort((a, b) => b.length - a.length)[0]
  if (!projectRoot) return
  if (targetPath === projectRoot) return

  const lstat = await fs.lstat(targetPath).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return null
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
  const { filepath, parentDir } = await canonicalizePermissionTarget(target, kind)
  if (Instance.containsPath(filepath)) return

  const glob = path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath,
      parentDir,
    },
  })
}
