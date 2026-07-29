# Operating AX Code for Long-Running Work

Status: Active
Scope: current-state
Last reviewed: 2026-07-27
Owner: AX Code maintainers

AX Code bounds one interactive Super-Long run at 72 hours. For operation over
days or weeks, run a supervised `ax-code serve` process and divide the work
into durable scheduled occurrences. The supervisor restarts the server; the
project database preserves schedules and queue state.

## Reliability model

| Event                                                         | Behavior                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Backend exits before a due occurrence is committed            | The occurrence remains due                                                    |
| Backend exits after the schedule-to-queue transaction commits | The same queued item is resumed at bootstrap                                  |
| Backend exits after a prompt starts                           | The interrupted item is marked failed instead of being replayed automatically |
| Host misses several occurrences                               | `run_once` coalesces them into one run; `skip` advances without running       |
| A queue run exceeds its deadline                              | The executor cancels the session and records a failed queue item              |
| Supervisor sees the server exit                               | The examples below restart it after a short delay                             |

This is duplicate-safe recovery, not exactly-once delivery for arbitrary
external effects. Integrations that write to external systems should still use
their own idempotency keys.

## Before installing a service

1. Install and test the `ax-code` executable as the same user that will run the
   service.
2. Choose one absolute project path. Set it as `AX_CODE_PROJECT` so server
   startup prewarms that project and starts its scheduler.
3. Keep the server on `127.0.0.1`; AX Code's server is local-only.
4. Put provider credentials in the supervisor's protected environment rather
   than in a committed service file.
5. Replace every `/absolute/path/...` placeholder in the selected example.

The examples use a fixed port so Desktop or SDK clients can reconnect:

```bash
ax-code serve --hostname=127.0.0.1 --port=4096
```

## systemd user service

Copy [the systemd example](../examples/ax-code.service) to
`~/.config/systemd/user/ax-code.service`, replace its absolute paths, and
optionally put credentials in `~/.config/ax-code/server.env`.

```bash
chmod 600 ~/.config/ax-code/server.env
systemctl --user daemon-reload
systemctl --user enable --now ax-code.service
systemctl --user status ax-code.service
journalctl --user -u ax-code.service -f
```

Use `loginctl enable-linger "$USER"` only if your operating policy permits the
user service to run while the user is logged out.

## launchd agent

Copy [the launchd example](../examples/com.axcode.server.plist) to
`~/Library/LaunchAgents/com.axcode.server.plist`, replace its absolute paths,
then validate and load it:

```bash
plutil -lint ~/Library/LaunchAgents/com.axcode.server.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.axcode.server.plist
launchctl kickstart -k "gui/$(id -u)/com.axcode.server"
```

`launchd` does not expand shell variables in `ProgramArguments`. Use absolute
paths and supply needed credentials through an operator-managed mechanism.

## PM2

Copy [the PM2 example](../examples/ax-code-ecosystem.config.cjs), replace its
paths, and start it:

```bash
pm2 start docs/examples/ax-code-ecosystem.config.cjs
pm2 save
pm2 logs ax-code-server
```

Follow PM2's platform-specific startup instructions if the process must return
after a host reboot.

## Deadlines, catch-up, and recovery

Scheduled tasks default to `catchUpPolicy: "run_once"`. After downtime, AX Code
runs one coalesced occurrence rather than creating an unbounded backlog.
Choose `"skip"` when late work would be misleading or unsafe.

Each scheduled task can set `maxRunDurationMs` from 1 second through 72 hours.
Task-queue execution otherwise uses the 72-hour ceiling. Active items update a
heartbeat timestamp every 30 seconds, and terminal status and error details
remain in the project database.

Async prompt, command, and shell endpoints return the durable queue item in
their HTTP 202 response. Clients should retain its `id` and poll
`GET /task-queue/:id` until `completed`, `failed`, or `cancelled`; acceptance
alone is not completion.

On startup, AX Code resumes scheduled queue items and explicitly marked async
items that were committed but had not started. Already-started prompt work is
failed with a restart explanation so an operator can inspect side effects
before retrying.

## Operational checks

- Watch the supervisor's restart count and server logs.
- Inspect failed task-queue items and scheduled-task errors before retrying.
- Confirm enough disk space for the project SQLite database and logs.
- Exercise a manual **run now** after changing credentials, models, or service
  paths.
- Stop through the supervisor so AX Code receives `SIGTERM`; the examples allow
  up to 90 seconds for graceful shutdown.

`/loop` is intentionally process-local and does not survive a restart. Use
scheduled tasks for durable unattended work.
