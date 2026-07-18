import { sha256 } from "./hash"
import { AX_WIKI_PROTECTED_END, AX_WIKI_PROTECTED_START } from "./paths"

export type ProtectedSection = { id: string; raw: string }

const START_PATTERN = /<!-- AX-WIKI:PROTECTED:START\s+([A-Za-z0-9._-]+)\s*-->/g

export function extractProtectedSections(content: string): ProtectedSection[] {
  const sections: ProtectedSection[] = []
  for (const match of content.matchAll(START_PATTERN)) {
    const start = match.index
    const end = content.indexOf(AX_WIKI_PROTECTED_END, start + match[0].length)
    if (end < 0) continue
    sections.push({
      id: match[1]!,
      raw: content.slice(start, end + AX_WIKI_PROTECTED_END.length),
    })
  }
  return sections
}

export function protectedSectionsBalanced(content: string): boolean {
  const token = /<!-- AX-WIKI:PROTECTED:START\s+[A-Za-z0-9._-]+\s*-->|<!-- AX-WIKI:PROTECTED:END -->/g
  let open = false
  for (const match of content.matchAll(token)) {
    const isStart = match[0].startsWith(AX_WIKI_PROTECTED_START)
    if (isStart) {
      if (open) return false
      open = true
    } else {
      if (!open) return false
      open = false
    }
  }
  return !open
}

export function normalizeProtectedContent(content: string): string {
  let output = content
  for (const section of extractProtectedSections(content)) {
    output = output.replace(section.raw, "")
  }
  return output.replace(/\n{3,}/g, "\n\n").trim()
}

export function managedContentHash(content: string): string {
  return sha256(normalizeProtectedContent(content))
}

export function mergeProtectedSections(generated: string, existing?: string): string {
  if (!existing) return generated
  const preserved = extractProtectedSections(existing)
  if (preserved.length === 0) return generated
  let output = generated
  const missing: ProtectedSection[] = []
  for (const section of preserved) {
    const current = extractProtectedSections(output).find((candidate) => candidate.id === section.id)
    if (current) output = output.replace(current.raw, section.raw)
    else missing.push(section)
  }
  if (missing.length === 0) return output
  const block = ["", "## Maintainer Notes", "", ...missing.flatMap((section) => [section.raw, ""])].join("\n")
  const sourcesIndex = output.lastIndexOf("\n## Sources")
  if (sourcesIndex >= 0)
    return `${output.slice(0, sourcesIndex).trimEnd()}\n${block}\n${output.slice(sourcesIndex + 1)}`
  return `${output.trimEnd()}\n${block}`
}
