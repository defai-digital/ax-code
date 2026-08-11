# MODULE-AUDIT: auth

| Field | Value |
|-------|-------|
| Unit slug | `auth` |
| Scope | `packages/ax-code/src/auth` |
| Resolved root | `packages/ax-code/src/auth` |
| XL filter | no |
| Wave / effort | Wave 1 / L |
| Risk tags | security, credentials |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `6ee67899c19fd803` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 804 |
| Inventory ID | W1-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/auth/encryption.ts` | 359 | 11 | 0 | 0 |
| `packages/ax-code/src/auth/index.ts` | 445 | 15 | 0 | 0 |

### Exports (sample)
- `EncryptedValue@packages/ax-code/src/auth/encryption.ts:48`
- `__resetInstallSecretCacheForTests@packages/ax-code/src/auth/encryption.ts:96`
- `encrypt@packages/ax-code/src/auth/encryption.ts:140`
- `decrypt@packages/ax-code/src/auth/encryption.ts:171`
- `isLegacySalt@packages/ax-code/src/auth/encryption.ts:265`
- `isEncrypted@packages/ax-code/src/auth/encryption.ts:272`
- `encryptField@packages/ax-code/src/auth/encryption.ts:286`
- `decryptField@packages/ax-code/src/auth/encryption.ts:303`
- `test@packages/ax-code/src/auth/encryption.ts:328`
- `createCanary@packages/ax-code/src/auth/encryption.ts:343`
- `verifyCanary@packages/ax-code/src/auth/encryption.ts:351`
- `Auth@packages/ax-code/src/auth/index.ts:227`
- `Oauth@packages/ax-code/src/auth/index.ts:228`
- `Oauth@packages/ax-code/src/auth/index.ts:236`
- `Api@packages/ax-code/src/auth/index.ts:238`
- `Api@packages/ax-code/src/auth/index.ts:242`
- `WellKnown@packages/ax-code/src/auth/index.ts:244`
- `WellKnown@packages/ax-code/src/auth/index.ts:249`
- `Info@packages/ax-code/src/auth/index.ts:252`
- `Info@packages/ax-code/src/auth/index.ts:253`

### Tests
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/cli/plugin-auth-picker.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`
- `packages/ax-code/test/mcp/auth.test.ts`
- `packages/ax-code/test/mcp/oauth-auto-connect.test.ts`
- `packages/ax-code/test/mcp/oauth-browser.test.ts`
- `packages/ax-code/test/mcp/oauth-callback.test.ts`
- `packages/ax-code/test/plugin/auth-override.test.ts`
- `packages/ax-code/test/provider/xai/auth-plugin.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (26) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,credentials | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 2 source files; exports≈26
Step 2: Threat: secrets=2 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-auth-001.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/auth
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-auth-001 | silent-error | Medium | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6ee67899c19fd803` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=2 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
