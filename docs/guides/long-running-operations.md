# Operating AX Code for Long-Running Work

Status: Active
Scope: current-state
Last reviewed: 2026-09-13
Owner: AX Code maintainers

AX Code bounds one interactive Super-Long run at 72 hours. For operation over
days or weeks, run a supervised `ax-code serve` process and divide the work
into durable scheduled occurrences. The supervisor restarts the server; the
project database preserves schedules and queue state.

## Persistent interactive workspace

For local work that should continue after closing the terminal, opt into a
project runtime:

```bash
ax-code runtime start --dir /absolute/path/project
ax-code runtime attach --dir /absolute/path/project --continue
ax-code runtime status --dir /absolute/path/project
ax-code runtime stop --dir /absolute/path/project
```

`runtime attach` also starts the runtime when none exists. The runtime is keyed
by the canonical project directory; concurrent starts reuse one process.
The TUI shows its execution host and a **Disconnect** action. Disconnecting
closes the client and keeps accepted work running. `runtime stop` shuts down
that project's runtime and interrupts its active work. Ordinary `ax-code`
retains its existing foreground lifecycle.

Accepted follow-ups submitted while a session is busy are saved on the server.
The composer clears only after acknowledgement. Reattach to the same session
and use `/queue` to inspect, pause, edit, resume, or cancel them. Editing first
pauses the item and preserves attachments and model selection; saving does not
resume it. Concurrent stale edits are rejected. In `/queue`, `Ctrl+R` includes
completed and cancelled history. Narrow terminals also show a clickable
`Follow-ups` heading. A disconnected view is cached and cannot change items.
Interrupting the active turn pauses pending follow-ups so they do not immediately
start another turn. Resume them explicitly when ready.

After a backend restart, accepted waiting follow-ups can resume. An ordinary
in-flight prompt interrupted by that restart is marked failed and requires
inspection before retry; restoring queue records does not restore an executing
shell process. A lost acknowledgement can be retried from the unchanged composer
with the same request identity during that client session. Unsaved drafts are
not accepted jobs, and this does not guarantee exactly-once external effects.

This mode does not install a login service, automatically restart a crashed
server, or execute while the host is asleep or powered off. Start or attach
again after a crash; use the supervised service examples below for unattended
server restarts. SSH users should run the runtime on an awake remote host and
attach there. Do not expose the HTTP port publicly.

Runtime discovery stores a private capability and log under the AX Code state
directory's `runtime/` folder. Status output omits the capability. Shutdown
requires an authenticated matching runtime identity, not just a saved PID.
An unavailable live process, corrupt record, or version mismatch requires
inspection; the CLI refuses to kill an unverified process. Stop a healthy
runtime before upgrading and restart it with the new executable.

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

## Seeing what scheduled tasks are doing

Every scheduled-task occurrence is visible while it happens and auditable
afterwards:

- Starting, completing, failing, skipping, and persistent-failure auto-pauses
  each raise an in-app notification naming the task.
- The `/schedule` TUI command lists every task with its status, schedule, next
  run time, and last error, and opens its recent run history. From there you
  can pause, resume, run now, delete (press `ctrl+d` twice to confirm), and
  jump to the session a run produced. The agent's `list_scheduled_tasks` and
  `list_scheduled_task_runs` tools answer the same questions conversationally.
- Each run executes in a new session titled with the task title, so results are
  one session-list entry away even if a notification was missed.
- If a run asks for a permission or question answer while you are viewing a
  different conversation, a warning notice names the session that needs you;
  `/attention` lists known pending requests and opens the requesting session.
  Requests can be answered in that session or a loaded ancestor's view, including
  child and grandchild sessions. Opening a request never approves it automatically.
- A one-time task is disabled only after a successful run. A failed occurrence
  retries with a bounded backoff, and repeated failures pause the task with a
  notification — a reminder can no longer vanish silently.

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

## Navigating parallel sessions

At 146 terminal columns or wider, a left navigation sidebar shows sessions in
the current workspace and their loaded child agents. Expand a row with its
`+` control and click a title to open it. Pinned sessions keep their order and
shortcut numbers. Full activity labels distinguish working, retrying, approvals,
and questions; parents also reflect requests from descendants. These labels do not
mean a task passed verification. The existing right sidebar keeps the current
session's context and controls.

The Project heading identifies the current directory. Click it or use
`/navigation-info` to see the full project path and current session title.
Recent shows loaded sessions; Active keeps working or waiting session trees
and the current session tree. The filter is shared with the navigation picker
and remembered. Use `/navigation-filter` to toggle it from the keyboard. During
disconnection it shows cached sessions rather than inferring which sessions
are active.

Use `/navigation-width` or the navigation Width action to choose 24, 30, or 36
columns (default 30). The preference is remembered and shrinks automatically when needed
to preserve the main content. Use `/navigation` to hide or restore the left
navigation rail on wide terminals. `/sidebar` hides or restores the right
session sidebar the same way. On narrower terminals `/navigation` opens a session-and-agent
picker instead. A visible Sessions bar provides the same action whenever the
navigation rail is absent. Its Pending action appears when known requests need input;
an asterisk marks a cached count during disconnection. `/sessions`
continues to open the normal session picker. `/attention` is available at every
width. During disconnection, its list is labeled as cached; opening cached
entries is still possible, but requests may already have been answered elsewhere.
The sidebar's Known requests action opens pending requests across known
workspaces, while its session tree remains scoped to the current project.
All these views are bounded by the connected instance and loaded session data;
this count is not a complete inventory of other servers or unloaded workspaces.

Unsent drafts are isolated by project and session within the running TUI.
Switching sessions preserves text, attachments, cursor position and shell mode;
returning restores the matching draft. These drafts are memory-only and do not
survive closing the TUI.

The optional completion notification now says `Session idle`. It follows
observed work in the viewed session subtree and waits for observed active
descendants to become explicitly idle, with no pending requests. Disconnects,
resyncs, missing state, errors and cancellation can suppress the notice. It is
a lifecycle notification, not evidence that tests passed or a goal completed.

## New tasks and setup

Normal startup opens the New task work surface with a bottom composer and
session navigation. Opening it or typing a draft does not create a saved
session; a session is created when you submit. Use `/sessions` or the left
navigation to resume existing work. Explicit `--session`, `--continue` and
`--prompt` behavior remains available; startup does not enable auto-resume.

Provider setup does not open automatically. Use the visible `/connect` action
in the work area when no provider is configured. With a provider configured
but no valid model selected,
the action changes to `/models`. Failed provider discovery points to `/status`;
`/connect` and `/providers` remain available to repair configuration. A selected
model is a configuration choice, not a credential or runtime readiness check.
The hints also appear for returning users whose configuration needs attention.
