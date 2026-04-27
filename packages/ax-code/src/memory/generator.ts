/**
 * Memory Generator
 * Scans project and generates context for system prompt injection
 */

import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import type { EntrySection, MemoryEntry, ProjectMemory, MemorySection, WarmupOptions } from "./types"
import * as store from "./store"

const DEFAULT_MAX_TOKENS = 4000
const DEFAULT_DEPTH = 3

function isFileNotFound(e: unknown): boolean {
  return (e as { code?: string })?.code === "ENOENT"
}

// Approximate token count (1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const TRUNCATE_SUFFIX = "\n... (truncated)"

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  // Reserve room for the suffix so the final result never exceeds maxChars.
  // Without this, estimateTokens(result) over-shoots maxTokens by ~4 per
  // truncated section, breaking the global token budget.
  const sliceLen = Math.max(0, maxChars - TRUNCATE_SUFFIX.length)
  let truncated = text.slice(0, sliceLen)
  const last = truncated.charCodeAt(truncated.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1)
  return truncated + TRUNCATE_SUFFIX
}

/**
 * Scan directory structure
 */
async function scanStructure(root: string, depth: number): Promise<MemorySection> {
  const lines: string[] = []
  const ignore = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    "__pycache__",
    ".ax-code",
    ".vscode",
  ])

  async function walk(dir: string, prefix: string, currentDepth: number) {
    if (currentDepth > depth) return
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const sorted = entries
        .filter((e) => !ignore.has(e.name) && !e.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })

      for (const entry of sorted) {
        const icon = entry.isDirectory() ? "📁" : "📄"
        lines.push(`${prefix}${icon} ${entry.name}`)
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), prefix + "  ", currentDepth + 1)
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await walk(root, "", 1)
  const content = lines.join("\n")
  return { content, tokens: estimateTokens(content) }
}

/**
 * Extract README summary
 */
async function scanReadme(root: string): Promise<MemorySection> {
  const candidates = ["README.md", "readme.md", "README.rst", "README.txt"]
  for (const name of candidates) {
    try {
      const text = await fs.readFile(path.join(root, name), "utf-8")
      // Take first ~500 words
      const words = text.split(/\s+/).slice(0, 500).join(" ")
      return { content: words, tokens: estimateTokens(words) }
    } catch {
      continue
    }
  }
  return { content: "", tokens: 0 }
}

/**
 * Extract key config info
 */
async function scanConfig(root: string): Promise<MemorySection> {
  const parts: string[] = []

  // package.json
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8"))
    parts.push(`Name: ${pkg.name ?? "unknown"}`)
    parts.push(`Version: ${pkg.version ?? "unknown"}`)
    if (pkg.scripts) {
      parts.push(`Scripts: ${Object.keys(pkg.scripts).join(", ")}`)
    }
    if (pkg.dependencies) {
      parts.push(`Dependencies: ${Object.keys(pkg.dependencies).length} packages`)
    }
  } catch (e) {
    if (!isFileNotFound(e) && !(e instanceof SyntaxError)) throw e
  }

  // tsconfig.json
  try {
    const text = await fs.readFile(path.join(root, "tsconfig.json"), "utf-8")
    parts.push(`TypeScript: configured`)
  } catch (e) {
    if (!isFileNotFound(e)) throw e
  }

  // Docker
  try {
    await fs.access(path.join(root, "Dockerfile"))
    parts.push(`Docker: configured`)
  } catch (e) {
    if (!isFileNotFound(e)) throw e
  }

  // Git
  try {
    await fs.access(path.join(root, ".git"))
    parts.push(`Git: initialized`)
  } catch (e) {
    if (!isFileNotFound(e)) throw e
  }

  const content = parts.join("\n")
  return { content, tokens: estimateTokens(content) }
}

/**
 * Detect code patterns and tech stack
 */
async function scanPatterns(root: string): Promise<MemorySection> {
  const patterns: string[] = []

  // Check for common frameworks
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf-8")
    const pkg = JSON.parse(raw)
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    const deps = Object.keys(allDeps)

    if (deps.includes("react")) patterns.push("Framework: React")
    if (deps.includes("vue")) patterns.push("Framework: Vue")
    if (deps.includes("svelte")) patterns.push("Framework: Svelte")
    if (deps.includes("solid-js")) patterns.push("Framework: SolidJS")
    if (deps.includes("next")) patterns.push("Meta-framework: Next.js")
    if (deps.includes("nuxt")) patterns.push("Meta-framework: Nuxt")
    if (deps.includes("express")) patterns.push("Server: Express")
    if (deps.includes("hono")) patterns.push("Server: Hono")
    if (deps.includes("fastify")) patterns.push("Server: Fastify")
    if (deps.includes("drizzle-orm")) patterns.push("ORM: Drizzle")
    if (deps.includes("prisma")) patterns.push("ORM: Prisma")
    if (deps.includes("effect")) patterns.push("Library: Effect")
    if (deps.includes("zod")) patterns.push("Validation: Zod")
    if (deps.includes("tailwindcss")) patterns.push("CSS: Tailwind")
    if (deps.includes("vitest") || deps.includes("jest")) patterns.push("Testing: configured")
  } catch (e) {
    if (!isFileNotFound(e) && !(e instanceof SyntaxError)) throw e
  }

  // Check for Python
  try {
    await fs.access(path.join(root, "pyproject.toml"))
    patterns.push("Language: Python")
  } catch (e) {
    if (!isFileNotFound(e)) throw e
  }

  // Check for Go
  try {
    await fs.access(path.join(root, "go.mod"))
    patterns.push("Language: Go")
  } catch (e) {
    if (!isFileNotFound(e)) throw e
  }

  // Check for Rust
  try {
    await fs.access(path.join(root, "Cargo.toml"))
    patterns.push("Language: Rust")
  } catch (e) {
    if (!isFileNotFound(e)) throw e
  }

  const content = patterns.join("\n")
  return { content, tokens: estimateTokens(content) }
}

function renderEntry(entry: MemoryEntry): string {
  const parts = [`- ${entry.name}: ${entry.body}`]
  if (entry.why) parts.push(`  - Why: ${entry.why}`)
  if (entry.howToApply) parts.push(`  - Apply: ${entry.howToApply}`)
  return parts.join("\n")
}

function entryContent(section: EntrySection | undefined): string {
  if (!section) return ""
  return section.entries.map(renderEntry).join("\n")
}

/**
 * Generate project memory.
 *
 * Recorded entries (userPrefs, feedback, decisions) on disk are preserved —
 * `generate()` only refreshes scanned sections. This lets the warmup CLI run
 * on a schedule without wiping user-curated memories.
 */
export async function generate(root: string, options?: WarmupOptions): Promise<ProjectMemory> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const depth = options?.depth ?? DEFAULT_DEPTH

  const existing = await store.load(root).catch(() => null)

  // Scan all sections in parallel
  const results = await Promise.allSettled([
    scanStructure(root, depth),
    scanReadme(root),
    scanConfig(root),
    scanPatterns(root),
  ])
  const empty: MemorySection = { content: "", tokens: 0 }
  const structure = results[0].status === "fulfilled" ? results[0].value : empty
  const readme = results[1].status === "fulfilled" ? results[1].value : empty
  const config = results[2].status === "fulfilled" ? results[2].value : empty
  const patterns = results[3].status === "fulfilled" ? results[3].value : empty

  // Entry sections (user-curated) are preserved verbatim and given priority.
  // Their tokens are subtracted from the budget so scanned sections shrink to
  // fit — `totalTokens` then never exceeds `maxTokens`.
  const sections: ProjectMemory["sections"] = {}
  if (existing?.sections.userPrefs) sections.userPrefs = existing.sections.userPrefs
  if (existing?.sections.feedback) sections.feedback = existing.sections.feedback
  if (existing?.sections.decisions) sections.decisions = existing.sections.decisions

  const entryTokens =
    (sections.userPrefs?.tokens ?? 0) + (sections.feedback?.tokens ?? 0) + (sections.decisions?.tokens ?? 0)
  let remaining = Math.max(0, maxTokens - entryTokens)

  // Truncate scanned sections within the remaining budget.
  // Priority: patterns > config > structure > readme.
  for (const [key, section] of [
    ["patterns", patterns],
    ["config", config],
    ["structure", structure],
    ["readme", readme],
  ] as const) {
    if (section.tokens > 0 && remaining > 0) {
      const content = truncateToTokens(section.content, remaining)
      const tokens = estimateTokens(content)
      sections[key] = { content, tokens }
      remaining -= tokens
    }
  }

  const totalTokens = Object.values(sections).reduce((sum, s) => sum + (s?.tokens ?? 0), 0)

  // Hash includes both scanned content and rendered entries so any user
  // record change is reflected in the content hash.
  const allContent = [
    sections.patterns?.content ?? "",
    sections.config?.content ?? "",
    sections.structure?.content ?? "",
    sections.readme?.content ?? "",
    entryContent(sections.userPrefs),
    entryContent(sections.feedback),
    entryContent(sections.decisions),
  ].join("\n")
  const contentHash = crypto.createHash("sha256").update(allContent).digest("hex").slice(0, 16)

  const now = new Date().toISOString()

  return {
    version: existing?.version ?? 1,
    created: existing?.created ?? now,
    updated: now,
    projectRoot: root,
    contentHash,
    maxTokens,
    sections,
    totalTokens,
  }
}
