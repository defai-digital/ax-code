# MODULE-AUDIT: context

| Field | Value |
|-------|-------|
| Unit slug | `context` |
| Scope | `packages/ax-code/src/context` |
| Resolved root | `packages/ax-code/src/context` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | performance |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `dd7e21b1573aea29` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 4 / 1000 |
| Inventory ID | W2-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/context/analyzer.ts` | 455 | 10 | 0 | 0 |
| `packages/ax-code/src/context/generator.ts` | 298 | 1 | 0 | 0 |
| `packages/ax-code/src/context/index.ts` | 98 | 7 | 0 | 0 |
| `packages/ax-code/src/context/long-agent-packer.ts` | 149 | 7 | 0 | 0 |

### Exports (sample)
- `ComplexityLevel@packages/ax-code/src/context/analyzer.ts:18`
- `DepthLevel@packages/ax-code/src/context/analyzer.ts:19`
- `ComplexityScore@packages/ax-code/src/context/analyzer.ts:21`
- `CodeConventions@packages/ax-code/src/context/analyzer.ts:29`
- `ProjectScripts@packages/ax-code/src/context/analyzer.ts:39`
- `ProjectInfo@packages/ax-code/src/context/analyzer.ts:49`
- `PackageJson@packages/ax-code/src/context/analyzer.ts:77`
- `analyze@packages/ax-code/src/context/analyzer.ts:92`
- `decodeAnalyzerPackageJsonValue@packages/ax-code/src/context/analyzer.ts:122`
- `parseAnalyzerPackageJsonText@packages/ax-code/src/context/analyzer.ts:144`
- `generate@packages/ax-code/src/context/generator.ts:26`
- `Context@packages/ax-code/src/context/index.ts:17`
- `OUTPUT_FILENAME@packages/ax-code/src/context/index.ts:20`
- `InitOptions@packages/ax-code/src/context/index.ts:22`
- `InitResult@packages/ax-code/src/context/index.ts:29`
- `init@packages/ax-code/src/context/index.ts:36`
- `read@packages/ax-code/src/context/index.ts:84`
- `refresh@packages/ax-code/src/context/index.ts:94`
- `LongAgentContextPacker@packages/ax-code/src/context/long-agent-packer.ts:13`
- `Tier@packages/ax-code/src/context/long-agent-packer.ts:17`

### Tests
- `packages/ax-code/test/cli/github-agent-run-context.test.ts`
- `packages/ax-code/test/cli/tui/context-kv-race.test.ts`
- `packages/ax-code/test/code-intelligence/graph-context.test.ts`
- `packages/ax-code/test/context/analyzer.test.ts`
- `packages/ax-code/test/context/generator.test.ts`
- `packages/ax-code/test/context/long-agent-packer.test.ts`
- `packages/ax-code/test/project/instance-context.test.ts`
- `packages/ax-code/test/quality/reentry-context.test.ts`
- `packages/ax-code/test/server/app-context-routes.test.ts`
- `packages/ax-code/test/session/context-tier.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (25) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags performance | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `dd7e21b1573aea29` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=13 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
