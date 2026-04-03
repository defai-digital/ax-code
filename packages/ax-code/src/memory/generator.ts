/**
 * Memory Generator
 * Scans project and generates context for system prompt injection
 */

import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import type { ProjectMemory, MemorySection, WarmupOptions } from "./types"

const DEFAULT_MAX_TOKENS = 4000
const DEFAULT_DEPTH = 3

function isFileNotFound(e: unknown): boolean {
  return (e as any)?.code === "ENOENT"
}

// Approximate token count (1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + "\n... (truncated)"
}

/**
 * Scan directory structure
 */
async function scanStructure(root: string, depth: number): Promise<MemorySection> {
  const lines: string[] = []
  const ignore = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".output", "coverage", "__pycache__", ".ax-code", ".vscode"])

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
  } catch (e) { if (!isFileNotFound(e)) throw e }

  // tsconfig.json
  try {
    const text = await fs.readFile(path.join(root, "tsconfig.json"), "utf-8")
    parts.push(`TypeScript: configured`)
  } catch (e) { if (!isFileNotFound(e)) throw e }

  // Docker
  try {
    await fs.access(path.join(root, "Dockerfile"))
    parts.push(`Docker: configured`)
  } catch (e) { if (!isFileNotFound(e)) throw e }

  // Git
  try {
    await fs.access(path.join(root, ".git"))
    parts.push(`Git: initialized`)
  } catch (e) { if (!isFileNotFound(e)) throw e }

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
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8"))
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
  } catch (e) { if (!isFileNotFound(e)) throw e }

  // Check for Python
  try {
    await fs.access(path.join(root, "pyproject.toml"))
    patterns.push("Language: Python")
  } catch (e) { if (!isFileNotFound(e)) throw e }

  // Check for Go
  try {
    await fs.access(path.join(root, "go.mod"))
    patterns.push("Language: Go")
  } catch (e) { if (!isFileNotFound(e)) throw e }

  // Check for Rust
  try {
    await fs.access(path.join(root, "Cargo.toml"))
    patterns.push("Language: Rust")
  } catch (e) { if (!isFileNotFound(e)) throw e }

  const content = patterns.join("\n")
  return { content, tokens: estimateTokens(content) }
}

/**
 * Generate project memory
 */
export async function generate(root: string, options?: WarmupOptions): Promise<ProjectMemory> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const depth = options?.depth ?? DEFAULT_DEPTH

  // Scan all sections in parallel
  const [structure, readme, config, patterns] = await Promise.all([
    scanStructure(root, depth),
    scanReadme(root),
    scanConfig(root),
    scanPatterns(root),
  ])

  // Calculate token budget per section
  let totalTokens = structure.tokens + readme.tokens + config.tokens + patterns.tokens

  // Truncate if over budget (prioritize: patterns > config > structure > readme)
  const sections: ProjectMemory["sections"] = {}
  let remaining = maxTokens

  if (patterns.tokens > 0 && remaining > 0) {
    sections.patterns = { content: truncateToTokens(patterns.content, remaining), tokens: Math.min(patterns.tokens, remaining) }
    remaining -= sections.patterns.tokens
  }
  if (config.tokens > 0 && remaining > 0) {
    sections.config = { content: truncateToTokens(config.content, remaining), tokens: Math.min(config.tokens, remaining) }
    remaining -= sections.config.tokens
  }
  if (structure.tokens > 0 && remaining > 0) {
    sections.structure = { content: truncateToTokens(structure.content, remaining), tokens: Math.min(structure.tokens, remaining) }
    remaining -= sections.structure.tokens
  }
  if (readme.tokens > 0 && remaining > 0) {
    sections.readme = { content: truncateToTokens(readme.content, remaining), tokens: Math.min(readme.tokens, remaining) }
    remaining -= sections.readme.tokens
  }

  totalTokens = Object.values(sections).reduce((sum, s) => sum + (s?.tokens ?? 0), 0)

  // Content hash for change detection
  const allContent = Object.values(sections).map((s) => s?.content ?? "").join("\n")
  const contentHash = crypto.createHash("sha256").update(allContent).digest("hex").slice(0, 16)

  const now = new Date().toISOString()

  return {
    version: 1,
    created: now,
    updated: now,
    projectRoot: root,
    contentHash,
    maxTokens,
    sections,
    totalTokens,
  }
}
