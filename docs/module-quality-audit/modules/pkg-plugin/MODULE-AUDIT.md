# MODULE-AUDIT: pkg-plugin

| Field | Value |
|-------|-------|
| Unit slug | `pkg-plugin` |
| Scope | `packages/plugin` |
| Resolved root | `packages/plugin` |
| XL filter | no |
| Wave / effort | Wave 9 / M |
| Risk tags | api |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `f22c38fcfb9ea5f5` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 6 / 488 |
| Inventory ID | W9-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/plugin/script/publish.ts` | 34 | 0 | 0 | 0 |
| `packages/plugin/src/example.ts` | 19 | 1 | 0 | 0 |
| `packages/plugin/src/index.ts` | 249 | 6 | 0 | 0 |
| `packages/plugin/src/shell.ts` | 137 | 6 | 0 | 0 |
| `packages/plugin/src/tool.ts` | 39 | 3 | 0 | 0 |
| `packages/plugin/sst-env.d.ts` | 10 | 0 | 0 | 0 |

### Exports (sample)
- `ExamplePlugin@packages/plugin/src/example.ts:4`
- `ProviderContext@packages/plugin/src/index.ts:20`
- `PluginInput@packages/plugin/src/index.ts:26`
- `Plugin@packages/plugin/src/index.ts:35`
- `AuthHook@packages/plugin/src/index.ts:43`
- `AuthOuathResult@packages/plugin/src/index.ts:119`
- `Hooks@packages/plugin/src/index.ts:162`
- `ShellFunction@packages/plugin/src/shell.ts:1`
- `ShellExpression@packages/plugin/src/shell.ts:3`
- `BunShell@packages/plugin/src/shell.ts:10`
- `BunShellPromise@packages/plugin/src/shell.ts:45`
- `BunShellOutput@packages/plugin/src/shell.ts:105`
- `BunShellError@packages/plugin/src/shell.ts:136`
- `ToolContext@packages/plugin/src/tool.ts:3`
- `tool@packages/plugin/src/tool.ts:29`
- `ToolDefinition@packages/plugin/src/tool.ts:38`

### Tests
- `packages/ax-code/test/cli/plugin-auth-picker.test.ts`
- `packages/ax-code/test/plugin/auth-override.test.ts`
- `packages/ax-code/test/provider/xai/auth-plugin.test.ts`
- `packages/ax-code/test/script/esbuild-solid-plugin.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (16) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags api | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f22c38fcfb9ea5f5` |
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
