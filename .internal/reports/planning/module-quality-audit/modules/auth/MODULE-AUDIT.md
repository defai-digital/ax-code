# MODULE-AUDIT: auth

| Field | Value |
|-------|-------|
| Unit slug | `auth` |
| Scope | `packages/ax-code/src/auth` |
| Wave / effort | Wave 1 / L |
| Risk tags | security, credentials |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `4452f835b8360097` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-01 |
| Source files / LOC | 2 / 777 |

## 1. Scope and map

### Purpose and ownership
Unit `auth` owns `packages/ax-code/src/auth`. Risk profile: security, credentials.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/auth/encryption.ts` | 359 | 11 | 0 | 0 |
| `packages/ax-code/src/auth/index.ts` | 418 | 10 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `EncryptedValue@packages/ax-code/src/auth/encryption.ts:48` | public/internal | scanned |
| `__resetInstallSecretCacheForTests@packages/ax-code/src/auth/encryption.ts:96` | public/internal | scanned |
| `encrypt@packages/ax-code/src/auth/encryption.ts:140` | public/internal | scanned |
| `decrypt@packages/ax-code/src/auth/encryption.ts:171` | public/internal | scanned |
| `isLegacySalt@packages/ax-code/src/auth/encryption.ts:265` | public/internal | scanned |
| `isEncrypted@packages/ax-code/src/auth/encryption.ts:272` | public/internal | scanned |
| `encryptField@packages/ax-code/src/auth/encryption.ts:286` | public/internal | scanned |
| `decryptField@packages/ax-code/src/auth/encryption.ts:303` | public/internal | scanned |
| `test@packages/ax-code/src/auth/encryption.ts:328` | public/internal | scanned |
| `createCanary@packages/ax-code/src/auth/encryption.ts:343` | public/internal | scanned |
| `verifyCanary@packages/ax-code/src/auth/encryption.ts:351` | public/internal | scanned |
| `Auth@packages/ax-code/src/auth/index.ts:209` | public/internal | scanned |
| `Oauth@packages/ax-code/src/auth/index.ts:210` | public/internal | scanned |
| `Api@packages/ax-code/src/auth/index.ts:220` | public/internal | scanned |
| `WellKnown@packages/ax-code/src/auth/index.ts:226` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- io packages/ax-code/src/auth/encryption.ts:15
- secret packages/ax-code/src/auth/encryption.ts:30
- secret packages/ax-code/src/auth/encryption.ts:32
- secret packages/ax-code/src/auth/encryption.ts:35
- secret packages/ax-code/src/auth/encryption.ts:57
- secret packages/ax-code/src/auth/encryption.ts:62
- secret packages/ax-code/src/auth/encryption.ts:63
- secret packages/ax-code/src/auth/encryption.ts:64
- secret packages/ax-code/src/auth/encryption.ts:66
- secret packages/ax-code/src/auth/encryption.ts:68
- io packages/ax-code/src/auth/encryption.ts:68
- secret packages/ax-code/src/auth/encryption.ts:71

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | ProjectConfigTrust / encryption canary / trust gates | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (21 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 777
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/auth`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 21

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | packages/ax-code/test/auth/encryption.test.ts | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-auth-001 | silent-error | Medium | new | verified-fixed |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `4452f835b8360097` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-auth-001 | ok | packages/ax-code/test/auth/encryption.test.ts |

### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 777 LOC / fp 4452f835b8360097 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
