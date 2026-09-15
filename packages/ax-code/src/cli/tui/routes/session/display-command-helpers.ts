import path from "path"

export const transcriptFilename = (id: string) => `session-${id.slice(0, 8)}.md`

export function resolveTranscriptExportPath(filename: string) {
  const trimmed = filename.trim()
  if (!trimmed) throw new Error("Export filename is required")
  if (path.isAbsolute(trimmed)) throw new Error("Export filename must be relative to the current workspace")

  const cwd = process.cwd()
  const resolved = path.resolve(cwd, trimmed)
  const relative = path.relative(cwd, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Export filename must stay inside the current workspace")
  }
  return resolved
}
