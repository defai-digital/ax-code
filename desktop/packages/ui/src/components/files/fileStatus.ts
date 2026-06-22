import type { GitStatus } from "@/lib/api/types"
import type { FileStatus } from "./types"

export const getFileStatusForPath = (
  path: string,
  options: {
    root: string
    isOpen: (path: string) => boolean
    gitStatus: GitStatus | null | undefined
  },
): FileStatus | null => {
  if (options.isOpen(path)) return "open"

  const files = options.gitStatus?.files
  if (!files) return null

  const relative = path.startsWith(`${options.root}/`) ? path.slice(options.root.length + 1) : path
  const file = files.find((entry) => entry.path === relative)
  if (!file) return null

  if (file.index === "A" || file.working_dir === "?") return "git-added"
  if (file.index === "D") return "git-deleted"
  if (file.index === "M" || file.working_dir === "M") return "git-modified"
  return null
}
