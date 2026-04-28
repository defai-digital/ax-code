# Semantic Layer

Status: Active
Scope: current-state
Last reviewed: 2026-04-13
Owner: ax-code runtime

This document describes the semantic layer that exists today in AX Code. It is a current-state contract, not a roadmap.

## Purpose

AX Code exposes semantic answers through two explicit sources:

- `lsp`: live language-server queries
- `graph`: persistent code-intelligence queries

The system does not silently route one into the other. Callers choose the surface based on freshness, latency, and determinism requirements.

## Current Semantic Surfaces

| Surface                  | Backing source            | Current role                                                                         |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------ |
| `lsp` tool               | live LSP clients          | freshest semantic answers, explicit live query surface                               |
| `code_intelligence` tool | indexed SQLite code graph | deterministic graph queries over indexed symbols, references, and call relationships |

The `lsp` tool is the live-semantic interface. The `code_intelligence` tool is the indexed-semantic interface. Neither is a hidden fallback for the other.

Current gating:

- `code_intelligence` is enabled by default but can be disabled with feature flags
- `lsp` currently requires the experimental LSP tool flag

## Envelope Contract

Semantic answers carry provenance metadata so downstream consumers can reason about trust and freshness.

Common fields:

- `source`: `lsp`, `graph`, or `cache`
- `completeness`: `full`, `partial`, or `empty`
- `timestamp`: when the underlying answer was resolved
- `degraded`: optional signal that the answer should be treated cautiously

LSP-backed envelopes may also include:

- `serverIDs`: which language servers contributed
- `cacheKey`: stable reference to an LSP response-cache row

## Audit and Replay

Current behavior:

- live semantic calls through the `lsp` tool write `audit_semantic_call` rows
- tool replay now preserves `tool.result.metadata`, which means graph-backed semantic metadata is not lost during replay/export
- deterministic replay compares decision-path metadata, not semantic equality of every returned symbol list

This gives LSP-backed and graph-backed semantic answers comparable audit visibility, even though they still come from different storage/runtime paths.

## Current Exposed Operations

### `lsp`

The live `lsp` surface includes envelope-backed operations for:

- definition
- references
- hover
- document symbols
- workspace symbols
- implementations
- call hierarchy
- aggregated diagnostics

This is the right surface when recency matters more than repeatability.

### `code_intelligence`

The graph surface includes:

- symbol lookup
- file symbols
- references
- callers
- callees

This is the right surface when repeatability and lower latency matter more than immediate editor-state freshness.

## Important Non-Goals

The current semantic layer does not do these things:

- no hidden graph-first routing with automatic LSP fallback
- no claim that graph freshness equals live LSP freshness
- no claim that every internal semantic helper is exposed through HTTP or SDK
- no Rust semantic runtime split in the current implementation

## Integration Guidance

When writing docs, SDK bindings, or higher-level workflows:

1. describe `lsp` and `code_intelligence` as separate semantic surfaces
2. distinguish public tool operations from internal helper functions
3. only describe audit/replay guarantees that are actually preserved in current schemas
4. mention flags when a semantic surface is not always enabled
