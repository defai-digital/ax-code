# ADR-020: Make MCP Security a Trust-Boundary Contract

## Status

Proposed

## Date

2026-05-26

## Deciders

To be filled by team

## Related

- ADR-004: Harden autonomous mode with confidence-aware escalation, blast-radius caps, and a critic pass
- ADR-006: Make Agent Control Plane the v5 autonomous architecture foundation
- ADR-008: Define Server Operation Mode Boundaries
- ADR-017: Freeze Effect framework usage at v2.11.0 boundaries
- `.internal/prd/PRD-2026-05-26-mcp-security-layer-hardening.md`
- `packages/ax-code/src/mcp/`
- `packages/ax-code/src/permission/`
- `packages/ax-code/src/server/routes/mcp.ts`
- `packages/ax-code/src/session/prompt-tools.ts`

## Context

AX Code supports local and remote MCP servers.

MCP is useful because it lets agents reach external tools, data sources, and services without AX Code owning every integration. It is also a high-risk boundary:

- local MCP servers execute arbitrary local commands;
- remote MCP servers can receive authenticated requests and return untrusted tool metadata, prompts, and resources;
- MCP tool descriptions and schemas enter the model's tool-selection surface before any individual tool execution permission is asked;
- MCP tools currently use a unified permission key such as `<server>_<tool>`, but the runtime asks with `patterns: ["*"]`, so a durable allow applies to every future argument set for that tool;
- project and remote configuration are already treated as untrusted for `{env:}` and `{file:}` substitution, but MCP enablement does not yet carry that trust distinction all the way to process spawn or tool exposure;
- server routes can add, connect, authenticate, and remove MCP servers through HTTP, making them privileged runtime-control surfaces.

Existing controls are valuable:

- remote MCP URLs use SSRF validation and pinned fetch;
- local MCP processes receive a sanitized environment unless explicit `mcp.environment` is configured;
- OAuth callback handling is loopback-only, state-validated, timeout-bound, and capped;
- MCP tool execution flows through the unified permission system;
- global config redacts MCP headers, OAuth client secrets, and local MCP environment values on config reads.

The question is not whether MCP should exist. The question is what trust boundary AX Code should enforce before a configured MCP server can run, expose tool metadata to the model, or feed prompt/resource content into a session.

## Decision

MCP security must become an explicit trust-boundary contract.

AX Code will continue to support MCP, but MCP servers and MCP-provided content must be treated as untrusted until they cross an explicit trust gate.

The core policy:

1. **Config provenance matters.**
   MCP entries from trusted user-controlled sources may start normally. MCP entries from untrusted sources, such as project configs or remote well-known configs, must not auto-spawn local commands, connect remote servers, expose tool metadata, or fetch prompts/resources until the user grants trust for the exact server fingerprint.

2. **Trust is server-level, permission is operation-level.**
   Trust answers "may this server participate in the runtime at all?" Permission answers "may this tool/resource/prompt be used for this specific operation?"

3. **MCP tool permission must become argument-aware where possible.**
   The permission key remains `<server>_<tool>` for compatibility, but the permission pattern should be derived from stable arguments such as URL, URI, path, repo, owner/name, database, or service resource identifier. If no stable pattern exists, the runtime may still ask, but should not offer durable "always allow everything" semantics by default.

4. **MCP prompts and resources are untrusted context, not instructions.**
   MCP prompts and resources must not bypass the permission system or be treated as authoritative system guidance. They should be gated, truncated, labeled, and injected as untrusted user/context content.

5. **Server MCP mutation routes are privileged control routes.**
   Adding, connecting, authenticating, or removing MCP servers through HTTP is runtime-control behavior. These routes need stronger local-session authorization than generic localhost reachability.

6. **Security should be enforced in named modules, not scattered conditionals.**
   New MCP trust, fingerprint, permission-pattern, content-sanitization, and route-authorization logic should live behind explicit helper APIs with focused tests.

## Best Practices

### Use Fail-Closed Trust Gates

Untrusted project or network config should default to `needs_trust`, not "best-effort connect". Trust should be persisted only after an explicit user action and should be keyed by:

- project ID or global scope;
- MCP server name;
- server type;
- local command plus arguments, or remote URL plus auth mode;
- a versioned fingerprint algorithm.

Changing any fingerprint component should invalidate the previous trust decision.

### Separate Trust, Permission, and Isolation

Trust, permission, and isolation answer different questions:

- trust: whether a server is allowed to start/connect/expose metadata;
- permission: whether a specific tool/resource/prompt operation is allowed;
- isolation: whether the underlying tool execution may touch paths or network at runtime.

Do not use one layer as a substitute for the other two.

### Keep Backward-Compatible Permission Keys

Existing config rules such as `"github_*": "deny"` and `"github_search_repos": "allow"` should continue to work.

Enhance the permission pattern and metadata instead of changing the permission key shape.

### Prefer Stable Argument Patterns

For MCP tool calls, derive permission patterns from known resource-bearing keys:

- filesystem-like: `path`, `file`, `filePath`, `root`, `directory`;
- network-like: `url`, `uri`, `endpoint`;
- repository-like: `owner`, `repo`, `repository`, `project`;
- database-like: `database`, `schema`, `table`, `query` when safe to summarize;
- service-like: `id`, `resource`, `resourceId` when paired with a domain-specific key.

If no stable pattern can be derived, use a non-durable ask by default.

### Sanitize Untrusted MCP Metadata

Tool descriptions, schemas, resource text, prompt text, and stderr lines are untrusted. Enforce size caps, safe serialization, and explicit labels before they reach the model or logs.

### Guard Local HTTP Control Separately

Loopback is not the same as authorization. Local malware, browser-adjacent tooling, and unrelated local processes can reach loopback. Mutating MCP routes should require a local runtime token or an equivalent UI-bound session token even when the server is bound to `127.0.0.1`.

### Keep Remote SSRF and OAuth Controls

The existing SSRF guard, pinned fetch, OAuth state validation, callback timeout, and auth storage locking are the right direction. The MCP security layer should build on them rather than replace them.

### Test With Realistic Fake MCP Servers

Security regressions should use fake local and remote MCP servers where practical, not only source-text assertions. Tests should cover:

- untrusted project config does not spawn local MCP;
- trust fingerprint changes invalidate approval;
- remote private IP and DNS rebinding remain blocked;
- mutating HTTP routes require privileged authorization;
- argument-aware permission patterns are emitted;
- resources/prompts are gated and truncated.

## Pros And Cons

### Trust Gate For Project/Remote Config

Pros:

- closes the largest untrusted-config-to-process-spawn class;
- keeps global user config working;
- gives users a clear one-time decision per server;
- provides a durable audit/troubleshooting surface.

Cons:

- requires config provenance that is not currently preserved in `Config.Info`;
- adds UX states such as `needs_trust`;
- may surprise users who intentionally checked MCP config into a repo.

Decision: adopt.

### Blanket Disable Project MCP

Pros:

- simple to implement;
- strong default safety;
- easy to explain.

Cons:

- breaks legitimate shared repo workflows;
- pushes users toward copying config into global files;
- loses the ability to review and trust a project-specific integration.

Decision: reject as too blunt. Use trust-gated project MCP instead.

### Argument-Aware MCP Permissions

Pros:

- narrows "always allow" decisions;
- aligns MCP with file/path permission semantics;
- improves audit records and permission prompts.

Cons:

- MCP schemas are heterogeneous and server-defined;
- deriving patterns can be imperfect;
- needs careful fallback behavior for unknown tools.

Decision: adopt incrementally with conservative extraction.

### Treat Every MCP Tool As Risky

Pros:

- safe for autonomous mode;
- avoids incorrectly classifying third-party tools as read-only.

Cons:

- more permission prompts;
- some low-risk read-only MCP tools become less ergonomic.

Decision: adopt as the default risk posture. Later trusted servers may declare read-only tool metadata, but AX Code should not trust that declaration without user policy.

### Stronger Local HTTP Route Authorization

Pros:

- protects privileged local runtime-control routes;
- aligns MCP with ADR-008 server operation boundaries;
- reduces dependence on CORS and loopback assumptions.

Cons:

- requires SDK/TUI route clients to carry a local token;
- may affect tests and ad hoc local integrations.

Decision: adopt for mutating MCP routes first.

### OS-Level Sandbox For Local MCP

Pros:

- strongest containment for arbitrary local MCP code;
- reduces blast radius even after trust.

Cons:

- platform-specific and high implementation cost;
- may break many MCP servers that expect filesystem/network access;
- overlaps with broader isolation/runtime strategy.

Decision: defer. Keep application-layer trust and permission first; evaluate OS sandboxing as a future managed-execution project.

## Consequences

### Positive

- MCP becomes safer without removing the integration surface.
- The trust model becomes explainable to users and testable by maintainers.
- Project configs can remain useful while avoiding silent process spawn.
- Permission prompts become more meaningful because they include resource patterns.
- MCP prompts/resources no longer silently bypass the same safety posture as tools.
- The HTTP server boundary becomes consistent with ADR-008.

### Negative / Costs

- Requires new internal metadata for config provenance and MCP trust decisions.
- Adds UX complexity around trust approval, trust revocation, and changed fingerprints.
- Some existing project-level MCP setups will need one-time trust approval.
- Argument-pattern extraction will be imperfect and must fail closed.
- Route authorization changes may require updates to SDK/TUI tests and local automation.

## Implementation Tracking

Implementation is tracked in `.internal/prd/PRD-2026-05-26-mcp-security-layer-hardening.md`.

High-level phases:

1. Add source provenance and server fingerprinting for MCP config.
2. Gate untrusted MCP entries behind explicit trust.
3. Harden mutating MCP HTTP routes.
4. Add argument-aware MCP permission patterns.
5. Gate and sanitize MCP prompts/resources.
6. Add audit, diagnostics, docs, and regression tests.

## Non-Decisions

This ADR does not remove MCP support.

This ADR does not expose Code Intelligence through MCP.

This ADR does not choose a full OS sandbox for local MCP servers.

This ADR does not make Basic Auth sufficient for public network exposure.

This ADR does not change the public MCP protocol or require custom MCP server extensions.

This ADR does not replace the existing permission system.

## Acceptance Criteria

- Untrusted project or remote-wellknown MCP config cannot spawn/connect/expose tools before explicit trust.
- Trust is fingerprinted and invalidates when command, args, URL, or auth mode changes.
- Mutating MCP server routes require privileged local authorization.
- MCP tool permission prompts include resource patterns when derivable.
- MCP prompts and resources are permission-gated, truncated, and labeled as untrusted context.
- Existing trusted global MCP configs continue to work with minimal migration.
- Regression tests cover the trust gate, route hardening, permission patterns, and prompt/resource gating.
