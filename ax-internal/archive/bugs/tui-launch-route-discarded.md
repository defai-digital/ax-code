# TUI launch route (--session/--prompt) is resolved then discarded

Classification: confirmed

## Summary

In `crates/ax-code-tui/src/runner.rs`, the session-first launch route is computed
via `launch_policy::resolve_launch_route(&launch_input)` but the result is bound to
`let _route = ...` (underscore prefix = intentionally unused) and never acted upon.
As a result `--session <id>` does not attach to an existing session and
`--prompt <text>` is not sent on startup. Commit `b11343df` ("fix: wire CLI
--session/--prompt args to launch policy") plumbed the CLI flags into `ClientConfig`
and `LaunchInput`, but stopped short of consuming the resolved `LaunchRoute`, so the
commit's stated goal ("making these flags completely non-functional" -> implying they
are now functional) is not actually achieved at runtime.

## Evidence

- `crates/ax-code-tui/src/runner.rs:116`
  `let _route = launch_policy::resolve_launch_route(&launch_input);`
  The binding is prefixed with `_` and has no later use. Confirmed by grep: the only
  occurrence of `resolve_launch_route` / `_route` in runner.rs.
- `crates/ax-code-tui/src/runner.rs:112`
  `recent_session_ids: Vec::new(), // TODO: fetch from server`
  Auto-resume (priority 3 of the launch policy) can never fire because recent
  sessions are never fetched, so even if `_route` were consumed, only explicit
  `--session`/`--prompt` could produce a non-fallback route today.
- `client.send_prompt(...)` is only invoked from the interactive `SubmitPrompt`
  action handler (runner.rs:186), never from the resolved launch route.
- `cargo test -p ax-code-tui`: 214 passed, 0 failed (launch-policy unit tests pass,
  but they only assert the resolver, not that the runner consumes the route).
- `cargo clippy -p ax-code-tui --all-targets -- -D warnings`: clean (clippy does not
  flag `_route` because the underscore prefix silences the unused-binding lint).

## Impact

- `--session <id>` / `--prompt <text>` CLI flags appear to work (parsed, validated
  by tests) but have no runtime effect. The TUI always lands on a new empty session
  regardless of the flags.
- Auto-resume of the most recent session (ADR-035 session-first goal) is inert.

## Suggested Fix

In `Runner::run()`, after resolving the route, branch on it:
- `LaunchRoute::Session { session_id }` -> call the server attach/subscribe path for
  that session (and surface it in `app.session_id` / header).
- `LaunchRoute::NewSession { prompt }` -> if `prompt` is `Some`, send it via
  `client.send_prompt(...)` after the session is created.

Additionally, populate `recent_session_ids` from the server (the `// TODO: fetch from
server` site) before resolving the route, so auto-resume can work.

Rename `_route` to `route` once consumed so a future unused-binding is caught.

## Notes

- Separately confirmed (low severity): `eventsource-stream = "0.2"` in
  `crates/ax-code-tui/Cargo.toml` is a dead dependency after the SSE refactor moved
  parsing to manual `bytes_stream()` + `drain_complete_sse_lines` in client.rs. It is
  not imported anywhere in `src/`. Safe to remove from Cargo.toml.
- Minor: doc-comment typo "triggereded" in `src/diagnostics.rs`
  (`WorkflowDashboardFetchOnDemand` variant doc).

## Closure

Disposition: **resolved (already fixed before re-check)** — verified 2026-06-22.

On re-inspection of the current tree, every item in this report is already fixed; this
was an index-staleness issue, not a live bug.

- **Primary** (`_route` resolved then discarded): fixed. `crates/ax-code-tui/src/runner.rs:181`
  now binds `let route = resolve_runner_launch_route(&launch_input, legacy_home_requested);`
  and lines 187–221 consume it — `LaunchRoute::Session` loads the transcript and sets
  `app.session_id`; `LaunchRoute::NewSession { prompt }` creates a session and sends the
  initial prompt via `client.send_prompt(...)`. Landed in `872678b17` ("Honor Ratatui
  legacy home rollback").
- **Auto-resume inert** (`recent_session_ids: Vec::new() // TODO`): fixed. `runner.rs:158-170`
  populates `recent_session_ids` from `client.list_recent_session_ids().await`. Landed in
  `3f7c13cec` ("Wire Ratatui recent session auto resume").
- **Dead dependency** (`eventsource-stream = "0.2"`): fixed. Absent from
  `crates/ax-code-tui/Cargo.toml`.
- **Typo** ("triggereded"): fixed. `crates/ax-code-tui/src/diagnostics.rs:35` reads
  "Workflow dashboard fetch triggered on demand."

Regression coverage: `cargo test -p ax-code-tui` — 62 unit + acceptance tests pass,
including `acceptance_runner_route_auto_resumes_recent_session` and
`acceptance_rollback_skips_session_first_runner_route`, which assert the runner consumes
the resolved route. No source change was required in this session.
