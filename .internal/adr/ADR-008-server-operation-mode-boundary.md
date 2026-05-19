# ADR-008: Define Server Operation Mode Boundaries

## Status

Proposed

## Date

2026-05-04

## Deciders

To be filled by team

## Related

- ADR-006: Make Agent Control Plane the v5 autonomous architecture foundation
- ADR-007: Establish a Headless Agent Runtime Boundary
- PRD: Server Mode Hardening and Remote Operation Boundaries
- `docs/sdk-http-openapi.md`
- `SECURITY.md`

## Context

AX Code exposes multiple integration surfaces:

- TUI and CLI for local interactive work.
- `@ax-code/sdk` for in-process TypeScript and JavaScript embedding.
- `ax-code serve` plus OpenAPI for HTTP clients and generated cross-language integrations.
- Hidden headless runtime adapters for local automation and attach-mode smoke validation.

The HTTP server is useful because Python, Go, Java, Rust, CI jobs, editor integrations, and internal platforms need a process boundary. However, the API is not a low-risk query API. A caller that can reach and authenticate to the server can drive the local AX Code runtime, which may read files, create sessions, call providers, request permissions, and execute tools according to the active sandbox and permission state.

Current guardrails are necessary but not sufficient for a general remote-control product mode:

- Server mode binds to `127.0.0.1` by default.
- Binding to a non-loopback address requires `AX_CODE_SERVER_PASSWORD`.
- Basic auth is enforced when `AX_CODE_SERVER_PASSWORD` is set.
- CORS restricts browser-origin mutating requests.
- Directory selection rejects dangerous roots and invalid paths.
- The sandbox operates at the application/tool layer, not the OS process layer.

The product question is whether AX Code should support an operation mode where external programs can call AX Code, and whether that should include direct network-accessible control of a local machine.

## Decision

AX Code should keep a server/headless operation mode, but the supported boundary is **local and controlled integration**, not raw public remote control.

We define three operation tiers:

### Tier 1: Local API Mode

Local API Mode is a supported operation mode.

- Default bind address is `127.0.0.1`.
- Intended callers are local SDKs, CLI/TUI attach paths, editor integrations, local automation, and tests.
- This tier may use the current HTTP/OpenAPI contract.
- This tier is the recommended path for generated clients running on the same host or inside the same trusted container/VM.

### Tier 2: Tunneled Remote Mode

Tunneled Remote Mode is supported as an advanced deployment pattern.

- The AX Code server should still bind to loopback where possible.
- Network reachability should be provided by SSH tunnel, Tailscale, VPN, private network policy, or a trusted reverse proxy.
- TLS and identity should be handled by the tunnel or proxy layer.
- This tier is acceptable for teams that already operate a secure private access layer.

### Tier 3: Managed Remote Control Mode

Managed Remote Control Mode is a future product/control-plane capability, not the raw `ax-code serve` HTTP server.

- It must use stronger identity, scoped authorization, audit, policy, and workspace controls.
- It should align with the Agent Control Plane and future AX Trust governance surfaces.
- It should not be implemented by simply documenting `ax-code serve --hostname=0.0.0.0` as a normal remote access pattern.

## Policy

The raw `ax-code serve` command must remain localhost-first.

Non-loopback bind is allowed only as an explicit advanced mode. It must keep hard auth requirements and should grow stronger guardrails before being positioned as safe for remote use.

The project should not market or document raw network-exposed `ax-code serve` as the standard way to control a local AX Code instance from another machine.

For non-JavaScript integrations, the recommended path remains OpenAPI over HTTP, but the deployment guidance must distinguish:

- same-host/local integration,
- private tunneled integration,
- future managed remote control.

## Consequences

### Positive

- Keeps the SDK/OpenAPI value for cross-language clients.
- Preserves local automation and headless integration use cases.
- Avoids conflating a local runtime API with an enterprise remote control plane.
- Gives future AX Trust/control-plane work a clean boundary.
- Makes security posture easier to explain: localhost-first by default, network mode is advanced and explicit.

### Negative / Costs

- Adds product vocabulary and documentation work.
- Existing users who want direct LAN access may need migration guidance.
- Stronger remote hardening will require auth, workspace, permission, and audit changes across multiple surfaces.
- Generated client examples must avoid implying that raw public network exposure is safe.

## Required Follow-Up

Implement the PRD in phases:

1. Clarify docs, warnings, and command output for local vs network operation.
2. Add explicit non-loopback opt-in semantics beyond merely setting a password.
3. Add workspace allowlist/pinning for network-accessible server mode.
4. Improve auth from global password toward scoped tokens.
5. Recommend or enforce safer sandbox defaults for network-accessible mode.
6. Keep managed remote control work separate under the Agent Control Plane / AX Trust boundary.

## Non-Decisions

This ADR does not choose the final managed-control-plane transport.

This ADR does not require removing `ax-code serve`.

This ADR does not make Basic Auth sufficient for public internet exposure.

This ADR does not replace OS-level isolation. Users who need host-level containment should run AX Code in a container, VM, or managed execution environment.

## Acceptance Criteria

- Product docs describe `ax-code serve` as local/headless integration by default.
- Non-loopback bind is clearly marked advanced and high-risk.
- Public SDK/OpenAPI docs do not imply that raw HTTP exposure is safe.
- Any future remote-control feature references this ADR and does not build on unscoped raw server access.
