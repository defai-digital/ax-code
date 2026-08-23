# @ax-code/computer

An AX-Code-owned abstraction over computer-use backends, with two
user-selectable backends and a shared protocol base.

- **AX Native** (`ax-computer-driver`, AX-owned Swift driver under
  `native/ax-computer-driver/`) — macOS-only, app-scoped. `get_app_state`
  returns a screenshot plus a rendered accessibility tree; elements are
  targeted by tree indices valid only for the latest snapshot.
- **Cua Driver** (`cua-driver mcp`) — cross-platform, window-scoped, with
  structured (`structuredContent`) results and background input delivery.
  `CuaProvider` also supports `transport: "sdk"`, which embeds the pinned
  `@trycua/cua-driver` native SDK in-process instead of spawning the MCP
  server; both transports reach the same Rust tool registry, so tool names,
  arguments, and refusal semantics are identical. The default transport is
  `"mcp"`.

Both backends are stdio MCP servers speaking newline-delimited JSON-RPC 2.0;
`src/mcp/stdio-client.ts` is a minimal self-contained client (no MCP SDK
dependency). The AX native driver and the upstream OCU binary speak the same
app-scoped OCU tool dialect; the shared adapter for that dialect is the
abstract `OcuProtocolProvider` in `src/providers/ocu-protocol.ts` (Cua is also
MCP-based but a different, window-scoped dialect, so it does not derive from
it). The upstream OCU backend itself (`open-computer-use mcp`) survives only
as a test-only reference arm — `UpstreamOcuReferenceProvider` in
`test/helpers/upstream-ocu.ts`, labeled `ocu` so A/B reports stay comparable
with history — used by the live A/B and compat suites.

## Open SDK / closed engine split

This package is the **open client SDK and protocol home** for AX computer
use. It owns the canonical, versioned AX Computer MCP contract
(`src/protocol.ts` — `AX_COMPUTER_PROTOCOL_VERSION`, full zod input/output
validation for every payload, the five canonical tools `ax_capabilities` /
`ax_list_apps` / `ax_list_windows` / `ax_observe` / `ax_act`, and
initialize-result version negotiation via `validateProtocolPeer()`) and the
`ExternalComputerProvider` (`src/providers/external.ts`), which drives any
MCP stdio server speaking that contract.

The computer-use **engine** — the backend adapters, the Swift driver, and
the canonical MCP server (`ax-computer mcp --backend axnative|cua`) — lives
in the closed repo `~/code/ax-computer`. That repo vendors the shared open
files from this package (this repo is the source of truth; sync with
`script/sync-open.sh` there). Configure it from `ax-code` with
`computer.provider: "external"` plus `computer.command` pointing at the
server. The legacy `axnative`/`cua` providers remain in this package until
the dual-stack compatibility release; see
`.internal/adr/ADR-061-computer-use-closed-source-split.md` for the
boundary, rationale, and deferred steps.

## Status

Wired into the `ax-code` core as two agent tools, `computer_snapshot` and
`computer_action` (`packages/ax-code/src/tool/computer/`), gated on the
`computer.provider` config (`"axnative"`, `"cua"`, or `"external"`). This
supersedes the ADR-053 relocation of computer use to a separate product. The
core delegates to the `Computer` namespace (`packages/ax-code/src/computer/`),
which constructs the configured provider and wraps it in a `ComputerSession`;
the legacy in-tree providers above remain here until the dual-stack release
(see the split section).
Known intentional gaps:

- `OcuProtocolProvider` parses element indices/roles/names out of the
  accessibility tree text, but the tree carries no geometry — OCU-dialect
  elements have no `bounds`.
- Cua tool-call argument field names follow the driver source
  (`rust/crates/platform-macos/src/tools/*.rs`). The click and scroll
  coordinate semantics are verified live against cua-driver 0.21.0; the rest
  remain assumed — all argument construction is isolated in
  `CuaProvider.toCuaArgs` for correction.

## Layout

- `src/types.ts`, `src/action.ts` — canonical observation/action types
- `src/provider.ts` — `ComputerUseProvider` interface
- `src/session.ts` — `ComputerSession`: one active provider, epoch-tracked
  element targets, failover
- `src/mcp/stdio-client.ts` — minimal MCP stdio client
- `src/protocol.ts` — the versioned canonical AX Computer MCP contract (zod
  schemas, canonical tool definitions, version negotiation)
- `src/providers/external.ts` — `ExternalComputerProvider`: canonical-protocol
  client over a configured MCP stdio server
- `src/providers/ocu-protocol.ts` — abstract base for the app-scoped OCU tool
  dialect; `src/providers/axnative.ts`, `src/providers/cua.ts` — the two
  user-selectable backend adapters
- `test/compat/suite.ts` — CU-001..CU-010 compat suite, reusable against any
  provider factory

## Tests

Unit tests (no live backends needed):

```bash
pnpm --dir packages/ax-computer test
```

Live compat suite (macOS; requires the backend CLIs, uses TextEdit as a
benign target app):

```bash
AX_COMPUTER_LIVE=1 pnpm --dir packages/ax-computer test
```

Overrides: `AX_COMPUTER_AXNATIVE_COMMAND`, `AX_COMPUTER_CUA_COMMAND` (backend
commands), `AX_COMPUTER_LIVE_APP` (target app, default `TextEdit`).
`AX_COMPUTER_OCU_COMMAND` selects the upstream OCU binary for the test-only
reference arm in the live A/B and compat suites.
