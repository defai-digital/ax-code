# MODULE-AUDIT: acp

| Field | Value |
|-------|-------|
| Unit slug | `acp` |
| Scope | `packages/ax-code/src/acp` |
| Resolved root | `packages/ax-code/src/acp` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | api |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `50eb2d2387f5864c` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 8 / 1747 |
| Inventory ID | W5-10 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/acp/agent-adapter.ts` | 276 | 12 | 0 | 0 |
| `packages/ax-code/src/acp/agent.ts` | 761 | 7 | 0 | 0 |
| `packages/ax-code/src/acp/prompt.ts` | 114 | 4 | 0 | 0 |
| `packages/ax-code/src/acp/session-mode.ts` | 213 | 2 | 0 | 0 |
| `packages/ax-code/src/acp/session.ts` | 163 | 1 | 0 | 0 |
| `packages/ax-code/src/acp/types.ts` | 25 | 2 | 0 | 0 |
| `packages/ax-code/src/acp/usage.ts` | 74 | 1 | 0 | 0 |
| `packages/ax-code/src/acp/utils.ts` | 121 | 7 | 0 | 0 |

### Exports (sample)
- `ModelOption@packages/ax-code/src/acp/agent-adapter.ts:13`
- `toToolKind@packages/ax-code/src/acp/agent-adapter.ts:18`
- `toLocations@packages/ax-code/src/acp/agent-adapter.ts:46`
- `defaultModel@packages/ax-code/src/acp/agent-adapter.ts:65`
- `parseUri@packages/ax-code/src/acp/agent-adapter.ts:130`
- `getNewContent@packages/ax-code/src/acp/agent-adapter.ts:167`
- `sortProvidersByName@packages/ax-code/src/acp/agent-adapter.ts:176`
- `modelVariantsFromProviders@packages/ax-code/src/acp/agent-adapter.ts:186`
- `buildAvailableModels@packages/ax-code/src/acp/agent-adapter.ts:197`
- `formatModelIdWithVariant@packages/ax-code/src/acp/agent-adapter.ts:222`
- `buildVariantMeta@packages/ax-code/src/acp/agent-adapter.ts:233`
- `parseModelSelection@packages/ax-code/src/acp/agent-adapter.ts:247`
- `ACP@packages/ax-code/src/acp/agent.ts:81`
- `decodeTodoPlanEntries@packages/ax-code/src/acp/agent.ts:87`
- `parseTodoPlanEntries@packages/ax-code/src/acp/agent.ts:88`
- `decodeReplayDataUrl@packages/ax-code/src/acp/agent.ts:89`
- `parseListSessionsCursor@packages/ax-code/src/acp/agent.ts:90`
- `init@packages/ax-code/src/acp/agent.ts:92`
- `Agent@packages/ax-code/src/acp/agent.ts:100`
- `PromptPart@packages/ax-code/src/acp/prompt.ts:6`

### Tests
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/cli/acp.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (36) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags api | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `50eb2d2387f5864c` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=21 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
