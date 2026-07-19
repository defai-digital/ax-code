import { describe, expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const docsRoot = path.join(repoRoot, "docs")

function walkMarkdown(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) return walkMarkdown(absolute)
      return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : []
    })
    .sort()
}

function markdownLinks(file: string): string[] {
  let fenced = false
  const source = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return ""
      }
      return fenced ? "" : line
    })
    .join("\n")
  return [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim().replace(/^<|>$/g, ""))
}

function localTarget(source: string, target: string): string | undefined {
  if (/^(?:[a-z]+:|#)/i.test(target)) return
  const pathname = target.split(/[?#]/, 1)[0]
  if (!pathname) return source
  return path.resolve(path.dirname(source), decodeURIComponent(pathname))
}

describe("public documentation navigation", () => {
  const markdown = walkMarkdown(docsRoot)

  test("all local Markdown links resolve", () => {
    const broken = markdown.flatMap((source) =>
      markdownLinks(source).flatMap((link) => {
        const target = localTarget(source, link)
        if (!target || fs.existsSync(target)) return []
        return [`${path.relative(repoRoot, source)} -> ${link}`]
      }),
    )

    expect(broken).toEqual([])
  })

  test("every public Markdown page is reachable from the documentation hub", () => {
    const entrypoint = path.join(docsRoot, "README.md")
    const queue = [entrypoint]
    const reachable = new Set<string>()

    while (queue.length > 0) {
      const source = queue.shift()!
      if (reachable.has(source)) continue
      reachable.add(source)

      for (const link of markdownLinks(source)) {
        const target = localTarget(source, link)
        if (!target || !target.startsWith(`${docsRoot}${path.sep}`) || !target.endsWith(".md")) continue
        if (fs.existsSync(target) && !reachable.has(target)) queue.push(target)
      }
    }

    const orphaned = markdown.filter((file) => !reachable.has(file)).map((file) => path.relative(repoRoot, file))
    expect(orphaned).toEqual([])
  })

  test("every public Markdown page declares lifecycle metadata", () => {
    const invalid = markdown.flatMap((file) => {
      const header = fs.readFileSync(file, "utf8").split("\n").slice(0, 10).join("\n")
      const missing = ["Status", "Scope", "Last reviewed", "Owner"].filter(
        (field) => !new RegExp(`^${field}:\\s*\\S`, "m").test(header),
      )
      return missing.length === 0 ? [] : [`${path.relative(repoRoot, file)}: ${missing.join(", ")}`]
    })

    expect(invalid).toEqual([])
  })
})
