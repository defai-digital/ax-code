import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Filesystem } from "@/util/filesystem"

export const diagnostics = (input: Record<string, Record<string, any>[]> | undefined, file: string) => {
  const normalized = Filesystem.normalizePath(file)
  const list = input?.[normalized] ?? []
  return list.filter((item) => item.severity === 1).slice(0, 3)
}

export const normalize = (input?: string) => {
  if (!input) return ""

  const cwd = process.cwd()
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)

  if (!relative) return "."
  if (!relative.startsWith("..")) return relative
  return absolute
}

export const detail = (input: Record<string, any>, omit?: string[]) => {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

export const filetype = (input?: string) => {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language ?? "none"
}

export const workdir = (base: string | undefined, home: string | undefined, input?: string) => {
  if (!input || input === "." || !base) return

  const absolute = path.resolve(base, input)
  if (absolute === base) return
  if (!home) return absolute

  const match = absolute === home || absolute.startsWith(home + path.sep)
  return match ? absolute.replace(home, "~") : absolute
}

// Format a millisecond duration as "Xs" or "Xm Ys". Used by the
// session graph/rollback/dre helpers — the existing util/format
// formatDuration takes seconds, drops trailing "0s" / "0m", and adds
// hour/day/week tiers, none of which match what the sidebar wants.
export const duration = (ms?: number): string => {
  if (ms == null) return "0s"
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}
