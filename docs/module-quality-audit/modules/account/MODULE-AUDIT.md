# MODULE-AUDIT: account

| Field | Value |
|-------|-------|
| Unit slug | `account` |
| Scope | `packages/ax-code/src/account` |
| Resolved root | `packages/ax-code/src/account` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security, persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `8e1fb9cd18eb5a8a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 4 / 831 |
| Inventory ID | W1-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/account/account.sql.ts` | 40 | 3 | 0 | 0 |
| `packages/ax-code/src/account/index.ts` | 454 | 16 | 0 | 0 |
| `packages/ax-code/src/account/repo.ts` | 214 | 11 | 0 | 0 |
| `packages/ax-code/src/account/schema.ts` | 123 | 25 | 0 | 0 |

### Exports (sample)
- `AccountTable@packages/ax-code/src/account/account.sql.ts:6`
- `AccountStateTable@packages/ax-code/src/account/account.sql.ts:16`
- `ControlAccountTable@packages/ax-code/src/account/account.sql.ts:25`
- `AccountOrgs@packages/ax-code/src/account/index.ts:52`
- `Account@packages/ax-code/src/account/index.ts:235`
- `Interface@packages/ax-code/src/account/index.ts:236`
- `Options@packages/ax-code/src/account/index.ts:249`
- `create@packages/ax-code/src/account/index.ts:254`
- `active@packages/ax-code/src/account/index.ts:439`
- `list@packages/ax-code/src/account/index.ts:440`
- `orgsByAccount@packages/ax-code/src/account/index.ts:441`
- `remove@packages/ax-code/src/account/index.ts:442`
- `use@packages/ax-code/src/account/index.ts:443`
- `orgs@packages/ax-code/src/account/index.ts:444`
- `config@packages/ax-code/src/account/index.ts:445`
- `token@packages/ax-code/src/account/index.ts:446`
- `login@packages/ax-code/src/account/index.ts:447`
- `poll@packages/ax-code/src/account/index.ts:448`
- `durationToMillis@packages/ax-code/src/account/index.ts:450`
- `parseEncryptedToken@packages/ax-code/src/account/repo.ts:15`

### Tests
- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/cli/account.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (55) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-account-001 | silent-error | Medium | prior/new | verified-fixed |
| AUDIT-account-002 | silent-error | Low | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `8e1fb9cd18eb5a8a` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=9 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
