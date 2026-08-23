# @ax-code/computer

> **Unreleased:** this private workspace package and the computer-use feature
> are not part of any v7.x release. v8.0.0 is the earliest eligible public
> release, subject to a separate readiness decision. The implementation is
> retained for internal development, safety fixes, and protocol conformance.

The **open client SDK and canonical protocol home** for AX computer use
(desktop control). This package carries everything a client needs to drive a
computer-use server; it contains **no engine** — the backend adapters, the
Swift driver, and the canonical MCP server (`ax-computer mcp --backend
axnative|cua`) live in the closed repo (`~/code/ax-computer`), which vendors
the shared files from this package (this repo is the source of truth; sync
with `script/sync-open.sh` there). See
`.internal/adr/ADR-061-computer-use-closed-source-split.md` for the boundary
and rationale.

## The canonical protocol

`src/protocol.ts` defines the versioned AX Computer MCP contract:

- `AX_COMPUTER_PROTOCOL_VERSION` / `AX_COMPUTER_PROTOCOL_MIN_VERSION`, with
  version negotiation carried in the MCP `initialize` result
  (`validateProtocolPeer()` produces a clear incompatible-version error).
- Zod schemas for every payload — `ComputerObservation`, `ComputerAction`,
  `ActionResult`, `ComputerElement`, `PixelImage`, `AppInfo`, `WindowInfo`,
  `ObserveScope`, provider capabilities — validated on input AND output.
- The five canonical tools served by one MCP stdio server:
  `ax_capabilities`, `ax_list_apps`, `ax_list_windows`, `ax_observe`,
  `ax_act`.

## The client

`ExternalComputerProvider` (`src/providers/external.ts`) implements
`ComputerUseProvider` against any MCP stdio server speaking the canonical
protocol: it spawns the configured `{ command, args }` via the minimal
newline-delimited JSON-RPC client (`src/mcp/stdio-client.ts`, no MCP SDK
dependency), negotiates the protocol version on connect, and validates every
request/response payload. Backend refusals surface as `{ ok: false, refusal
}` action results, or as `ComputerUseError`s carrying the server's
`structuredContent.code` verbatim (e.g. `unsupported_scope`).

`ComputerSession` (`src/session.ts`) wraps a provider with the
one-active-provider rule, epoch-tracked element targets, and failover — the
open safety plane. `probeProvider` (`src/probe.ts`) is the generic preflight
probe used by `ax-code doctor`.

## Usage from ax-code

Computer use requires the closed `ax-computer` server. Configure:

```jsonc
{
  "computer": {
    "provider": "axnative", // or "cua"; "external" for any canonical server
    // optional: path to the server if not on PATH
    // "command": "/path/to/ax-computer",
  },
}
```

The aliases resolve the server via `computer.command` > `AX_COMPUTER_COMMAND`

> `ax-computer` on PATH and spawn it as `ax-computer mcp --backend <alias>`.
> The core delegates to the `Computer` namespace
> (`packages/ax-code/src/computer/`), gated on `computer.provider`, exposing
> the `computer_snapshot` / `computer_action` / `computer_watch` /
> `computer_plan` tools. This supersedes the ADR-053 relocation of computer use
> to a separate product.

## Layout

- `src/types.ts`, `src/action.ts` — canonical observation/action types
- `src/provider.ts` — `ComputerUseProvider` interface
- `src/session.ts` — `ComputerSession`: one active provider, epoch-tracked
  element targets, failover
- `src/mcp/stdio-client.ts` — minimal MCP stdio client
- `src/protocol.ts` — the versioned canonical AX Computer MCP contract
- `src/providers/external.ts` — `ExternalComputerProvider`: canonical-protocol
  client over a configured MCP stdio server
- `src/probe.ts` — provider-agnostic preflight probe
- `test/compat/suite.ts` — CU-001..CU-010 compat suite, reusable against any
  provider factory (mock providers and an ExternalComputerProvider/fake-server
  arm run in CI; live runs against real backends live in the closed repo)

## Tests

```bash
pnpm --dir packages/ax-computer test
```

All tests are hermetic (fake MCP servers); live backend tests moved to the
closed repo with the engine.
