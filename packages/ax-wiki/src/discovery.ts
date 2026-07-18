import { execFile } from "node:child_process"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { matchesAny } from "./glob"
import { sha256 } from "./hash"
import { AX_WIKI_CONFIG, AX_WIKI_INSTRUCTIONS, normalizePath, resolveInside } from "./paths"
import type { AxWikiConfig, WikiSource } from "./types"

const execFileAsync = promisify(execFile)
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".cache", ".turbo", "coverage"])
const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"])
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".php",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zig",
])

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".go": "Go",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".zig": "Zig",
}

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    })
    return stdout.toString("utf8").split("\0").filter(Boolean).map(normalizePath)
  } catch {
    return undefined
  }
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return output
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...(await walkFiles(root, absolute)))
    else if (entry.isFile() || entry.isSymbolicLink()) output.push(normalizePath(path.relative(root, absolute)))
  }
  return output
}

function categoryFor(file: string): WikiSource["category"] {
  const lower = file.toLowerCase()
  const name = path.posix.basename(lower)
  if (lower.startsWith(".github/") || lower.includes("/workflows/") || lower.includes("/ci/")) return "workflow"
  if (/(^|\/)(test|tests|__tests__|spec|specs)(\/|$)/.test(lower) || /\.(test|spec)\.[^.]+$/.test(lower)) return "test"
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || name.startsWith("readme") || name === "contributing")
    return "documentation"
  if (["package.json", "cargo.toml", "go.mod", "pyproject.toml", "pom.xml", "build.gradle"].includes(name))
    return "configuration"
  if ([".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml"].includes(path.posix.extname(lower))) return "configuration"
  if (LANGUAGE_BY_EXTENSION[path.posix.extname(lower)]) return "code"
  return "other"
}

function shouldInclude(file: string, wikiDir: string, config: AxWikiConfig): boolean {
  const normalized = normalizePath(file)
  if (normalized === AX_WIKI_CONFIG || normalized === AX_WIKI_INSTRUCTIONS) return true
  if (normalized === wikiDir || normalized.startsWith(`${wikiDir}/`)) return false
  if (normalized.split("/").some((segment) => SKIP_DIRS.has(segment))) return false
  if (SKIP_FILES.has(path.posix.basename(normalized))) return false
  const extension = path.posix.extname(normalized).toLowerCase()
  const basename = path.posix.basename(normalized).toLowerCase()
  if (
    !TEXT_EXTENSIONS.has(extension) &&
    !["dockerfile", "makefile", "license", "agents.md", "claude.md"].includes(basename)
  )
    return false
  if (config.include?.length && !matchesAny(normalized, config.include)) return false
  if (matchesAny(normalized, config.exclude)) return false
  return true
}

export async function discoverSources(input: {
  root: string
  wikiDir: string
  config?: AxWikiConfig
}): Promise<WikiSource[]> {
  const root = path.resolve(input.root)
  const rootReal = await realpath(root).catch(() => root)
  const config = input.config ?? {}
  const candidates = (await gitFiles(root)) ?? (await walkFiles(root))
  const unique = [...new Set(candidates.map(normalizePath))].sort()
  const sources: WikiSource[] = []

  for (const relative of unique) {
    if (!shouldInclude(relative, input.wikiDir, config)) continue
    const absolute = resolveInside(root, relative)
    let info
    try {
      info = await lstat(absolute)
      if (info.isSymbolicLink()) {
        const target = await realpath(absolute)
        if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`)) continue
        info = await lstat(target)
      }
    } catch {
      continue
    }
    if (!info.isFile() || info.size > (config.maxSourceBytes ?? 512_000)) continue
    let content: Buffer
    try {
      content = await readFile(absolute)
    } catch {
      continue
    }
    if (content.includes(0)) continue
    const extension = path.posix.extname(relative).toLowerCase()
    sources.push({
      path: relative,
      hash: sha256(content),
      bytes: content.byteLength,
      category: categoryFor(relative),
      language: LANGUAGE_BY_EXTENSION[extension],
    })
  }
  return sources
}

export async function readSourceEvidence(input: {
  root: string
  sources: WikiSource[]
  maxTotalBytes: number
}): Promise<Array<WikiSource & { content: string; truncated: boolean }>> {
  const output: Array<WikiSource & { content: string; truncated: boolean }> = []
  let remaining = Math.max(1, input.maxTotalBytes)
  for (const source of input.sources) {
    if (remaining <= 0) break
    const perFile = Math.min(remaining, 32_000)
    const raw = await readFile(resolveInside(input.root, source.path), "utf8").catch(() => "")
    const content = raw.slice(0, perFile)
    output.push({ ...source, content, truncated: content.length < raw.length })
    remaining -= Buffer.byteLength(content)
  }
  return output
}
