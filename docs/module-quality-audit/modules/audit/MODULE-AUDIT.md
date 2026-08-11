# MODULE-AUDIT: audit

| Field | Value |
|-------|-------|
| Unit slug | `audit` |
| Scope | `packages/ax-code/src/audit` |
| Resolved root | `packages/ax-code/src/audit` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security, persistence |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `85ce8e979fc5e7d5` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 8 / 920 |
| Inventory ID | W1-07 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/audit/export.ts` | 176 | 3 | 0 | 0 |
| `packages/ax-code/src/audit/id.ts` | 5 | 2 | 0 | 0 |
| `packages/ax-code/src/audit/index.ts` | 32 | 2 | 0 | 0 |
| `packages/ax-code/src/audit/json.ts` | 13 | 3 | 0 | 0 |
| `packages/ax-code/src/audit/query.ts` | 97 | 7 | 0 | 0 |
| `packages/ax-code/src/audit/report.ts` | 401 | 4 | 0 | 0 |
| `packages/ax-code/src/audit/schema.sql.ts` | 61 | 1 | 0 | 0 |
| `packages/ax-code/src/audit/semantic-call.ts` | 135 | 5 | 0 | 0 |

### Exports (sample)
- `formatAuditTimestamp@packages/ax-code/src/audit/export.ts:34`
- `AuditExport@packages/ax-code/src/audit/export.ts:119`
- `policyContext@packages/ax-code/src/audit/export.ts:154`
- `AuditCallID@packages/ax-code/src/audit/id.ts:3`
- `AuditCallID@packages/ax-code/src/audit/id.ts:4`
- `AuditRecord@packages/ax-code/src/audit/index.ts:3`
- `AuditRecord@packages/ax-code/src/audit/index.ts:31`
- `AuditJsonLineResult@packages/ax-code/src/audit/json.ts:4`
- `parseAuditJsonLineResult@packages/ax-code/src/audit/json.ts:6`
- `auditSessionIDFromRecord@packages/ax-code/src/audit/json.ts:10`
- `AuditQuery@packages/ax-code/src/audit/query.ts:14`
- `Row@packages/ax-code/src/audit/query.ts:15`
- `Insert@packages/ax-code/src/audit/query.ts:17`
- `insert@packages/ax-code/src/audit/query.ts:33`
- `insertMany@packages/ax-code/src/audit/query.ts:54`
- `getById@packages/ax-code/src/audit/query.ts:75`
- `listRecent@packages/ax-code/src/audit/query.ts:83`
- `formatAuditReportTimestamp@packages/ax-code/src/audit/report.ts:16`
- `extractTarget@packages/ax-code/src/audit/report.ts:71`
- `AuditReport@packages/ax-code/src/audit/report.ts:162`

### Tests
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/cli/audit.test.ts`
- `packages/ax-code/test/cli/tui/setinterval-audit.test.ts`
- `packages/ax-code/test/quality/promotion-audit-manifest.test.ts`
- `packages/ax-code/test/server/audit-route.test.ts`
- `packages/ax-code/test/tool/lsp-audit.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (27) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `85ce8e979fc5e7d5` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=16 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
