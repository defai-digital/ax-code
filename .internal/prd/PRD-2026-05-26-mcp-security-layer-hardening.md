# PRD: MCP Security Layer Hardening

**Date:** 2026-05-26
**Status:** In progress - Phase 1/2 trust-gate slice implemented
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-020 (MCP security trust boundary), ADR-008 (server operation mode boundary), ADR-004 (autonomous hardening), ADR-017 (Effect freeze), `packages/ax-code/src/mcp/`, `packages/ax-code/src/permission/`, `packages/ax-code/src/server/routes/mcp.ts`
**Archive criteria:** Untrusted MCP config is trust-gated, mutating MCP routes are locally authorized, MCP tool permissions are argument-aware, MCP prompts/resources are gated and sanitized, and focused regression tests pass.

---

## Purpose

Make MCP safe enough to remain a first-class integration surface for AX Code without allowing untrusted project config, local HTTP callers, or third-party MCP metadata to silently expand runtime authority.

This PRD turns the MCP security review into implementation-ready phases.

## Current Implementation Snapshot

Implemented on 2026-05-26:

- MCP config provenance is tracked internally for trust decisions without changing the public config shape.
- Project and remote well-known MCP entries default to `needs_trust`.
- MCP trust fingerprints are persisted outside the repository and invalidate when material server config changes.
- Untrusted MCP entries do not instantiate transports, start local commands, connect remote URLs, or begin OAuth.
- CLI support exists for `ax-code mcp trust <name>` and `ax-code mcp untrust <name>`.
- Focused MCP trust tests and OAuth regression updates are in place.

Still pending:

- privileged authorization for mutating MCP HTTP routes;
- argument-aware MCP permission patterns;
- MCP prompt/resource permission gates and content labeling;
- MCP metadata/schema/log/audit hardening;
- public docs and release notes.

## Problem

MCP currently crosses several sensitive boundaries:

- local MCP config can run arbitrary commands;
- remote MCP config can connect to third-party services with headers or OAuth;
- MCP tool descriptions and schemas are exposed to the model before execution permission;
- MCP tool execution asks permission with `patterns: ["*"]`;
- MCP prompts and resources are listed/read outside the same permission model used for tools;
- HTTP `/mcp` mutation routes can add or connect servers in the running process;
- project and remote configs are untrusted for secret substitution, but that trust state is not carried into MCP enablement.

Existing mitigations are meaningful but incomplete:

- SSRF and DNS rebinding protection exist for remote URLs.
- Local MCP child processes get sanitized inherited environment.
- OAuth callback handling has state, timeout, and pending-flow caps.
- MCP tools pass through the unified permission system.
- Config routes redact MCP secrets.

The gap is an explicit MCP trust layer that connects config provenance, runtime enablement, permission prompts, prompt/resource ingestion, and server control routes.

## Review: Options, Pros, And Cons

### Option A: Do Nothing

Pros:

- No compatibility risk.
- Existing MCP users see no new prompts.
- No implementation cost.

Cons:

- Untrusted project MCP config can still become runtime authority.
- Tool-wide "always allow" remains too broad.
- MCP prompts/resources remain weaker than tool execution.
- Server route hardening stays inconsistent with the risk of MCP mutation routes.

Decision: reject.

### Option B: Disable MCP From Project Config

Pros:

- Simple and strong.
- Removes the riskiest shared-repo path.
- Easy to document.

Cons:

- Breaks legitimate project-scoped MCP setup.
- Forces teams to copy project integrations into global config.
- Does not solve HTTP route hardening or argument-aware permissions.

Decision: reject as the primary approach. Keep as an emergency feature flag if needed.

### Option C: Trust-Gate Untrusted MCP Config

Pros:

- Preserves legitimate project MCP workflows.
- Prevents silent process spawn/connect from untrusted sources.
- Makes the security boundary visible and auditable.
- Can invalidate automatically when server fingerprints change.

Cons:

- Requires config provenance that `Config.Info` does not currently preserve.
- Adds a new `needs_trust` runtime state and UI/CLI handling.
- Needs durable trust storage and revocation.

Decision: adopt.

### Option D: Route MCP Tools Through Existing Permission Only

Pros:

- Minimal change.
- Keeps one permission system.
- Already partially implemented.

Cons:

- `patterns: ["*"]` makes durable allow too broad.
- Prompts do not explain the resource being authorized.
- Audit records cannot answer which repo/path/url/database was touched.

Decision: retain compatibility, but enhance with argument-derived patterns and metadata.

### Option E: Add A New Separate MCP Allow/Deny Config

Pros:

- Could be domain-specific.
- Might be easier to document for MCP-only users.

Cons:

- Duplicates permission semantics.
- Creates precedence and UI confusion.
- Existing `permission` config already supports MCP keys.

Decision: reject. Keep unified permission keys.

### Option F: Harden Mutating MCP HTTP Routes

Pros:

- Protects local runtime-control operations.
- Aligns with ADR-008.
- Can start narrowly with `/mcp` mutation routes before broader server auth work.

Cons:

- Requires TUI/SDK/local callers to send a runtime token.
- Tests and local automation need updates.

Decision: adopt.

### Option G: OS Sandbox Local MCP Servers

Pros:

- Strong containment after trust is granted.
- Reduces blast radius of compromised MCP packages.

Cons:

- Platform-specific.
- High risk and high compatibility cost.
- Duplicates broader isolation/runtime concerns.

Decision: defer.

## Rethought Best Practices

1. **Default trust should be source-sensitive, not global.**
   Global user config and managed config are trusted by default. Project config and remote-wellknown config are not.

2. **No untrusted MCP participation before trust.**
   Untrusted entries should not spawn, connect, expose tool schemas/descriptions, list resources, list prompts, or run auth flows before explicit trust.

3. **Trust decisions must be fingerprinted.**
   The trust decision must be invalidated when command, args, URL, type, OAuth mode, or headers policy materially changes.

4. **Tool permission stays unified but becomes more specific.**
   Keep `<server>_<tool>` permission keys, but populate permission patterns from stable arguments when possible.

5. **Unknown MCP tools are risky by default.**
   A third-party MCP tool is not safe just because it looks read-only. Default autonomous behavior should treat MCP as risk unless a user policy explicitly allows it.

6. **MCP content is untrusted input.**
   Tool descriptions, schemas, prompts, resources, and stderr lines should be size-limited, sanitized, and labeled before they reach logs, model context, or UI.

7. **Server mutation routes need local authorization.**
   Loopback and CORS are helpful but not enough for route-level authority. MCP mutation routes should require a runtime-local token or equivalent privileged channel.

8. **Prefer small named APIs and tests.**
   Add `mcp/trust`, `mcp/permission-pattern`, and `mcp/content-safety` helpers rather than embedding one-off checks across session, server, and CLI code.

9. **Keep public config shape stable.**
   Avoid breaking existing `ax-code.json` schema unless necessary. Internal provenance can be carried beside parsed config.

10. **Do not expand Effect.**
    New modules should use async/await and Zod per ADR-017.

## Goals

1. Prevent untrusted project or remote config from silently starting MCP servers.
2. Preserve trusted global/user MCP workflows.
3. Make MCP permission prompts resource-aware where practical.
4. Gate MCP prompts and resources through the same safety posture as tools.
5. Require privileged local authorization for MCP mutation routes.
6. Add focused tests that lock the trust, permission, and route contracts.

## Non-Goals

- Remove MCP support.
- Build a full OS sandbox for MCP processes.
- Create a second MCP-specific permission config language.
- Require MCP server protocol extensions.
- Rewrite the config loader wholesale.
- Make raw `ax-code serve` safe for public internet exposure.
- Classify every third-party MCP server's tools as read-only/risky in the first slice.

## Users

### Maintainer

As a maintainer, I can review exactly why an MCP server is trusted, what fingerprint was approved, and which permission pattern was evaluated for a tool call.

### User

As a user, I can open a repo with MCP config without silently running commands or sending authenticated traffic until I approve the server.

### Agent

As an agent, I can still use approved MCP tools, but high-risk or unknown MCP operations ask for permission with meaningful resource context.

### SDK / integration caller

As an integration caller, I can still manage MCP through supported routes after authenticating through the local privileged channel.

## Requirements

### R1: MCP Config Provenance

AX Code must know whether each MCP entry came from:

- managed config;
- global user config;
- explicit `AX_CODE_CONFIG`;
- inline `AX_CODE_CONFIG_CONTENT`;
- project config;
- `.ax-code` worktree config;
- remote well-known config;
- runtime API addition.

Trusted by default:

- managed config;
- global user config;
- explicit `AX_CODE_CONFIG`;
- inline `AX_CODE_CONFIG_CONTENT`;
- runtime API additions that pass privileged route authorization.

Untrusted by default:

- project config;
- `.ax-code` worktree config;
- remote well-known config.

Implementation note: public `Config.Info` should remain stable. Provenance can be exposed through a new internal helper, for example `Config.mcpSources()` or `McpConfig.resolveEntries()`, instead of changing the public config object shape.

### R2: MCP Server Fingerprint

Add a deterministic fingerprint for each MCP server:

Local fingerprint inputs:

- server name;
- type `local`;
- command array;
- explicit environment keys and values hash;
- worktree/project scope;
- fingerprint version.

Remote fingerprint inputs:

- server name;
- type `remote`;
- normalized URL;
- OAuth mode;
- header names and value hash;
- fingerprint version.

Do not log raw secret values. Use hashes for values that can contain secrets.

### R3: Trust Store

Add durable trust storage keyed by:

- project ID for project-scoped trust;
- global scope for global trust;
- MCP server name;
- fingerprint.

Trust records should include:

- status `trusted` or `revoked`;
- source kind;
- created timestamp;
- last used timestamp;
- optional user-facing reason.

The storage location should follow existing project/global state patterns and avoid committing trust records to the repository.

### R4: Runtime Status

Extend MCP status with `needs_trust`.

For untrusted entries:

- do not call `create()`;
- do not instantiate transports;
- do not list tools, prompts, or resources;
- return status `{ status: "needs_trust", fingerprint, source }` or a redacted equivalent suitable for UI.

### R5: Trust Operations

Add trust operations:

- list pending MCP trust requests;
- trust one server fingerprint;
- revoke trust for one server or all servers in a project;
- explain why a server is blocked.

Surfaces:

- CLI: `ax-code mcp trust`, `ax-code mcp untrust`, and `ax-code mcp list --trust` or equivalent;
- server routes: privileged local routes only;
- TUI: can be deferred to a follow-up if CLI and route support are present.

### R6: Mutating MCP Route Authorization

Require privileged local authorization for:

- `POST /mcp`;
- `POST /mcp/:name/connect`;
- `POST /mcp/:name/disconnect`;
- `POST /mcp/:name/auth`;
- `POST /mcp/:name/auth/authenticate`;
- `POST /mcp/:name/auth/callback`;
- `DELETE /mcp/:name/auth`;
- future MCP trust mutation routes.

The first implementation can use a process-local runtime token generated at server startup and injected into first-party SDK/TUI calls. If a general server auth redesign lands first, this PRD should reuse it.

### R7: Argument-Aware Tool Permission Patterns

Add helper `McpPermissionPattern.derive(toolName, args, schema)` or equivalent.

Output:

- `patterns`: one or more stable patterns;
- `durable`: boolean indicating whether "always" is safe to offer;
- `metadata`: redacted summary for UI/audit.

Examples:

- URL argument: `url:https://api.github.com/repos/owner/repo`
- file path argument: normalized project/worktree-relative path when inside worktree; external path should be redacted or routed through risk metadata;
- repo owner/name: `repo:owner/name`
- resource URI: `uri:mcp-resource-uri`
- no stable resource: `patterns: ["*"]`, `durable: false`

Runtime behavior:

- pass derived patterns to `ctx.ask`;
- set `always` only when durable;
- include metadata with server, tool, and redacted args summary.

### R8: MCP Prompt And Resource Gating

Add permission gates for:

- prompt listing or prompt use: `mcp_prompt_<server>` or `mcp:<server>:prompt` style internal key, final shape to be chosen during implementation;
- resource reads: `mcp_resource_<server>` or equivalent.

Requirements:

- preserve backward compatibility where possible;
- truncate fetched prompt/resource text before prompt injection;
- label content as untrusted MCP content;
- prevent resource reads from silently streaming large blobs into the model.

### R9: Metadata And Schema Safety

For MCP tools:

- cap tool description length;
- cap serialized input schema size/depth;
- reject schemas that exceed budget or fail safe normalization;
- do not log raw schema or raw secret-bearing metadata.

For MCP stderr:

- cap per-line length;
- avoid logging obvious secret patterns.

For MCP outputs:

- keep existing truncation;
- ensure `content` returned to the model does not bypass truncation when `output` is truncated.

### R10: Audit And Diagnostics

Record:

- trust decisions;
- trust denials;
- fingerprint mismatch;
- MCP route mutation attempts;
- MCP permission patterns and decisions;
- prompt/resource reads.

Audit records should avoid raw secrets and large content.

## Implementation Plan

### Phase 0: Baseline Contract Tests

Status: Implemented for trust-gate contract coverage; route, permission-pattern, prompt/resource, and metadata tests remain with their later phases

Tasks:

- Add tests documenting current MCP trust gaps as pending/expected failing only if the test harness supports it; otherwise add source-level contract tests first.
- Add fake local MCP server test fixture that can detect whether a process was spawned.
- Add fake remote MCP fixture or mocked transport tests for status/tool listing behavior.
- Add route tests for `/mcp` mutation paths.

Candidate files:

- `packages/ax-code/test/mcp/trust.test.ts`
- `packages/ax-code/test/mcp/permission-pattern.test.ts`
- `packages/ax-code/test/server/mcp-routes-security.test.ts`
- `packages/ax-code/test/fixture/mcp/`

Validation:

- `bun test test/mcp test/server/mcp-routes-security.test.ts`

### Phase 1: Provenance And Fingerprint Foundation

Status: Implemented for MCP trust-gate slice

Tasks:

- Add `packages/ax-code/src/mcp/trust.ts`.
- Add `packages/ax-code/src/mcp/fingerprint.ts` or keep fingerprinting inside `trust.ts` if small.
- Extend config loading internals to preserve MCP entry provenance without changing public `Config.Info`.
- Add a helper that returns resolved MCP entries with `{ name, config, source, trustedByDefault, fingerprint }`.
- Add redaction-safe hashing utilities for secret-bearing config values.

Acceptance criteria:

- Tests can distinguish global MCP config from project MCP config.
- Fingerprints are deterministic and change when command, args, URL, OAuth mode, or explicit env/header values change.
- Public config route output remains unchanged except for existing redaction behavior.

Validation:

- `bun test test/config/config.test.ts test/mcp/trust.test.ts`
- `bun run typecheck`

### Phase 2: Trust Gate Runtime Enforcement

Status: Implemented for CLI/runtime trust-gate slice

Tasks:

- Extend `MCP.Status` with `needs_trust`.
- Update MCP state initialization to skip `create()` for untrusted entries without stored trust.
- Ensure skipped entries do not instantiate local or remote transports.
- Add CLI visibility in `ax-code mcp list`.
- Add `ax-code mcp trust <name>` and `ax-code mcp untrust <name>` or equivalent.
- Add reconnect behavior after trust is granted.

Acceptance criteria:

- Project MCP local command is not spawned until trusted.
- Remote MCP URL is not connected until trusted.
- Trust survives restart for the same project and fingerprint.
- Fingerprint change returns to `needs_trust`.
- Trusted global config keeps existing behavior.

Validation:

- `bun test test/mcp/trust.test.ts test/cli/mcp-*.test.ts`
- `bun run typecheck`

### Phase 3: Mutating Route Authorization

Status: Not started

Tasks:

- Add a route-level helper for privileged local mutation authorization.
- Require it on all mutating `/mcp` routes.
- Wire first-party TUI/SDK callers to send the token.
- Keep `GET /mcp` status read-only and compatible unless broader server policy changes.
- Add tests for missing/invalid token and valid first-party token.

Acceptance criteria:

- Unauthenticated `POST /mcp` cannot add or spawn a local MCP server.
- Authenticated first-party route calls still work.
- Non-loopback password requirement remains intact.
- CORS origin checks remain in place.

Validation:

- `bun test test/server/mcp-routes-security.test.ts test/server/route-validation.test.ts`
- `bun run typecheck`

### Phase 4: Argument-Aware Permission Patterns

Status: Not started

Tasks:

- Add `packages/ax-code/src/mcp/permission-pattern.ts`.
- Derive stable patterns from common MCP argument keys.
- Update `session/prompt-tools.ts` MCP wrapper to call the helper.
- Set `always` to derived durable patterns only.
- Include redacted argument metadata in permission requests.
- Add tests for URL, URI, file path, repo, database, unknown args, and secret redaction.

Acceptance criteria:

- MCP permission prompts no longer default every call to durable `*` when a stable resource exists.
- Unknown argument shapes ask once but do not offer broad durable approval by default.
- Existing `permission` config using MCP keys still applies.

Validation:

- `bun test test/mcp/permission-contract.test.ts test/mcp/permission-pattern.test.ts test/session/prompt-tools.test.ts`
- `bun run typecheck`

### Phase 5: Prompt And Resource Safety

Status: Not started

Tasks:

- Add permission gates for MCP resource reads in `session/prompt-mcp-resource.ts`.
- Add permission gates for MCP prompt use in `command/index.ts` or the prompt command resolution path.
- Add size caps and truncation for resource/prompt text before injection.
- Label fetched prompt/resource content as untrusted MCP context.
- Avoid returning raw large blobs to the model; keep binary placeholders.

Acceptance criteria:

- Reading an MCP resource asks or follows config permission.
- Using an MCP prompt asks or follows config permission.
- Large MCP resource/prompt content is truncated before model injection.
- Output clearly labels MCP content as untrusted context.

Validation:

- `bun test test/session/prompt-mcp-resource.test.ts test/command/mcp-prompt.test.ts`
- `bun run typecheck`

### Phase 6: Metadata, Output, And Log Safety

Status: Not started

Tasks:

- Cap MCP tool description length before exposing to the model.
- Cap serialized schema size/depth and fail closed for pathological schemas.
- Cap MCP stderr log line length and scrub obvious secret patterns.
- Verify MCP result `content` cannot bypass truncation when `output` is truncated.
- Add audit events for trust decisions, route mutations, and MCP permission evaluations.

Acceptance criteria:

- Oversized tool descriptions/schemas fail closed or are truncated with metadata.
- MCP outputs sent back to the model respect truncation intent.
- Logs and audit records avoid raw secrets.

Validation:

- `bun test test/mcp/metadata-safety.test.ts test/mcp/headers.test.ts test/server/audit-route.test.ts`
- `bun run typecheck`

### Phase 7: Documentation And Migration

Status: Not started

Tasks:

- Update MCP docs or add a dedicated `docs/mcp.md`.
- Document trusted vs untrusted config behavior.
- Document permission examples for MCP tools.
- Add release notes for one-time trust prompts.
- Add a troubleshooting section for `needs_trust`.

Acceptance criteria:

- Users understand why project MCP config is blocked.
- Users can approve, revoke, and inspect MCP trust.
- Existing global MCP users have a clear compatibility path.

Validation:

- Docs review against source-of-truth files.

## Risks And Mitigations

### Risk: Config provenance refactor grows too large

Mitigation:

- Do not rewrite `Config.Info`.
- Add an internal MCP-specific provenance helper first.
- Keep public config shape unchanged.

### Risk: Too many prompts hurt MCP usability

Mitigation:

- Trust is one-time per server fingerprint.
- Permission patterns can be durable when stable.
- Global trusted config retains existing ergonomics.

### Risk: Argument pattern extraction gives false confidence

Mitigation:

- Mark derived patterns with metadata.
- Fail unknown shapes to non-durable ask.
- Keep exact MCP permission keys compatible.

### Risk: Route token impacts SDK/TUI callers

Mitigation:

- Start with MCP mutation routes only.
- Wire first-party clients before enforcing in shipped code.
- Keep read-only status route compatible.

### Risk: Untrusted MCP prompt/resource labels pollute UX

Mitigation:

- Use concise labels.
- Keep labels in synthetic text/context, not oversized wrappers.
- Add snapshot tests for prompt text shape.

## Test Matrix

| Area | Tests |
| --- | --- |
| Config provenance | global vs project vs `.ax-code` vs well-known MCP source |
| Fingerprint | command/args/url/oauth/header/env changes invalidate trust |
| Runtime gate | untrusted local MCP does not spawn; untrusted remote does not connect |
| CLI | list shows `needs_trust`; trust/untrust changes status |
| Server routes | mutating `/mcp` rejects missing token; valid token works |
| Permission patterns | URL, URI, repo, path, database, unknown args |
| Prompt/resource | gated, truncated, labeled as untrusted |
| Metadata safety | oversized schema/description/stderr/output |
| Regression | existing global trusted MCP and permission wildcard behavior |

## Rollout Plan

1. Land Phase 1 behind tests with no behavior change.
2. Land Phase 2 with `needs_trust` enforcement for project and remote-wellknown MCP config.
3. Land Phase 3 route authorization after first-party clients are wired.
4. Land Phase 4 permission-pattern improvements.
5. Land Phase 5 prompt/resource gating.
6. Land Phase 6 metadata/log/audit hardening.
7. Land Phase 7 docs and release note updates.

## Done When

- `MCP.status()` can represent untrusted configured servers without connecting them.
- Project MCP local commands do not execute before explicit trust.
- Mutating MCP routes are privileged.
- MCP tool permission prompts carry resource-specific patterns where possible.
- MCP prompts and resources require permission and are injected as bounded untrusted context.
- Focused tests pass for all phases.
- `bun run typecheck` passes in `packages/ax-code`.
