// Release-notes parser (ADR-242). The parse/resolve helpers are pure so the CLI
// and the TUI can share them and tests can drive them with fixtures; only
// `loadChangelogText` touches the filesystem, as a fallback for source mode.

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Output cap for a single rendered release-notes block, in bytes. */
export const CHANGELOG_MAX_BYTES = 40_000

export const CHANGELOG_TRUNCATION_NOTE =
  "\n\n[... release notes truncated at 40 KB; see CHANGELOG.md for the full text ...]"

export type ChangelogSection = {
  /** Version label without brackets, e.g. "7.26.3" or "Unreleased". */
  version: string
  /** Release date when the heading carried one. */
  date?: string
  /** Verbatim heading text without the leading "## ". */
  heading: string
  /** Markdown body between this heading and the next level-2 heading. */
  body: string
}

export type ChangelogDocument = {
  /** Text before the first level-2 heading (title and preamble). */
  preamble: string
  /** Sections in file order (newest first in the real CHANGELOG). */
  sections: ChangelogSection[]
}

export type RenderedChangelog = { text: string; truncated: boolean }

export type ReleaseNotesOutcome =
  | { status: "ok"; version: string; text: string; truncated: boolean }
  | { status: "not-found"; requested: string; available: string[] }
  | { status: "unavailable" }

// Level-2 headings delimit versions: `## [7.26.3] - 2026-10-16`, `## [Unreleased]`.
// `###` subsections keep the extra `#` so they never match.
function parseHeading(line: string): { version: string; date?: string } | undefined {
  const match = /^##\s+(.+?)\s*$/.exec(line)
  if (!match) return undefined
  const label = match[1].trim()
  if (!label) return undefined
  const dateMatch = /\s*[-–]\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(label)
  const withoutDate = dateMatch ? label.slice(0, dateMatch.index).trim() : label
  const bracket = /^\[(.+)\]$/.exec(withoutDate)
  const version = (bracket ? bracket[1] : withoutDate).trim()
  if (!version) return undefined
  return { version, date: dateMatch?.[1] }
}

export function parseChangelog(text: string): ChangelogDocument {
  const sections: ChangelogSection[] = []
  const preamble: string[] = []
  let current: { version: string; date?: string; heading: string; body: string[] } | undefined
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseHeading(line)
    if (parsed) {
      if (current) sections.push({ ...current, body: current.body.join("\n").trim() })
      current = { ...parsed, heading: line.replace(/^##\s+/, ""), body: [] }
      continue
    }
    if (current) current.body.push(line)
    else preamble.push(line)
  }
  if (current) sections.push({ ...current, body: current.body.join("\n").trim() })
  return { preamble: preamble.join("\n").trim(), sections }
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "").toLowerCase()
}

/** Section for an exact version label (a leading `v` and case are ignored). */
export function findSection(doc: ChangelogDocument, version: string): ChangelogSection | undefined {
  const wanted = normalizeVersion(version)
  return doc.sections.find((section) => normalizeVersion(section.version) === wanted)
}

/** Most recent released section: the first entry that is not `Unreleased`. */
export function latestSection(doc: ChangelogDocument): ChangelogSection | undefined {
  return doc.sections.find((section) => normalizeVersion(section.version) !== "unreleased") ?? doc.sections[0]
}

/** Cap rendered text at `maxBytes`, appending a truncation note when cut. */
export function capChangelog(text: string, maxBytes: number = CHANGELOG_MAX_BYTES): RenderedChangelog {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false }
  const sliced = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")
  return { text: sliced + CHANGELOG_TRUNCATION_NOTE, truncated: true }
}

/** Render one section as markdown (heading plus body) under the byte cap. */
export function renderSection(section: ChangelogSection): RenderedChangelog {
  const heading = `## ${section.heading}`
  const body = section.body ? `\n\n${section.body}` : ""
  return capChangelog(heading + body)
}

/**
 * Resolve the release notes for `version` (or the latest released section when
 * omitted) from an already-loaded changelog string. Pure: no I/O.
 */
export function resolveReleaseNotes(input: { changelog?: string; version?: string }): ReleaseNotesOutcome {
  if (input.changelog === undefined) return { status: "unavailable" }
  const doc = parseChangelog(input.changelog)
  const requested = input.version?.trim()
  const section = requested ? findSection(doc, requested) : latestSection(doc)
  if (!section) {
    return {
      status: "not-found",
      requested: requested ?? "latest",
      available: doc.sections.map((item) => item.version),
    }
  }
  const rendered = renderSection(section)
  return { status: "ok", version: section.version, text: rendered.text, truncated: rendered.truncated }
}

declare const AX_CODE_CHANGELOG: string | undefined

/**
 * Human-readable text for a resolved outcome, shared by the CLI command and the
 * TUI dialog so the two never drift.
 */
export function renderReleaseNotesHuman(outcome: ReleaseNotesOutcome): string {
  if (outcome.status === "unavailable") return "release notes are not bundled in this build"
  if (outcome.status === "not-found") {
    const available = outcome.available.length ? `available: ${outcome.available.join(", ")}` : "no versions found"
    return `no release notes for version ${outcome.requested} (${available})`
  }
  return outcome.text
}

/**
 * Load the changelog text for the current build. Prefers the build-time
 * embedded copy (the `AX_CODE_CHANGELOG` define) and otherwise reads the
 * repository CHANGELOG.md, which only exists in source mode. Returns
 * `undefined` when neither is available so callers can say so.
 */
export async function loadChangelogText(): Promise<string | undefined> {
  if (typeof AX_CODE_CHANGELOG === "string" && AX_CODE_CHANGELOG.length > 0) return AX_CODE_CHANGELOG
  const here = path.dirname(fileURLToPath(import.meta.url))
  // src/util/changelog.ts -> repository root is four levels up.
  const candidates = [
    path.resolve(here, "..", "..", "..", "..", "CHANGELOG.md"),
    path.resolve(process.cwd(), "CHANGELOG.md"),
  ]
  for (const candidate of candidates) {
    const text = await fs.readFile(candidate, "utf8").catch(() => undefined)
    if (text !== undefined && text.length > 0) return text
  }
  return undefined
}
