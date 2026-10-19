# Herdr State Reporting

Status: Active  
Scope: current-state  
Last reviewed: 2026-10-16
Owner: ax-code runtime

[Herdr](https://herdr.sh) is a terminal pane manager that shows whether each agent pane is **idle**, **working**, or **blocked**. AX Code does not talk to herdr directly. Instead, a small observation-only reporter script maps AX Code's lifecycle hooks (ADR-259) onto herdr's agent state, so herdr can show the right state without AX Code injecting keys into any pane.

## What it does

`script/herdr-report.mjs` reads one hook payload from stdin (or `HOOK_ARGS_JSON`) and, only when `HERDR_ENV=1` and the `herdr` binary is on `PATH`, runs:

```
herdr pane report-agent --state <idle|working|blocked>
```

It is **observation-only**:

- it never injects keys or text into any pane;
- it prints nothing and exits quietly on any failure (missing binary, non-zero exit, bad JSON);
- it does nothing at all unless `HERDR_ENV=1`, so the hook is a no-op on machines without herdr.

## State mapping

| AX Code hook event  | Payload cue               | herdr state |
| ------------------- | ------------------------- | ----------- |
| `Notification`      | `kind: "idle_prompt"`     | `idle`      |
| `Notification`      | `kind: "question"`        | `blocked`   |
| `Notification`      | `kind: "background_task"` | `working`   |
| `PermissionRequest` | —                         | `blocked`   |
| `StopFailure`       | —                         | `idle`      |
| `Stop` (turn end)   | —                         | `idle`      |
| `UserPromptSubmit`  | —                         | `working`   |

Events with no mapping (for example `PreToolUse`) produce no report.

## Hook configuration

Add the reporter to the project or user hook configuration. The entry is observation-only, so it must not set `blockOnFailure`:

```jsonc
{
  "hooks": [
    { "event": "Notification", "command": "node script/herdr-report.mjs" },
    { "event": "PermissionRequest", "command": "node script/herdr-report.mjs" },
    { "event": "StopFailure", "command": "node script/herdr-report.mjs" },
    { "event": "Stop", "command": "node script/herdr-report.mjs" },
    { "event": "UserPromptSubmit", "command": "node script/herdr-report.mjs" },
  ],
}
```

The hook runner passes the payload through `HOOK_ARGS_JSON`; the reporter also reads stdin, so the same script works whichever channel carries the payload. To enable reporting, herdr must start the pane with `HERDR_ENV=1` in the environment:

```sh
HERDR_ENV=1 ax-code
```

## Notes

- The reporter only observes; it never changes session state or the transcript.
- `PermissionRequest`, `StopFailure`, and `Notification` are observation-only events, so a slow or broken reporter can never affect a turn.
- The mapping is covered by `script/herdr-report.test.ts` (run with `pnpm run test:scripts`).
