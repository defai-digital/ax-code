# Share a live TUI through MCP

Status: Experimental
Scope: public, current-state
Last reviewed: 2026-10-20
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

The TUIMCP bar shows the absolute private `endpoint.json` path. If it is clipped
in a narrow terminal, click the path or run `/tui-mcp-endpoint` to show it in full. Configure your
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
or workspace state invalidates old revisions. In navigation-only mode, these tools cannot submit prompts,
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

## Native TUI development mode

To inspect and drive the actual native renderer, start a separate development
TUI with explicit screen and input sharing:

```sh
ax-code --tui-debug
# Or:
ax-code attach http://localhost:4096 --tui-debug
```

`--tui-debug` implies `--tui-mcp` for this process only. Its visible sharing bar
says **DEBUG (screen + input)**. It uses the same private endpoint, MCP adapter,
revocation action, identity fences and same-user trust boundary described above.
The ordinary `--tui-mcp` flag still exposes only the two navigation tools.
Debug mode can expose visible conversation content and operate the real TUI;
use a development session. Frames stay in memory and are not recorded by this
interface. Known credential shapes are redacted; this is not a guarantee that
arbitrary sensitive prose can be recognized.

Debug mode adds three MCP tools:

| Tool               | Purpose                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_tui_snapshot` | Read the last rendered text buffer, frame ID, dimensions, cursor, focused renderable ID and modal depth. Supply the instance/generation from `get_view_context`.                                                    |
| `tui_input`        | Dispatch one key, bracketed paste, left click or renderer resize. Supply a fresh context identity/revision and a unique UUID request ID. Clicks also require the observed frame ID and zero-based cell coordinates. |
| `wait_for_tui`     | Wait for literal visible text, a frame newer than `afterFrameId`, or both. Supply the target identity. The deadline is at most 3 seconds.                                                                           |

Input acknowledgement means the renderer received the input, not that an action
finished or a frame was painted. Take a new snapshot or use `wait_for_tui` to
assert the visible result. A newer frame alone does not prove the expected UI
state; combine it with a text condition when appropriate. A snapshot is a text
mirror, not a terminal screenshot: colors, terminal images and font shaping
must still be checked in a real terminal. Resize changes renderer dimensions; it
does not resize the terminal emulator window. Inline mode captures the live renderer
region; historical terminal scrollback is not included.

Pending permission and question requests block debug reads and input. Recent
human input still blocks synthetic input for 1.5 seconds. Ordinary draft and
picker state do not block debug input. There is no evaluation, arbitrary escape
sequence tool, backend credential forwarding, or automatic retry. The existing
128-request receipt limit is shared by navigation and debug mutations. Oversized
screens are rejected rather than silently truncated. `condition_timeout` means
no matching screen was observed in time; `stale_frame` means refresh before
clicking. Never resubmit an uncertain input under a new request ID.

### Local developer page and WebMCP

In a second terminal, use the endpoint path displayed by the debug TUI:

```sh
ax-code debug tui --endpoint /absolute/path/from/the/TUI/endpoint.json
```

Open the printed loopback URL. The page provides a native text-frame preview,
focus and frame metadata, optional live refresh, key/paste/click/resize controls,
and literal text assertions. The inspector binds only to `127.0.0.1`, chooses an
available port by default, and targets exactly one private endpoint. Use
`--port 4097` to choose a port. Stop the inspector with Ctrl+C; revoke TUI sharing
separately to disconnect every adapter.

When the browser supports WebMCP, the page registers the same five tools for a
browser agent. The **Agent access** status reports registration success or
unavailability. WebMCP is optional: manual controls and MCP/SDK access work
without it. The page does not load remote assets or send the private endpoint
token to the browser. The browser adapter cannot grant more authority than the
native controller. Mutating browser calls share an in-flight lock; a different
request receives `busy`, while an identical retry shares the original result.
After input, the inspector waits for a newer native frame. Until that is
observed, the old frame stays visibly marked stale and cell clicks are disabled.
Keys and resizing remain available to recover a TUI that has stopped painting.
The **Latest result** pane shows the latest foreground request; **Recent input
receipts** retain bounded request IDs and outcomes even when a preview update
fails or a later request is rejected. They contain no action text and are not
persisted. Live refresh does not overwrite those outcomes. Website or tool content shown in the TUI remains untrusted.

### Typed SDK access through MCP

The SDK's `tui-debug` subpath accepts a connected standard MCP client, such as a
client using the stdio adapter configured above. It adds no MCP dependency and
does not require the AX Code backend's credentials:

```ts
import { createTuiDebugClient } from "@defai-digital/ax-code-sdk/tui-debug"

// mcpClient is connected to `ax-code mcp tui --endpoint ...`.
const tui = createTuiDebugClient(mcpClient)
const result = await tui.context()
if (result.status !== "context") throw new Error("TUI unavailable")
const { instanceId, generation, revision } = result.context
const target = { instanceId, generation }
const before = await tui.snapshot(target)
if (before.status !== "snapshot") throw new Error("Screen unavailable")

const dispatched = await tui.input({
  ...target,
  expectedRevision: revision,
  requestId: crypto.randomUUID(),
  action: { kind: "paste", text: "Inspect this development session" },
})
if (dispatched.status === "applied") {
  const observed = await tui.wait({
    ...target,
    afterFrameId: before.screen.frameId,
    text: "Inspect this development session",
    timeoutMs: 3000,
  })
  if (observed.status !== "snapshot") throw new Error("Expected screen was not observed")
}
```

The client validates requests and structured replies. Domain rejections are
returned explicitly; transport failures and malformed replies throw. No call
retries, refreshes a stale mutation fence, or selects another TUI automatically.
