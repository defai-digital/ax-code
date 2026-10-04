# Share a live TUI through MCP

Status: Experimental
Scope: public, current-state
Last reviewed: 2026-10-04
Owner: AX Code maintainers

TUIMCP is an experimental, opt-in MCP adapter for the AX Code TUI on macOS
and Linux. It lets an external agent read bounded interface state and navigate
the same TUI you are using. Windows is not supported in this version.

Start a TUI with explicit sharing:

```sh
ax-code --tui-mcp
# Or attach to an existing local backend:
ax-code attach http://localhost:4096 --tui-mcp
```

The TUIMCP bar shows the absolute private `endpoint.json` path. Configure your
MCP client to launch:

```json
{
  "mcpServers": {
    "ax-code-tui": {
      "command": "ax-code",
      "args": ["mcp", "tui", "--endpoint", "/absolute/path/from/the/TUI/endpoint.json"]
    }
  }
}
```

Use the path shown by your running TUI. Each TUI has its own endpoint; there is
no automatic discovery or target selection. The client must run as the same OS
user. Treat the endpoint file as a capability: it contains a secret token.
Do not commit, copy into prompts, or share its contents. Backend credentials
are never passed to the adapter.

## Tools

- `get_view_context`: returns instance/generation, revision, route, optional
  session ID, readiness and whether navigation is blocked. It does not return
  transcripts, drafts, session titles, workspace paths or credentials.
- `select_session`: requires the identity and revision from a fresh context,
  a project session ID and a unique UUID `requestId`. It validates the session
  through the TUI's existing authenticated backend connection. A successful
  response acknowledges application route state; rendering and session loading
  can still be in progress. Session IDs can be obtained separately through the
  ordinary AX Code session interfaces.

Navigation is rejected while a draft or attachment exists, a modal or approval
is pending, sessions are busy, the backend is disconnected, startup/exit overlays
are active, or the user has interacted within the last 1.5 seconds. Changed UI
or workspace state invalidates old revisions. These tools cannot submit prompts,
execute shell commands, approve permissions or start agent work.

A repeated identical `requestId` returns its original receipt, including its
original context. Reusing it with different arguments is an error. After 128
navigation requests, new requests are refused for that TUI process; read access
and existing receipts remain available. Restart with explicit sharing to reset
this limit. Receipts are not evicted into unsafe replay.

`deadline_exceeded` means validation was cancelled before navigation.
`timeout_unknown` or `outcome_unknown` means the caller did not receive a definitive outcome; the
operation might have applied. Read the current context to reconcile. The adapter
never retries automatically. A connection or transport success by itself does
not mean a navigation succeeded; inspect `isError` and the structured result.

## Revoke and lifecycle

Click **[Revoke]** in the TUIMCP bar or run `/tui-mcp-revoke`. Revocation immediately
fences pending navigation and closes the socket. Exit also closes the endpoint;
restart creates a new identity and token. A crashed process can leave an inert
private temporary directory; old clients cannot attach to a new TUI through it.

Sharing is off by default and is not persisted. Local owner/mode checks protect
against other OS users; TUIMCP is not a sandbox against code already running as
your user. If startup reports that the socket path is too long, use a shorter
private temporary root through `TMPDIR` and start a new TUI.
