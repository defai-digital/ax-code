---
name: browser-troubleshooting
description: Diagnose why the WebMCP browser bridge will not enable, connect, navigate, read or act, and report the exact blocker and remedy. Use when the WebMCP chip, a bridge tool, or a browser approval fails.
agent: build
argument-hint: <symptom, e.g. "chip stays off", "spawn npx ENOENT", "read grant denied">
---

Diagnose the WebMCP bridge failure in $ARGUMENTS in the order below. Stop at the first step that explains the symptom, report the exact blocker and its remedy, and do not retry a denied or uncertain operation.

## Enable gesture

- The bridge starts only from the WebMCP chip click (or `/webmcp`); nothing starts automatically.
- The chip persists the enable to user-level config; at the next start the entry is enabled, but the startup connect still passes the normal MCP trust gate, so a trust prompt there is expected, not a failure.
- Remedy: when the bridge never started, click the chip or run `/webmcp` first.

## Chrome detection states

- The chip reports `missing` (no Chrome 150+ found), `outdated` (major below 150), or `ready`.
- WebMCP page tools need Chrome 150+ with `--enable-features=WebMCP`, which the bridge passes itself.
- Remedy for `missing`: install Chrome, or set `executablePath` via `ax-code mcp webmcp --executable-path`. Remedy for `outdated`: upgrade Chrome.

## Launcher failures

- `spawn npx ENOENT` means `npx` is not on the PATH the TUI inherited. Remedy: fix the inherited PATH, or use the managed vendored launch (`allowVendored`).
- A vendored launch fails closed on integrity mismatch, with no npx fallback. Remedy: repair the vendored install.
- A drifted stored `command` is regenerated from the profile on connect (ADR-173), so hand-editing the command never helps. Remedy: fix the profile and reconnect.

## Managed policy

- The managed-only `webmcp` requirement can set `allow: false` (bridge denied before spawn), `allowRead: false` (read tier forced off), `allowInteract: false`, or `allowedOrigins` (narrowing).
- Project and user config cannot loosen managed policy. Remedy: report the policy as the blocker and stop.

## Origin problems

- "Origin not granted" on a narrowing list means the origin needs a session grant from the prompt or a managed/configured allowlist entry.
- Redirects to another origin fail closed and re-prompt; the new origin is a separate grant.
- Navigation failures report fixed categories (timeout, network, missing page). Remedy: inspect `list_pages`, never a blind retry.

## Read and interact grants

- Reads need one grant per origin per session (cap 8), or a saved read approval. `wait_for` needs both read and interact grants.
- Three refusals or binding failures in one turn stop T2 actions until the next turn. Remedy: stop acting and report the refusals.
- A stale uid after a URL change or re-render needs a fresh `take_snapshot`; never reuse element ids across renders.
- A dialog blocks snapshots until `handle_dialog` answers it. Remedy: handle the dialog first, then refresh the snapshot.

## Output bounds

- A snapshot or listing over 32 KiB is rejected. Remedy: narrow with `verbose: false`, `types`, `pageSize`, or `resourceTypes`.
- "Screenshot exceeded the inline budget" means the upstream auto-save path was refused. Remedy: crop with a uid, or use jpeg with lower quality.

## Saved approvals

- Approvals live at `~/.local/share/ax-code/webmcp-approvals.json` (XDG overrides apply) and are bound to the bridge identity; a changed launch or profile needs fresh approval.
- Remedy: manage entries with `/webmcp-allowlist`, or open `/mcp`, select the bridge, and press Ctrl+G.

## Auto and Sandbox

- With Auto and Sandbox on, ordinary browsing runs without Allow once, but typing, keys, dialogs, links, consequential clicks, closing pages and page-tool invocations still ask.
- With Sandbox off those operations are admitted; origin-list expansion and explicitly interactive requests always ask in every mode.
- Remedy: when a prompt keeps appearing, check the Auto/Sandbox mode before assuming a failure.

## Logins

- The isolated profile has no cookies. The user signs in manually in the visible AX browser window; headless launches cannot be signed into.
- Never type credentials through the bridge. Remedy: ask the user to sign in by hand in the AX browser window.

## Desktop embedded mode

- In AX Coder only `desktop_webmcp` exists; the user opens pages in the project browser pane, and the tool only lists and invokes page tools.
- An empty catalog on an ordinary site is normal: that page registered no tools. Remedy: report it and use `webfetch` for public content.

## What to report

- Report the failing step, the exact error category, which section above applies, and the remedy.
- Write BLOCKED when policy or a missing capability is the cause.
- Do not retry a denied or uncertain operation.
