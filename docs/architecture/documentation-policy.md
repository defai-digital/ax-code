# Documentation Policy

Status: Active
Scope: current-state
Last reviewed: 2026-04-13
Owner: ax-code runtime

This document defines how AX Code documentation stays truthful as the product surface changes.

## Goals

- keep current-state docs aligned with the shipped surface
- make proposals and historical decisions easy to distinguish from live behavior
- reduce drift between registry/schema-driven code and hand-written docs
- avoid heavy documentation process or tooling

## Document Types

Use one of these scopes for every substantial document:

| Scope | Purpose | Allowed claims |
| ----- | ------- | -------------- |
| `current-state` | Describes the shipped product or package surface | only what a user or integrator can use now |
| `proposal` | Describes intended future behavior | may describe planned behavior, must not read like shipped functionality |
| `historical` | Records past decisions, shipped phases, or retired plans | may describe old gaps if clearly marked as historical |
| `experimental` | Describes partial or gated functionality | must name the gate, limitation, or maturity level |

## Required Status Header

Important docs should carry a small status block near the top:

```md
Status: Active | Draft | Implemented | Superseded | Experimental
Scope: current-state | proposal | historical | experimental
Last reviewed: YYYY-MM-DD
Owner: team or module
```

Recommended usage:

- `README.md` and package READMEs: `Status: Active`, `Scope: current-state`
- internal PRDs: `Status: Draft` while open, then `Implemented` or `Superseded`
- partial integrations such as ACP: `Status: Experimental`

## Source-of-Truth Rules

When documentation names product surfaces, these code locations win:

| Surface | Source of truth |
| ------- | --------------- |
| Tool IDs | `packages/ax-code/src/tool/registry.ts` and `Tool.define(...)` declarations |
| Agent inventory | `packages/ax-code/src/agent/agent.ts` |
| HTTP and SDK shape | route schemas and generated SDK artifacts |
| Semantic contract wording | `packages/ax-code/src/tool/lsp.ts`, `packages/ax-code/src/tool/code-intelligence.ts`, replay/audit schemas |

Rules:

- do not describe a library helper as a public product surface unless it is exposed through a tool, route, CLI, or SDK
- distinguish `tool id` from `tool operation`
- do not hard-code counts unless the count itself matters and has an owner
- if a feature is behind a flag, say so

## Review Checklist

Before merging a documentation change, check:

1. Is this file describing current behavior, a proposal, or history?
2. Are any internal helpers being described as user-facing capability?
3. Are tool names, agent names, and route names copied from the actual registry/schema?
4. Does the document overstate maturity for experimental or partial surfaces?
5. If this closes a PRD, was the PRD status updated?

## Maintenance Triggers

Update docs when any of these change:

- a new tool or agent is added, removed, renamed, or gated
- a semantic contract field changes (`source`, `completeness`, `degraded`, replay metadata, audit shape)
- an HTTP schema changes in a way SDK consumers can observe
- a proposal is shipped, cut, or superseded

## Minimal Guardrails

Keep this lightweight:

- prefer a docs review checklist over mandatory prose templates everywhere
- add simple structural checks later if needed, such as requiring `Status:` headers on PRDs
- avoid inventing a separate docs platform unless repo-scale pain justifies it
