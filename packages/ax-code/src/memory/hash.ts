/**
 * Canonical content-hash computation shared by `generator.generate()` and
 * `recorder.recomputeMetrics()`.
 *
 * Both paths previously computed contentHash with different inputs:
 *   - generator: a fixed 7-slot string (patterns/config/structure/readme/
 *     userPrefs/feedback/decisions, empty strings for missing sections).
 *   - recorder: `Object.values(memory.sections)` skipping undefined entries.
 *
 * That meant the same logical memory state produced different hashes
 * depending on which code path last touched it (warmup hash != record/remove
 * hash even when net content was equivalent), so `memory status` would show
 * spurious "changed" indications.
 */

import crypto from "crypto"
import type { EntrySection, MemoryEntry, ProjectMemory } from "./types"

export function renderEntry(entry: MemoryEntry): string {
  const parts = [`- ${entry.name}: ${entry.body}`]
  if (entry.why) parts.push(`  - Why: ${entry.why}`)
  if (entry.howToApply) parts.push(`  - Apply: ${entry.howToApply}`)
  return parts.join("\n")
}

export function entryContent(section: EntrySection | undefined): string {
  if (!section) return ""
  return section.entries.map(renderEntry).join("\n")
}

export function computeContentHash(memory: ProjectMemory): string {
  const allContent = [
    memory.sections.patterns?.content ?? "",
    memory.sections.config?.content ?? "",
    memory.sections.structure?.content ?? "",
    memory.sections.readme?.content ?? "",
    entryContent(memory.sections.userPrefs),
    entryContent(memory.sections.feedback),
    entryContent(memory.sections.decisions),
    entryContent(memory.sections.reference),
  ].join("\n")
  return crypto.createHash("sha256").update(allContent).digest("hex").slice(0, 16)
}
