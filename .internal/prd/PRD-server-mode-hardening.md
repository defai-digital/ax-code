# PRD: Server Mode Hardening and Remote Operation Boundaries

**Date:** 2026-05-04
**Status:** Draft
**Scope:** Internal
**Owner:** ax-code runtime
**Related:** `.internal/adr/ADR-008-server-operation-mode-boundary.md`, `.internal/adr/ADR-007-headless-agent-runtime-boundary.md`, `.internal/adr/ADR-006-v5-agent-control-plane.md`, `SECURITY.md`, `docs/sdk-http-openapi.md`

---

## Purpose

Preserve `ax-code serve` as a useful local/headless integration surface while preventing it from becoming an unsafe raw remote-control mode.

The goal is not to remove HTTP/OpenAPI access. The goal is to make operation boundaries explicit:

- local API for SDKs, editor integrations, CI, tests, and same-host automation;
- tunneled remote access for advanced trusted deployments;
- managed remote control only through a future control-plane design with stronger identity, policy, and audit.

## Problem

External programs need a way to call AX Code. `@ax-code/sdk` covers TypeScript and JavaScript in-process embedding, but non-JavaScript clients need an HTTP/OpenAPI boundary.

At the same time, an AX Code server is powerful. A caller that reaches it can create sessions, route prompts, choose directories, interact with provider credentials, and drive tool execution subject to current permissions and sandbox state. This is closer to controlling a local agent runtime than calling a narrow service API.

Current safeguards are good foundations:

- localhost bind by default;
- password required for non-loopback bind;
- Basic Auth middleware when `AX_CODE_SERVER_PASSWORD` is set;
- CORS protection for browser mutating requests;
- directory validation and dangerous-root rejection.

The gap is product and security posture:

- Basic Auth is global and all-or-nothing.
- HTTP without TLS is not safe over untrusted networks.
- Network-accessible mode can still run with full-access isolation.
- Directory selection is flexible for local clients but too broad for remote callers.
- Docs can make `ax-code serve` look like a normal remote API instead of a local runtime control surface.

## Goals

1. Keep local/headless server mode as a supported integration surface.
2. Clearly separate local API, tunneled remote, and managed remote-control modes.
3. Make non-loopback bind an explicit advanced/high-risk choice.
4. Constrain network-accessible mode by workspace, auth, sandbox, and audit policy.
5. Keep SDK/OpenAPI examples safe by default.
6. Prepare the future managed-control-plane boundary without prematurely building it into raw `serve`.

## Non-Goals

- Remove `ax-code serve`.
- Build a full cloud agent platform in this PRD.
- Replace the TypeScript/JavaScript in-process SDK.
- Replace OpenAPI as the cross-language contract.
- Claim that Basic Auth plus HTTP is sufficient for public internet exposure.
- Add OS-level isolation inside the application sandbox.

## User Stories

### Local automation author

As a developer writing a local script, I can start `ax-code serve` on localhost and call it from Python, Go, Java, Rust, or TypeScript without exposing my machine to the network.

### CI or container user

As a CI user, I can run AX Code inside a constrained container or VM and call the localhost API from job steps, with clear guidance on sandbox and credentials.

### Advanced remote user

As an advanced user, I can connect from another device only after deliberately opting into network mode, setting authentication, and preferably using a tunnel/VPN/reverse proxy.

### Enterprise/platform operator

As a platform operator, I can see that raw `ax-code serve` is not the long-term remote-control plane. I can plan around a future managed control plane with scoped identity, audit, and policy.

## Requirements

### R1: Operation Mode Language

Docs and CLI output must distinguish:

- Local API Mode: localhost-first, supported default.
- Tunneled Remote Mode: advanced, private-network or tunnel-based.
- Managed Remote Control Mode: future control-plane feature, not raw `serve`.

### R2: Non-Loopback Explicit Opt-In

Starting the server on a non-loopback address must require an explicit high-risk acknowledgement in addition to a password.

Candidate forms:

- `--allow-network-control`
- `server.allowNetworkControl: true`
- environment override for automation, with a clear name such as `AX_CODE_ALLOW_NETWORK_CONTROL=1`

The final name can change, but the semantics should be explicit: the user is allowing network clients to control the local AX Code runtime.

### R3: Workspace Pinning / Allowlist

Network-accessible server mode must not accept arbitrary local directories by default.

Candidate behavior:

- If non-loopback, default to the server startup directory only.
- Allow additional directories through explicit config, e.g. `server.allowedDirectories`.
- Reject `x-ax-code-directory` and `directory` query values outside the allowlist.
- Keep dangerous-root rejection as a baseline for all modes.

### R4: Safer Isolation Defaults

Network-accessible mode should strongly prefer bounded execution.

Candidate behavior:

- Warn when non-loopback starts with `full-access`.
- Prefer `workspace-write` as the recommended network mode.
- Consider requiring an explicit override for `full-access` plus non-loopback.
- Keep isolation escalation prompts or policy checks visible in audit.

### R5: Auth Hardening Path

Keep current Basic Auth as the compatibility floor, but define a path toward scoped auth.

Candidate path:

- Phase 1: document current Basic Auth limits.
- Phase 2: support generated bearer tokens for local/tunneled clients.
- Phase 3: add token scopes such as `session:read`, `session:write`, `permission:reply`, `project:read`, `provider:read`.
- Phase 4: bind tokens to workspace allowlists and expiration.

### R6: Audit and Observability

Network-accessible requests should be visible and reviewable.

Minimum event/log fields:

- operation mode;
- bound hostname and port;
- remote address when available;
- authenticated principal/token id if available;
- requested directory;
- route class and mutation/read classification;
- denied reason for auth, origin, workspace, or sandbox policy.

### R7: Safe SDK/OpenAPI Examples

SDK and OpenAPI docs must default to localhost examples.

Docs may include remote guidance only with:

- tunnel/VPN/reverse proxy recommendation;
- TLS warning;
- password/token requirement;
- sandbox recommendation;
- workspace allowlist requirement once implemented.

## Phases

### Phase 0: Documentation and Product Boundary

**Scope**

- Update `docs/sdk-http-openapi.md`.
- Update `SECURITY.md`.
- Update server command help/copy where appropriate.
- Add clear warnings for non-loopback mode.

**Acceptance Criteria**

- Docs say `ax-code serve` is local/headless integration by default.
- Non-loopback bind is marked advanced/high-risk.
- Examples use `127.0.0.1`.
- Docs recommend SSH tunnel, Tailscale, VPN, or trusted reverse proxy for remote access.

### Phase 1: Explicit Network-Control Acknowledgement

**Scope**

- Add explicit opt-in for non-loopback runtime control.
- Preserve current password requirement.
- Add tests for default localhost, rejected non-loopback without password, rejected non-loopback without explicit opt-in, and accepted non-loopback with both.

**Acceptance Criteria**

- `ax-code serve --hostname=0.0.0.0` fails without password and explicit opt-in.
- Error copy explains the risk and safe alternatives.
- Existing local SDK/server tests continue to pass.

### Phase 2: Workspace Pinning

**Scope**

- Add server allowed-directory policy for non-loopback mode.
- Default network-accessible mode to startup directory only.
- Reject remote directory headers outside the allowlist.
- Preserve flexible directory headers for loopback/local mode.

**Acceptance Criteria**

- Network callers cannot select arbitrary absolute local paths.
- Tests cover header/query directory selection inside and outside the allowlist.
- Dangerous-root rejection remains active.

### Phase 3: Safer Network Sandbox Posture

**Scope**

- Detect non-loopback plus `full-access`.
- Emit hard warning or require explicit override.
- Document recommended `workspace-write` network posture.
- Ensure isolation state appears in server startup logs or health/status payload if appropriate.

**Acceptance Criteria**

- Users cannot accidentally start high-risk remote full-access mode silently.
- Tests cover warning/override behavior.
- Docs describe that the sandbox is application-level, not OS-level.

### Phase 4: Auth Upgrade Design

**Scope**

- Design token model before implementation.
- Decide token storage, expiration, scopes, workspace binding, and migration from Basic Auth.
- Align with future Agent Control Plane / AX Trust identity semantics.

**Acceptance Criteria**

- ADR or design note exists for scoped server auth.
- Basic Auth compatibility path is defined.
- Token scopes map to actual route classes.

### Phase 5: Managed Remote Control Boundary

**Scope**

- Keep this separate from raw `serve`.
- Define how managed remote control uses control-plane state, policy, audit, and identity.
- Decide whether transport belongs to ConnectRPC/gRPC, HTTP, gateway-mediated SSE, or another managed channel.

**Acceptance Criteria**

- Managed remote control does not rely on unscoped raw `ax-code serve`.
- Architecture references ADR-006 and ADR-008.
- Local runtime transport and remote governance/control-plane transport remain separate.

## Risks

### Breaking existing advanced users

Some users may already bind to LAN with only `AX_CODE_SERVER_PASSWORD`.

Mitigation: staged rollout, clear error messages, and one release cycle of warning before hard enforcement if compatibility demands it.

### Over-hardening local workflows

Local SDK and TUI attach flows should not become tedious.

Mitigation: keep loopback behavior simple and preserve current default local flow.

### False sense of security

Adding more flags could make users think public exposure is safe.

Mitigation: copy must say that raw network mode is advanced and should be private/tunneled; public/enterprise remote requires managed control-plane work.

### Scope creep into AX Trust

Server hardening can accidentally become a full remote platform project.

Mitigation: keep Phase 5 as boundary/design only unless separately approved.

## Open Questions

1. Should non-loopback mode fail hard without explicit opt-in immediately, or warn for one release first?
2. What should the explicit opt-in flag be called?
3. Should workspace allowlist apply only to non-loopback, or also to loopback when configured?
4. Should Basic Auth remain forever as a fallback, or be deprecated after scoped tokens exist?
5. Should `--mdns` imply network-control opt-in, or require the same explicit flag?

## Validation Plan

- Unit tests for network option resolution and non-loopback guard behavior.
- Server tests for auth middleware, directory allowlist, origin checks, and rate limiting.
- SDK tests for localhost default behavior.
- Documentation review to ensure examples remain localhost-first.
- Manual smoke:

```bash
ax-code serve
ax-code serve --hostname=127.0.0.1 --port=4096
AX_CODE_SERVER_PASSWORD=test ax-code serve --hostname=0.0.0.0 --port=4096
```

Expected behavior will change by phase as explicit opt-in and allowlist controls land.
