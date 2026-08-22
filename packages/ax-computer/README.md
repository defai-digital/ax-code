# @ax-code/computer

Phase 0 of the AX Code computer-use integration: an AX-Code-owned abstraction
over two external MCP computer-use backends.

- **OCU** (`open-computer-use mcp`) — macOS-only, app-scoped. `get_app_state`
  returns a screenshot plus a rendered accessibility tree; elements are
  targeted by tree indices valid only for the latest snapshot.
- **Cua Driver** (`cua-driver mcp`) — cross-platform, window-scoped, with
  structured (`structuredContent`) results and background input delivery.

Both backends are stdio MCP servers speaking newline-delimited JSON-RPC 2.0;
`src/mcp/stdio-client.ts` is a minimal self-contained client (no MCP SDK
dependency).

## Status

Wired into the `ax-code` core as two agent tools, `computer_snapshot` and
`computer_action` (`packages/ax-code/src/tool/computer/`), gated on the
`computer.provider` config (`"cua"` or `"ocu"`). This supersedes the ADR-053
relocation of computer use to a separate product. The core delegates to the
`Computer` namespace (`packages/ax-code/src/computer/`), which constructs the
configured provider and wraps it in a `ComputerSession`; the engine and both
MCP backends stay in this package.
Known intentional gaps:

- `OcuProvider` parses element indices/roles/names out of the accessibility
  tree text, but the tree carries no geometry — OCU elements have no `bounds`.
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
- `src/providers/ocu.ts`, `src/providers/cua.ts` — backend adapters
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

Overrides: `AX_COMPUTER_OCU_COMMAND`, `AX_COMPUTER_CUA_COMMAND` (backend
commands), `AX_COMPUTER_LIVE_APP` (target app, default `TextEdit`).
