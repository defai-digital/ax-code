# MODULE-AUDIT: pty

| Field | Value |
|-------|-------|
| Unit slug | `pty` |
| Scope | `packages/ax-code/src/pty` |
| Resolved root | `packages/ax-code/src/pty` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security, resource |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `83719469a990085a` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 540 |
| Inventory ID | W3-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/pty/index.ts` | 534 | 19 | 1 | 0 |
| `packages/ax-code/src/pty/schema.ts` | 6 | 2 | 0 | 0 |

### Exports (sample)
- `Pty@packages/ax-code/src/pty/index.ts:19`
- `replayBufferedOutput@packages/ax-code/src/pty/index.ts:83`
- `sanitizeUserEnv@packages/ax-code/src/pty/index.ts:131`
- `Info@packages/ax-code/src/pty/index.ts:215`
- `Info@packages/ax-code/src/pty/index.ts:227`
- `InvalidCwdError@packages/ax-code/src/pty/index.ts:229`
- `CreateInput@packages/ax-code/src/pty/index.ts:237`
- `CreateInput@packages/ax-code/src/pty/index.ts:245`
- `UpdateInput@packages/ax-code/src/pty/index.ts:255`
- `UpdateInput@packages/ax-code/src/pty/index.ts:260`
- `Event@packages/ax-code/src/pty/index.ts:262`
- `list@packages/ax-code/src/pty/index.ts:306`
- `get@packages/ax-code/src/pty/index.ts:311`
- `resize@packages/ax-code/src/pty/index.ts:316`
- `write@packages/ax-code/src/pty/index.ts:325`
- `connect@packages/ax-code/src/pty/index.ts:333`
- `create@packages/ax-code/src/pty/index.ts:400`
- `update@packages/ax-code/src/pty/index.ts:506`
- `remove@packages/ax-code/src/pty/index.ts:520`
- `PtyID@packages/ax-code/src/pty/schema.ts:3`

### Tests
- `packages/ax-code/test/pty/pty-output-isolation.test.ts`
- `packages/ax-code/test/pty/pty-session.test.ts`
- `packages/ax-code/test/session/prompt-loop-empty-turn.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (21) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,resource | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pty-001 | silent-error | Medium | prior/new | verified-fixed |
| AUDIT-pty-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `83719469a990085a` |
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
