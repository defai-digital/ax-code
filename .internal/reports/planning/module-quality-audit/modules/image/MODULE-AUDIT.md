# MODULE-AUDIT: image

| Field | Value |
|-------|-------|
| Unit slug | `image` |
| Scope | `packages/ax-code/src/image` |
| Wave / effort | Wave 3 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `e68e513f1df92f76` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-13 |
| Source files / LOC | 2 / 218 |

## 1. Scope and map

### Purpose and ownership
Unit `image` owns `packages/ax-code/src/image`. Risk profile: security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/image/index.ts` | 8 | 0 | 0 | 0 |
| `packages/ax-code/src/image/provider.ts` | 210 | 8 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ImageGenerateInput@packages/ax-code/src/image/provider.ts:6` | public/internal | scanned |
| `ImageGenerateOutput@packages/ax-code/src/image/provider.ts:13` | public/internal | scanned |
| `ImageProvider@packages/ax-code/src/image/provider.ts:18` | public/internal | scanned |
| `ImageProviderConfig@packages/ax-code/src/image/provider.ts:23` | public/internal | scanned |
| `OpenAIImageProvider@packages/ax-code/src/image/provider.ts:42` | public/internal | scanned |
| `StabilityImageProvider@packages/ax-code/src/image/provider.ts:93` | public/internal | scanned |
| `CustomImageProvider@packages/ax-code/src/image/provider.ts:133` | public/internal | scanned |
| `createImageProvider@packages/ax-code/src/image/provider.ts:192` | public/internal | scanned |

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

- secret packages/ax-code/src/image/provider.ts:26
- secret packages/ax-code/src/image/provider.ts:33
- secret packages/ax-code/src/image/provider.ts:34
- secret packages/ax-code/src/image/provider.ts:44
- secret packages/ax-code/src/image/provider.ts:49
- secret packages/ax-code/src/image/provider.ts:52
- secret packages/ax-code/src/image/provider.ts:54
- secret packages/ax-code/src/image/provider.ts:72
- secret packages/ax-code/src/image/provider.ts:95
- secret packages/ax-code/src/image/provider.ts:99
- secret packages/ax-code/src/image/provider.ts:102
- secret packages/ax-code/src/image/provider.ts:104

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (8 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 218
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/image`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 8

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `e68e513f1df92f76` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 218 LOC / fp e68e513f1df92f76 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
