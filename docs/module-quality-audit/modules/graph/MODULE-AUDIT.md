# MODULE-AUDIT: graph

| Field | Value |
|-------|-------|
| Unit slug | `graph` |
| Scope | `packages/ax-code/src/graph` |
| Resolved root | `packages/ax-code/src/graph` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | performance |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `bf07e0692ab8254f` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `bf07e0692ab8254f` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
