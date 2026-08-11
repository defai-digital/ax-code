# MODULE-AUDIT: desktop-web-quota

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-quota` |
| Scope | `desktop/packages/web/server/lib/quota` |
| Resolved root | `desktop/packages/web/server/lib/quota` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `f19960659a70eb47` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 27 / 2550 |
| Inventory ID | W7-16 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/quota/index.js` | 27 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/claude.js` | 102 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/codex.js` | 114 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/copilot.js` | 158 | 8 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/api.js` | 92 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/auth.js` | 108 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/index.js` | 109 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/transforms.js` | 93 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/index.js` | 170 | 18 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/kimi.js` | 108 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/minimax-cn-coding-plan.js` | 126 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/minimax-coding-plan.js` | 129 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/nanogpt.js` | 119 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/ollama-cloud.js` | 113 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/ollama-cloud.test.js` | 90 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/openai.js` | 86 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/openrouter.js` | 86 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/wafer.js` | 132 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/zai.js` | 92 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/zhipuai-coding-plan.js` | 157 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/routes.js` | 28 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/auth.js` | 47 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/auth.test.js` | 56 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/formatters.js` | 86 | 7 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/formatters.test.js` | 55 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/index.js` | 11 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/transformers.js` | 56 | 7 | 0 | 0 |

### Exports (sample)
- `providerId@desktop/packages/web/server/lib/quota/providers/claude.js:4`
- `providerName@desktop/packages/web/server/lib/quota/providers/claude.js:5`
- `aliases@desktop/packages/web/server/lib/quota/providers/claude.js:6`
- `isConfigured@desktop/packages/web/server/lib/quota/providers/claude.js:8`
- `fetchQuota@desktop/packages/web/server/lib/quota/providers/claude.js:14`
- `providerId@desktop/packages/web/server/lib/quota/providers/codex.js:12`
- `providerName@desktop/packages/web/server/lib/quota/providers/codex.js:13`
- `aliases@desktop/packages/web/server/lib/quota/providers/codex.js:14`
- `isConfigured@desktop/packages/web/server/lib/quota/providers/codex.js:17`
- `fetchQuota@desktop/packages/web/server/lib/quota/providers/codex.js:23`
- `providerId@desktop/packages/web/server/lib/quota/providers/copilot.js:31`
- `providerName@desktop/packages/web/server/lib/quota/providers/copilot.js:32`
- `aliases@desktop/packages/web/server/lib/quota/providers/copilot.js:33`
- `isConfigured@desktop/packages/web/server/lib/quota/providers/copilot.js:35`
- `fetchQuota@desktop/packages/web/server/lib/quota/providers/copilot.js:41`
- `providerIdAddon@desktop/packages/web/server/lib/quota/providers/copilot.js:97`
- `providerNameAddon@desktop/packages/web/server/lib/quota/providers/copilot.js:98`
- `fetchQuotaAddon@desktop/packages/web/server/lib/quota/providers/copilot.js:100`
- `refreshGoogleAccessToken@desktop/packages/web/server/lib/quota/providers/google/api.js:22`
- `fetchGoogleQuotaBuckets@desktop/packages/web/server/lib/quota/providers/google/api.js:42`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (118) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f19960659a70eb47` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=29 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
