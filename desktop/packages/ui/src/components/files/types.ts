export type FileNode = {
  name: string
  path: string
  type: "file" | "directory"
  extension?: string
  relativePath?: string
}

export type FileStatus = "open" | "modified" | "git-modified" | "git-added" | "git-deleted"
