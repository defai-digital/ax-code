import path from "node:path"

export const AX_WIKI_DIR_DEFAULT = "ax-wiki"
export const AX_WIKI_MANIFEST = ".manifest.json"
export const AX_WIKI_CONFIG = "ax-wiki.config.json"
export const AX_WIKI_INSTRUCTIONS = "ax-wiki.instructions.md"
export const AX_WIKI_START = "<!-- AX-WIKI:START -->"
export const AX_WIKI_END = "<!-- AX-WIKI:END -->"
export const AX_WIKI_PROTECTED_START = "<!-- AX-WIKI:PROTECTED:START"
export const AX_WIKI_PROTECTED_END = "<!-- AX-WIKI:PROTECTED:END -->"
export const INDEX_CANDIDATES = ["quickstart.md", "index.md", "README.md", "Index.md"] as const

export function sanitizeWikiDir(input?: string, fallback = AX_WIKI_DIR_DEFAULT): string {
  const raw = (input ?? "").trim().replace(/\\/g, "/")
  if (!raw) return fallback
  if (path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.startsWith("/")) return fallback
  const parts = raw.split("/").filter((part) => part && part !== ".")
  if (parts.length === 0 || parts.some((part) => part === "..")) return fallback
  return parts.join("/")
}

export function safeRelativePath(input: string): string | undefined {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\.\//, "")
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return undefined
  const parts = normalized.split("/").filter((part) => part && part !== ".")
  if (parts.length === 0 || parts.some((part) => part === "..")) return undefined
  return parts.join("/")
}

export function resolveInside(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relative)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`AX Wiki path escapes repository root: ${relative}`)
  }
  return resolved
}

export function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "")
}
