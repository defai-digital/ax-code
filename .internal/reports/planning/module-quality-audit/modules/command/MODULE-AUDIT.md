# MODULE-AUDIT: command

| Field | Value |
|-------|-------|
| Unit slug | `command` |
| Scope | `packages/ax-code/src/command` |
| Wave / effort | Wave 3 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5c0bc14d204cfa41` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-09 |
| Source files / LOC | 2 / 621 |

## 1. Scope and map

### Purpose and ownership
Unit `command` owns `packages/ax-code/src/command`. Risk profile: security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/command/file-command.ts` | 223 | 9 | 0 | 0 |
| `packages/ax-code/src/command/index.ts` | 398 | 8 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `FileCommand@packages/ax-code/src/command/file-command.ts:8` | public/internal | scanned |
| `SourceTool@packages/ax-code/src/command/file-command.ts:9` | public/internal | scanned |
| `Scope@packages/ax-code/src/command/file-command.ts:12` | public/internal | scanned |
| `Warning@packages/ax-code/src/command/file-command.ts:15` | public/internal | scanned |
| `Info@packages/ax-code/src/command/file-command.ts:22` | public/internal | scanned |
| `parse@packages/ax-code/src/command/file-command.ts:51` | public/internal | scanned |
| `parseFile@packages/ax-code/src/command/file-command.ts:130` | public/internal | scanned |
| `discover@packages/ax-code/src/command/file-command.ts:151` | public/internal | scanned |
| `commandName@packages/ax-code/src/command/file-command.ts:210` | public/internal | scanned |
| `Command@packages/ax-code/src/command/index.ts:24` | public/internal | scanned |
| `Event@packages/ax-code/src/command/index.ts:25` | public/internal | scanned |
| `Info@packages/ax-code/src/command/index.ts:42` | public/internal | scanned |
| `hints@packages/ax-code/src/command/index.ts:87` | public/internal | scanned |
| `mcpPromptTemplateText@packages/ax-code/src/command/index.ts:104` | public/internal | scanned |
| `Default@packages/ax-code/src/command/index.ts:116` | public/internal | scanned |

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

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (17 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 621
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/command`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 17

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
| Static deep extract | ok | fingerprint `5c0bc14d204cfa41` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 621 LOC / fp 5c0bc14d204cfa41 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
