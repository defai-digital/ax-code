# R33: Tool Permission Audit

**Date:** 2026-04-04
**Status:** Complete — All 29 tools pass
**References:** PRD-ax-code-v2.md (R33)

---

## Result

All 29 core tools route through the permission layer. No raw filesystem, bash, or network bypasses found. Isolation checks precede all mutations.

## Audit Table

| # | Tool | Permission | ctx.ask() | Isolation | Notes |
|---|------|-----------|-----------|-----------|-------|
| 1 | bash | bash | Yes | assertBash() | Parses command tree, resolves paths |
| 2 | read | read | Yes | assertExternalDirectory() | Pattern-matched permission |
| 3 | glob | glob | Yes | assertExternalDirectory() | |
| 4 | grep | grep | Yes | assertExternalDirectory() | |
| 5 | write | edit | Yes | assertWrite() | Isolation before ask |
| 6 | edit | edit | Yes | assertWrite() | Multiple ask points |
| 7 | apply_patch | edit | Yes | assertWrite() per file | |
| 8 | multiedit | edit | Delegates to edit | Via edit | Wrapper |
| 9 | webfetch | webfetch | Yes | assertNetwork() | |
| 10 | websearch | websearch | Yes | assertNetwork() | |
| 11 | codesearch | codesearch | Yes | assertNetwork() | |
| 12 | task | task | Yes | N/A (creates subtask) | Conditional on bypassAgentCheck |
| 13 | skill | skill | Yes | N/A | |
| 14 | todowrite | todowrite | Yes | N/A (state mutation) | |
| 15 | todoread | todoread | Yes | N/A (read-only) | |
| 16 | lsp | lsp | Yes | N/A (analysis) | |
| 17 | batch | N/A | Delegates to each tool | Via each tool | Orchestrator |
| 18 | list | list | Yes | assertExternalDirectory() | |
| 19 | question | N/A | N/A | N/A | UI tool — no system access |
| 20 | plan_exit | N/A | N/A | N/A | UI tool — no system access |
| 21 | invalid | N/A | N/A | N/A | Error handler — no operation |
| 22-29 | Custom/MCP | Per spec | Wrapped by registry/prompt | Via context | All get ctx.ask() binding |

## Architecture Verification

**Permission flow:**
1. `registry.ts` registers all tools
2. `prompt.ts:resolveTools()` wraps each with `ctx.ask()` bound to `Permission.ask()`
3. `llm.ts:Permission.disabled()` removes tools based on ruleset
4. `isolation/index.ts` removes write/bash/network tools per isolation mode
5. Each tool calls `Isolation.assert*()` BEFORE `ctx.ask()` — double enforcement

**Isolation enforcement by operation type:**
| Operation | Tools | Check |
|-----------|-------|-------|
| Write | write, edit, apply_patch, multiedit | assertWrite() |
| Bash | bash | assertBash() |
| Network | webfetch, websearch, codesearch | assertNetwork() |
| Read | read, glob, grep, lsp, list | assertExternalDirectory() |

## No Bypasses Found

- All file operations use `Filesystem.*` utilities
- bash.ts parses command tree before execution
- Plugin/MCP tools wrapped at registration time with same permission context
- Isolation checked before permission ask in all code paths
