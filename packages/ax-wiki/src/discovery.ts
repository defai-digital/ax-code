import { execFile } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import { open, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { matchesAny } from "./glob.js"
import { sha256 } from "./hash.js"
import { DISCOVERY_READ_CONCURRENCY, mapWithBoundedConcurrency } from "./discovery-concurrency.js"
import { AX_WIKI_CONFIG, AX_WIKI_INSTRUCTIONS, normalizePath, resolveInside } from "./paths.js"
import type { AxWikiConfig, WikiSource } from "./types.js"

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

async function readHashedSource(input: {
  root: string
  relative: string
  maxSourceBytes: number
}): Promise<WikiSource | undefined> {
  const absolute = resolveInside(input.root, input.relative)
  let fh
  try {
    // O_NOFOLLOW refuses out-of-tree symlink escapes without a separate
    // lstat/open race. In-tree symlink sources are skipped.
    fh = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch {
    return undefined
  }
  try {
    const info = await fh.stat()
    if (!info.isFile() || info.size > input.maxSourceBytes) return undefined
    const content = await fh.readFile()
    if (content.includes(0)) return undefined
    const extension = path.posix.extname(input.relative).toLowerCase()
    return {
      path: input.relative,
      hash: sha256(content),
      bytes: content.byteLength,
      category: categoryFor(input.relative),
      language: LANGUAGE_BY_EXTENSION[extension],
    }
  } catch {
    return undefined
  } finally {
    await fh.close()
  }
}

export async function discoverSources(input: {
  root: string
  wikiDir: string
  config?: AxWikiConfig
}): Promise<WikiSource[]> {
  const root = path.resolve(input.root)
  const config = input.config ?? {}
  const candidates = (await gitFiles(root)) ?? (await walkFiles(root))
  const unique = [...new Set(candidates.map(normalizePath))].sort()
  const eligible = unique.filter((relative) => shouldInclude(relative, input.wikiDir, config))
  const hashed = await mapWithBoundedConcurrency(eligible, DISCOVERY_READ_CONCURRENCY, (relative) =>
    readHashedSource({ root, relative, maxSourceBytes: config.maxSourceBytes ?? 512_000 }),
  )
  return hashed.filter((source): source is WikiSource => source !== undefined)
}

function decodeUtf8BytePrefix(buffer: Buffer, maxBytes: number): { content: string; truncated: boolean } {
  const limit = Math.min(buffer.length, Math.max(0, maxBytes))
  const clipped = buffer.subarray(0, limit)
  // stream: true holds an incomplete trailing sequence instead of emitting U+FFFD.
  // Discarding this decoder drops those leftover bytes at a byte-budget clip.
  const content = new TextDecoder("utf-8", { fatal: false }).decode(clipped, { stream: true })
  return { content, truncated: buffer.length > limit }
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
    const raw = await readFile(resolveInside(input.root, source.path)).catch(() => Buffer.alloc(0))
    const { content, truncated } = decodeUtf8BytePrefix(raw, perFile)
    output.push({ ...source, content, truncated })
    remaining -= Buffer.byteLength(content)
  }
  return output
}
