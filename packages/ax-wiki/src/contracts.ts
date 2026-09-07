// Neutral, versioned evidence contracts for AX Wiki repository-intelligence.
//
// These types are the typed surface that semantic context crosses module boundaries
// on. They are intentionally framework/product-agnostic: no AX Code runtime, LSP
// process, or provider types appear here. Semantic context must never cross as an
// opaque string — it crosses as these records with provenance, completeness, and
// freshness attached.
//
// Versioning: `AX_WIKI_EVIDENCE_SCHEMA_VERSION` gates the envelope. Evolution is
// additive; consumers should ignore unknown fields and treat a newer schemaVersion
// as readable-but-possibly-richer.

import { sha256, stableJson } from "./hash.js"

export const AX_WIKI_EVIDENCE_SCHEMA_VERSION = 1 as const

// ─── Enumerations ────────────────────────────────────────────────────────────

/**
 * Truthful acquisition state. A consumer must be able to distinguish "no data
 * because it is unsupported / failed / returned zero results" from "complete and
 * genuinely empty". These values must never be coerced to a silent empty success.
 */
export type Completeness = "complete" | "partial" | "lsp-only" | "unsupported" | "failed" | "queried-zero-results"

/** How the evidence was produced. */
export type EvidenceMethod = "lsp" | "tree-sitter" | "injected" | "none"

export type SourceCategory = "code" | "documentation" | "configuration" | "test" | "workflow" | "other"

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "module"
  | "parameter"
  | "enum"

export type RelationshipKind = "calls" | "references" | "imports" | "extends" | "implements" | "defines" | "declared_in"

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint"

/** Status of a path in a dirty working tree snapshot. */
export type DirtyStatus = "added" | "modified" | "deleted"

// ─── Ranges ──────────────────────────────────────────────────────────────────

/**
 * LSP-style range. `startChar`/`endChar` are UTF-16 code units (LSP convention).
 * For consumer-facing byte spans use the `byteStart`/`byteEnd` fields carried on
 * records, which are UTF-8 byte offsets and code-point aligned.
 */
export type TextRange = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

// ─── Provenance / freshness / capability ─────────────────────────────────────

export type Provenance = {
  /** Producer identifier, e.g. "ax-code-code-intelligence" or "injected". */
  producer: string
  /** Producer version. Including this in a fingerprint invalidates on upgrades. */
  producerVersion: string
  method: EvidenceMethod
  queryId?: string
}

export type Freshness = {
  indexedAt?: string
  stale?: boolean
  degraded?: boolean
}

export type Capability = {
  semantic: boolean
  syntactic: boolean
  diagnostics: boolean
  graph: boolean
}

// ─── Records ─────────────────────────────────────────────────────────────────

export type SourceRecord = {
  path: string
  sha256: string
  bytes: number
  language?: string
  category: SourceCategory
  truncated?: boolean
}

export type SymbolRecord = {
  id: string
  kind: SymbolKind
  name: string
  qualifiedName: string
  file: string
  range: TextRange
  signature?: string
  visibility?: string
  provenance: Provenance
}

/** A reference to a symbol (by id) or a file (by path) at a relationship endpoint. */
export type RelationshipRef = { symbolId?: string; file?: string }

export type RelationshipRecord = {
  kind: RelationshipKind
  from: RelationshipRef
  to: RelationshipRef
  file?: string
  range?: TextRange
  /** UTF-8 byte offsets for consumer-facing spans; code-point aligned. */
  byteStart?: number
  byteEnd?: number
  provenance: Provenance
}

export type DiagnosticRecord = {
  severity: DiagnosticSeverity
  message: string
  file: string
  range: TextRange
  source?: string
  code?: string
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/**
 * A point-in-time, explicitly-rooted repository snapshot. Carries an explicit
 * `root` and a dirty-aware `revision` so consumers never rely on ambient state and
 * can detect uncommitted drift (which a bare commit SHA cannot).
 */
export type RepositorySnapshot = {
  schemaVersion: typeof AX_WIKI_EVIDENCE_SCHEMA_VERSION
  /** Explicit repository root. Never derived from ambient process state. */
  root: string
  revision: {
    head?: string
    dirty: boolean
    /** Root-relative entries; covers added/modified/deleted paths. */
    dirtyPaths?: Array<{ path: string; status: DirtyStatus }>
  }
  capturedAt: string
  sources: SourceRecord[]
}

// ─── Evidence envelope ───────────────────────────────────────────────────────

/**
 * The typed evidence envelope handed to the wiki compiler (and, downstream, to
 * adapters such as AX Fabric's OpenWiki producer). Framework-route detection and
 * other AX-Code-specific heuristics are intentionally NOT part of this envelope.
 */
export type EvidenceBundle = {
  schemaVersion: typeof AX_WIKI_EVIDENCE_SCHEMA_VERSION
  snapshot: Pick<RepositorySnapshot, "root" | "revision" | "capturedAt">
  sources: SourceRecord[]
  symbols: SymbolRecord[]
  relationships: RelationshipRecord[]
  diagnostics: DiagnosticRecord[]
  capability: Capability
  completeness: Completeness
  provenance: Provenance
  freshness: Freshness
}

/** Construct an empty-but-truthful bundle for a given completeness state. */
export function emptyEvidenceBundle(input: {
  root: string
  completeness: Completeness
  provenance: Provenance
  capturedAt?: string
  revision?: RepositorySnapshot["revision"]
}): EvidenceBundle {
  return {
    schemaVersion: AX_WIKI_EVIDENCE_SCHEMA_VERSION,
    snapshot: {
      root: input.root,
      revision: input.revision ?? { dirty: false },
      capturedAt: input.capturedAt ?? new Date(0).toISOString(),
    },
    sources: [],
    symbols: [],
    relationships: [],
    diagnostics: [],
    capability: { semantic: false, syntactic: false, diagnostics: false, graph: false },
    completeness: input.completeness,
    provenance: input.provenance,
    freshness: {},
  }
}

/**
 * Content-derived fingerprint of a page's typed evidence. Excludes volatile
 * timestamps (`capturedAt`, `indexedAt`, `queryId`) so reindexes and repeated
 * queries with the same semantic payload do not over-trigger regeneration.
 */
export function fingerprintEvidenceBundle(bundle: EvidenceBundle): string {
  return sha256(stableJson(stableEvidencePayload(bundle)))
}

/**
 * Deterministic text view for legacy generators. The typed bundle remains the
 * canonical input; this rendering exists only while `graphContext` is supported.
 */
export function renderEvidenceBundle(bundle: EvidenceBundle): string {
  const lines = [
    "# Semantic Evidence",
    "",
    `schemaVersion: ${bundle.schemaVersion}`,
    `completeness: ${bundle.completeness}`,
    `capability: semantic=${bundle.capability.semantic} syntactic=${bundle.capability.syntactic} diagnostics=${bundle.capability.diagnostics} graph=${bundle.capability.graph}`,
    `producer: ${bundle.provenance.producer} version=${bundle.provenance.producerVersion} method=${bundle.provenance.method}`,
    `freshness: stale=${bundle.freshness.stale === true ? "true" : "false"} degraded=${bundle.freshness.degraded === true ? "true" : "false"}`,
    "",
    "## Symbols",
  ]
  if (bundle.symbols.length === 0) {
    lines.push("No indexed symbols matched the query.")
  } else {
    for (const symbol of bundle.symbols) {
      lines.push(`- [${symbol.kind}] ${symbol.qualifiedName} (${symbol.file}:${symbol.range.startLine + 1})`)
    }
  }
  lines.push("")
  if (bundle.relationships.length > 0) {
    lines.push("## Relationships")
    for (const relationship of bundle.relationships) {
      const from = relationship.from.symbolId ?? relationship.from.file ?? "(unknown)"
      const to = relationship.to.symbolId ?? relationship.to.file ?? "(unknown)"
      const file = relationship.file ? ` (${relationship.file})` : ""
      lines.push(`- ${relationship.kind}: ${from} -> ${to}${file}`)
    }
    lines.push("")
  }
  if (bundle.diagnostics.length > 0) {
    lines.push("## Diagnostics")
    for (const diagnostic of bundle.diagnostics) {
      lines.push(
        `- [${diagnostic.severity}] ${diagnostic.file}:${diagnostic.range.startLine + 1}: ${diagnostic.message}`,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}

function stableProvenance(provenance: Provenance): {
  producer: string
  producerVersion: string
  method: EvidenceMethod
} {
  return {
    producer: provenance.producer,
    producerVersion: provenance.producerVersion,
    method: provenance.method,
  }
}

function compareStable(left: unknown, right: unknown): number {
  return stableJson(left).localeCompare(stableJson(right))
}

function stableEvidencePayload(bundle: EvidenceBundle): unknown {
  const sources = bundle.sources.map((source) => ({
    path: source.path,
    sha256: source.sha256,
    bytes: source.bytes,
    language: source.language ?? null,
    category: source.category,
    truncated: source.truncated ?? false,
  }))
  const symbols = bundle.symbols.map((symbol) => ({
    id: symbol.id,
    kind: symbol.kind,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    file: symbol.file,
    range: symbol.range,
    signature: symbol.signature ?? null,
    visibility: symbol.visibility ?? null,
    provenance: stableProvenance(symbol.provenance),
  }))
  const relationships = bundle.relationships.map((relationship) => ({
    kind: relationship.kind,
    from: relationship.from,
    to: relationship.to,
    file: relationship.file ?? null,
    range: relationship.range ?? null,
    byteStart: relationship.byteStart ?? null,
    byteEnd: relationship.byteEnd ?? null,
    provenance: stableProvenance(relationship.provenance),
  }))
  const diagnostics = bundle.diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: diagnostic.file,
    range: diagnostic.range,
    source: diagnostic.source ?? null,
    code: diagnostic.code ?? null,
  }))
  return {
    schemaVersion: bundle.schemaVersion,
    completeness: bundle.completeness,
    capability: bundle.capability,
    provenance: stableProvenance(bundle.provenance),
    freshness: {
      stale: bundle.freshness.stale ?? false,
      degraded: bundle.freshness.degraded ?? false,
    },
    sources: [...sources].sort(compareStable),
    symbols: [...symbols].sort(compareStable),
    relationships: [...relationships].sort(compareStable),
    diagnostics: [...diagnostics].sort(compareStable),
  }
}

// ─── UTF-8 span helpers (gate C6) ────────────────────────────────────────────

/**
 * UTF-8 byte length of a string. Budgets must be computed in bytes, not UTF-16
 * code units, to be correct for multibyte content.
 */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

/**
 * Convert a code-point range `[startCodePoint, endCodePoint)` within `text` into
 * UTF-8 byte offsets. Inputs are clamped to the string's code-point length and the
 * endpoints are code-point aligned, so the resulting byte span never splits a
 * multibyte sequence. `TextRange` start/end stay UTF-16 (LSP) — use this to derive
 * consumer-facing byte spans.
 */
export function utf8ByteSpan(
  text: string,
  startCodePoint: number,
  endCodePoint: number,
): { byteStart: number; byteEnd: number } {
  const codePoints = [...text]
  const start = Math.max(0, Math.min(startCodePoint, codePoints.length))
  const end = Math.max(start, Math.min(endCodePoint, codePoints.length))
  const byteStart = Buffer.byteLength(codePoints.slice(0, start).join(""), "utf8")
  const byteEnd = byteStart + Buffer.byteLength(codePoints.slice(start, end).join(""), "utf8")
  return { byteStart, byteEnd }
}
