# Protocol Steps — cli-cmd-mcp

**Reviewer:** ax-code-glm (zai-coding-plan/glm-5.2[1m])
**Verifier (other lane):** codex-sol
**Date:** 2026-08-11
**Scope read:** `packages/ax-code/src/cli/cmd/mcp.ts` (barrel shim) + `packages/ax-code/src/cli/cmd/mcp-impl.ts` (1022 LOC implementation)

## Step 1 Scope and Map

The unit slug `cli-cmd-mcp` resolves nominally to `packages/ax-code/src/cli/cmd/mcp.ts`, which is a single-line barrel: `export * from "./mcp-impl"` (mcp.ts:1). All real logic lives in `packages/ax-code/src/cli/cmd/mcp-impl.ts`. I read both files in full. The implementation exports the yargs command tree `McpCommand` (mcp-impl.ts:80-94) which registers seven subcommands: `McpListCommand` (96), `McpAuthCommand` (252), `McpLogoutCommand` (437), `McpTrustCommand` (499), `McpUntrustCommand` (535), `McpAddCommand` (598), and `McpDebugCommand` (830). It also exports four pure helpers — `decodeMcpDebugServerInfoValue` (59), `parseMcpDebugServerInfoText` (65), `parseMcpLocalCommand` (71), `formatMcpDebugEpochSeconds` (75) — plus the type-narrowing helper `isMcpRemote` (55).

## Step 2 Threat and Failure Model

The module touches three sensitive boundaries: filesystem writes to `ax-code.json`/`.jsonc` (config mutation via `addMcpToConfig`, mcp-impl.ts:579-596), outbound HTTP to a user-supplied remote URL (`McpDebugCommand`, lines 903-929), and OAuth credential handling (token display at 881-892, credential removal at 491). The debug path is the highest-risk surface because it dials a user-controlled URL. The author placed an explicit SSRF guard at mcp-impl.ts:903-904 (`Ssrf.assertPublicUrl(serverConfig.url, "mcp-debug")`) before any network call and routes every fetch through `Ssrf.pinnedFetch` (911, 967). This is the correct ordering — validate first, then fetch with pinning — and matches the BUG-004 annotation.

## Step 3 Correctness — Control Flow and Cleanup

I traced the `McpDebugCommand` failure paths. The 401 branch consumes the unused response body at mcp-impl.ts:943 (`await response.body?.cancel().catch(() => {})`) with an inline comment explaining the socket-leak rationale. The transport lifecycle at 970-998 has a real correctness property: `client.close()` is called only on the success branch (977), while a `finally` at 992-998 calls `transport.close?.().catch(() => {})` so a non-`UnauthorizedError` throw still releases the underlying socket. The double-close on the success path is safe because of the optional-chaining + catch guard. In `McpAuthCommand`, the `Bus.subscribe(MCP.BrowserOpenFailed, …)` taken at mcp-impl.ts:348 is released in the `finally` at 386-388 across every outcome (success, failure, cancel). All three cleanup points are sound.

## Step 4 Correctness — Config-Write Atomicity

`addMcpToConfig` (mcp-impl.ts:579-596) acquires two locks before its read-modify-write of the config file: `Lock.write(configPath)` (580) for in-process serialization and `FileLock.acquire(configPath)` (581) for cross-process mutual exclusion. Both use `using` disposal, so the locks release on early return or throw. The JSONC edit uses `jsonc-parser`'s `modify` + `applyEdits` (588-591) to preserve comments. One observation: if `modify` returns an empty edit list (malformed input JSON), `applyEdits` returns the original text unchanged and it is rewritten verbatim — not data loss, but also not a no-op skip. Acceptable for a CLI config editor, and the `resolveConfigPath` candidate ordering at 561-577 (`.json` → `.jsonc` → `.ax-code/*`) is consistent with the existing config layer.

## Step 5 Performance and Resource Use

`McpListCommand` pre-computes the per-server tool listing once into a `Map<string, MCP.ToolListing[]>` (mcp-impl.ts:145-152) when `--tools` is set, then reuses the same map for both per-server rendering and the aggregate count at 220. `MCP.status()` (123) and `MCP.listAllTools()` (147) are each invoked exactly once rather than per server — this avoids an N+1 pattern against the MCP runtime. The aggregate reduce at 220 is O(servers × tools) and trivially small. The `TOOL_COUNT_WARN_THRESHOLD = 30` constant (26) is named and carries a multi-line empirical rationale, so it is a documented policy value rather than a magic number.

## Step 6 Design and Cohesion

The module is cohesive: one file, one CLI surface, MCP-only concerns. The four exported pure helpers (`decodeMcpDebugServerInfoValue`, `parseMcpDebugServerInfoText`, `parseMcpLocalCommand`, `formatMcpDebugEpochSeconds`) are the testable seams — they have no `Instance` / `prompts` / IO coupling, which is why they are exported separately from the command objects. The type-narrowing helpers `isMcpRemote` (55) and the `McpEntry` / `McpConfigured` / `McpRemote` aliases (50-54) keep the discriminated-union narrowing DRY across `list`, `auth`, `auth list`, and `debug`. No layer violations: the file imports only from `../../mcp`, `../../config`, `../../permission`, `../../project/instance`, `../../installation`, `../../global`, `../../bus`, and `../../util/*` — all proper downward dependencies from `cli/cmd` into core subsystems, never sideways into `session/`, `provider/`, or `tool/`.

## Step 7 Dead Code and Hygiene

No unreachable branches detected. The empty-catch sites at mcp-impl.ts:237, 943, 997, and 1008 each carry an inline justification and a benign fallback value (empty array, void, void, empty string respectively) — they are intentional silencing of expected best-effort failures, not swallowed errors. The single soft spot is the `as Config.Mcp` cast at mcp-impl.ts:711 (`McpTemplates.toConfig(template, environment) as Config.Mcp`): it asserts the template emitter's output shape without a runtime check, and looks redundant because `McpTemplates.toConfig` is same-package and its declared return type is already `Config.Mcp`. Low risk; cosmetic. No TODOs, no FIXMEs, no commented-out blocks, no unused imports.

## Step 8 Finding Register

No Critical, High, or Medium findings. One Low / informational note worth recording: the `add custom-remote` URL validation (mcp-impl.ts:748-757) only checks that the protocol is `http:` or `https:` and does not call `Ssrf.assertPublicUrl` at add-time — it relies on the debug/connect paths to enforce SSRF later. This is defensible because no network request is fired during `add`, but it should be on the record so a future reviewer does not re-flag it as a gap. No `findings/*.md` files were written because no severity threshold (Medium or above) is met; the `findings/` directory remains empty as found.

## Step 9 Verification and Exit

Independent re-read of the evidence path confirms the conclusions above. I re-read `packages/ax-code/src/cli/cmd/mcp-impl.ts` in full (1022 lines) and `packages/ax-code/src/cli/cmd/mcp.ts` (1 line). The MODULE-AUDIT.md baseline fingerprint `3fb49ce7ea7ae163` matches a 1-file / 2-LOC extract of the shim, but the audit's source inventory undercounts the real implementation mass, which lives in the sibling `mcp-impl.ts` that the barrel re-exports — a verifier should weight the sibling, not the shim. Sign-off: primary reviewer ax-code-glm completes the 9-step protocol for slug `cli-cmd-mcp`; the second-lane pass (codex-sol) should run against `mcp-impl.ts` specifically. No `reverify.md` is required because no Critical findings exist.
