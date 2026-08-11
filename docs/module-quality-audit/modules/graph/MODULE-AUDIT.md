# MODULE-AUDIT: graph

| Field | Value |
|-------|-------|
| Unit slug | `graph` |
| Scope | `packages/ax-code/src/graph` |
| Resolved root | `packages/ax-code/src/graph` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | performance |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `bf07e0692ab8254f` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 1032 |
| Inventory ID | W5-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/graph/format.ts` | 699 | 23 | 0 | 0 |
| `packages/ax-code/src/graph/index.ts` | 333 | 22 | 0 | 0 |

### Exports (sample)
- `GraphFormat@packages/ax-code/src/graph/format.ts:135`
- `TimelineLine@packages/ax-code/src/graph/format.ts:136`
- `TopologyHeading@packages/ax-code/src/graph/format.ts:141`
- `TopologyHeading@packages/ax-code/src/graph/format.ts:147`
- `TopologyPath@packages/ax-code/src/graph/format.ts:149`
- `TopologyPath@packages/ax-code/src/graph/format.ts:156`
- `TopologyStep@packages/ax-code/src/graph/format.ts:158`
- `TopologyStep@packages/ax-code/src/graph/format.ts:166`
- `TopologyPair@packages/ax-code/src/graph/format.ts:168`
- `TopologyPair@packages/ax-code/src/graph/format.ts:176`
- `TopologyLine@packages/ax-code/src/graph/format.ts:178`
- `TopologyLine@packages/ax-code/src/graph/format.ts:181`
- `TopologyResponse@packages/ax-code/src/graph/format.ts:183`
- `TopologyResponse@packages/ax-code/src/graph/format.ts:188`
- `json@packages/ax-code/src/graph/format.ts:190`
- `timeline@packages/ax-code/src/graph/format.ts:194`
- `topologyLines@packages/ax-code/src/graph/format.ts:251`
- `topology@packages/ax-code/src/graph/format.ts:305`
- `ascii@packages/ax-code/src/graph/format.ts:309`
- `mermaid@packages/ax-code/src/graph/format.ts:348`

### Tests
- `packages/ax-code/test/cli/index-graph.test.ts`
- `packages/ax-code/test/code-intelligence/graph-context.test.ts`
- `packages/ax-code/test/code-intelligence/graph-envelope.test.ts`
- `packages/ax-code/test/code-intelligence/graph-highlights.test.ts`
- `packages/ax-code/test/graph/execution-graph.test.ts`
- `packages/ax-code/test/quality/dre-graph-activity-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-activity.test.ts`
- `packages/ax-code/test/quality/dre-graph-assets.test.ts`
- `packages/ax-code/test/quality/dre-graph-branch-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-changes-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-fingerprint.test.ts`
- `packages/ax-code/test/quality/dre-graph-format.test.ts`
- `packages/ax-code/test/quality/dre-graph-index-page.test.ts`
- `packages/ax-code/test/quality/dre-graph-quality-readiness.test.ts`
- `packages/ax-code/test/quality/dre-graph-risk-section.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (45) | static map |
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
| Static extract | ok fp `bf07e0692ab8254f` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=9 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
