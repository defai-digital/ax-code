# Lifecycle Hooks

Status: Active  
Scope: current-state  
Last reviewed: 2026-08-23
Owner: ax-code runtime

Lifecycle hooks let you run shell commands on agent events without rebuilding the runtime. They complement permission rules and the isolation sandbox: **hooks are deterministic side effects** (“always format”, “never force-push”), while prompts remain advisory.

## Events

| Event                  | When                                                                                                                                                                                                                 | Can block?                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **PreToolUse**         | Before a tool executes                                                                                                                                                                                               | Yes (`blockOnFailure: true`) |
| **PostToolUse**        | After a tool completes (`args`: the tool arguments). Bounded stdout / structured feedback is appended to the tool result the model sees; see below                                                                   | No                           |
| **PostToolUseFailure** | After a tool throws (`args`: `{ args, error }`, error text capped at 4,000 characters). Fire-and-forget; the error still reaches the model unchanged                                                                 | No                           |
| **Stop**               | When a session turn completes (packs may run on stop via automation)                                                                                                                                                 | No                           |
| **UserPromptSubmit**   | When a user prompt is submitted, before the message is persisted                                                                                                                                                     | Yes (`blockOnFailure: true`) |
| **PreCompact**         | Before session compaction runs (`args`: `{ auto, overflow }`)                                                                                                                                                        | No                           |
| **SubagentStop**       | When a `task` subagent finishes (`args`: `{ agent, status }`)                                                                                                                                                        | No                           |
| **SessionStart**       | When a top-level session is created (`args`: `{ sessionID, title, time }`)                                                                                                                                           | No                           |
| **SessionEnd**         | When a session is removed or archived (`args`: `{ sessionID, reason }`, `reason` is `"remove"` or `"archive"`)                                                                                                       | No                           |
| **PostCompact**        | After a session compaction completes successfully (`args`: `{ sessionID, reason }`, `reason` is `"auto"` or `"manual"`; not fired when compaction bails, e.g. on context overflow)                                   | No                           |
| **Interrupt**          | When a user or operator explicitly cancels a running turn (`args`: `{ sessionID }`; not fired on normal turn completion or internal cleanup)                                                                         | No                           |
| **PermissionRequest**  | When a permission prompt is raised (`args`: `{ sessionID, permission, patterns, riskClass?, interactiveOnly? }`; the permission name matches `matcher`; tool arguments are never included)                           | No                           |
| **StopFailure**        | When a turn ends in a provider or runtime error (`args`: `{ sessionID, errorName, errorCode? }`; name and code only, the failure message is not sent)                                                                | No                           |
| **Notification**       | When the runtime raises a user-facing notification: the session went idle after a turn (`kind: "idle_prompt"`), a question was asked (`kind: "question"`), or a background task finished (`kind: "background_task"`) | No                           |

The four session lifecycle events (`SessionStart`, `SessionEnd`, `PostCompact`, `Interrupt`), `PostToolUseFailure`, and the `PermissionRequest`, `StopFailure` and `Notification` events (ADR-212) are observation-only: they fire and forget, never block the lifecycle path, and their payloads carry ids/reasons/timestamps only — never conversation text, summaries, or tool output. `PermissionRequest` carries the tool name, patterns and risk class but never tool arguments; `StopFailure` carries the error name and code but not the message; payload strings are redacted at the same boundary as logs. Subagent sessions do not fire `SessionStart` (they already surface via `SubagentStop`). `SubagentStop` fires for children started by both `task` and `task_parallel`.

## PostToolUse feedback reaches the model

A `PostToolUse` hook can hand text back to the model. It is appended to the tool result inside a
`<hook_feedback event="PostToolUse">` block, after the tool's own output; it never replaces the output and never blocks.

- Legacy entries (no `protocol`): trimmed stdout of a hook that exited 0.
- `protocol: "claude-code"` entries: `hookSpecificOutput.additionalContext`, the `reason` of a
  `{"decision": "block", "reason": "..."}` verdict, or stderr when the hook exits 2. Other non-zero exits contribute nothing.

Feedback is capped at 4,000 characters per hook and 8,000 characters per tool call, so a noisy hook cannot flood the
context. This is what makes the `format-after-edit` pack useful: its reminder now lands in the model's next turn instead
of only in the log.

These names map to AX Code’s internal plugin triggers (`tool.execute.before` / `tool.execute.after`) plus session-level prompt, compaction, subagent, and stop hooks. Synthetic continuation prompts (internal `agentRouting: "preserve"` prompts) do not fire `UserPromptSubmit`.

## Enable packs

Project hooks and plugins execute repository-controlled code, so `.ax-code/hooks.json`, `.ax-code/plugin/`, and project-configured plugins are disabled by default. After reviewing them, opt in outside the repository when starting AX Code:

```bash
AX_CODE_TRUST_PROJECT_CONFIG=1 ax-code
```

Then create `.ax-code/hooks.json` in your project:

```json
{
  "packs": ["format-after-edit", "block-force-push", "require-tests-on-stop", "protect-env-files", "log-bash-commands"]
}
```

## Official packs (≥5)

| Pack                    | Events      | Description                             |
| ----------------------- | ----------- | --------------------------------------- |
| `format-after-edit`     | PostToolUse | Reminds the agent to format after edits |
| `block-force-push`      | PreToolUse  | Blocks `git push --force` / `-f`        |
| `require-tests-on-stop` | Stop        | Reminds to verify after mutations       |
| `protect-env-files`     | PreToolUse  | Warns when tools touch `.env`           |
| `log-bash-commands`     | PreToolUse  | Logs bash commands for audit            |

Custom hooks:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "bash",
      "command": "echo running bash",
      "blockOnFailure": false
    }
  ]
}
```

## Claude Code wire protocol (opt-in)

If you already have hooks written for Claude Code, an entry can opt into the
Claude Code wire protocol with `"protocol": "claude-code"`:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "bash",
      "command": "my-claude-code-hook.sh",
      "protocol": "claude-code"
    }
  ]
}
```

For the blockable events (`PreToolUse`, `UserPromptSubmit`), opted-in entries
are decoded with Claude Code semantics **instead of** the `blockOnFailure`
check:

- **Exit 2** blocks the action; the hook's stderr is surfaced as the reason.
  Malformed stdout still blocks (fail-safe).
- **Exit 0** with stdout JSON `{"permissionDecision": "allow"|"deny"|"ask", "reason"?}`:
  `allow` proceeds; `deny` blocks with `reason`; `ask` pauses the tool call on an
  interactive `hook` permission prompt that shows the reason (default
  `"hook requested user confirmation"`). The prompt is interactive-only: no
  `always` rule, wildcard grant, or autonomous auto-approval can answer it, and a
  headless run rejects it, which the model sees as an ordinary permission
  rejection. A later hook that answers `deny` wins over an earlier `ask`.
  `UserPromptSubmit` has no tool call to attach a prompt to, so `ask` still
  blocks there. The nested Claude Code shape
  `{"hookSpecificOutput": {"permissionDecision": "...", "permissionDecisionReason": "..."}}`
  is accepted as an alias.
- **Any other exit** is a non-blocking error (logged, action proceeds).

Observation-only events ignore the decoder entirely — they can never block.
Entries without the `protocol` field behave exactly as before.

Environment variables available to hook commands:

- `HOOK_EVENT` — PreToolUse | PostToolUse | PostToolUseFailure | Stop | UserPromptSubmit | PreCompact | SubagentStop | SessionStart | SessionEnd | PostCompact | Interrupt | PermissionRequest | StopFailure | Notification
- `HOOK_TOOL` — tool id
- `HOOK_SESSION_ID`
- `HOOK_ARGS_JSON` — JSON tool arguments
- `HOOK_ARGS_STDIN=1` — the complete JSON arguments are always available on stdin; `HOOK_ARGS_JSON` is empty for payloads larger than 32 KiB
- `HOOK_PACK` — pack name when applicable

Hook child processes inherit a sanitized version of the AX Code environment. AX Code preserves ordinary platform and
tooling variables, but removes secret-like names, credential-bearing URLs, credential helpers such as `SSH_AUTH_SOCK`,
and process-injection variables such as `NODE_OPTIONS`. The `HOOK_*` protocol variables above are added after
sanitization and are always available.

Fully trusted legacy hooks that require ambient credentials can restore the previous behavior outside the repository:

```bash
AX_CODE_HOOKS_FULL_ENV=1 AX_CODE_TRUST_PROJECT_CONFIG=1 ax-code
```

This escape hatch exposes every environment variable to every enabled hook. A repository cannot request it through
`.ax-code/hooks.json`; use it only after reviewing all hooks and packs.

> **Security note:** environment sanitization reduces ambient credential exposure but does not sandbox hook commands.
> Hooks remain arbitrary shell code that can read accessible files and use the host network. Treat them as trusted code
> and review every enabled hook and pack.

## Inspecting hooks from a client

The server exposes the hooks in effect without running them. `GET /hooks?directory=<path>` (SDK: `hooks.get`)
returns whether project config is trusted, whether `.ax-code/hooks.json` exists and parses, the effective hook
entries in run order (pack hooks first, then project hooks), and every built-in pack with its enabled state. When
`AX_CODE_TRUST_PROJECT_CONFIG` is not set, a valid file is reported but none of its hooks are listed as active.

Each executed hook entry also publishes a `hook.completed` event with the event name, tool, command, source, pack,
exit code, duration and an outcome of `ok`, `failed`, `blocked`, `ask` or `rewritten`. A block or ask carries the same bounded
reason the model sees. Hook stdout, stderr and tool arguments are never included.

## Relationship to isolation

Hooks do **not** replace the sandbox. Use:

1. **App isolation** for portable write/network boundaries
2. **OS isolation** (the default `"auto"` backend) for kernel-enforced bash sandboxing when available
3. **Hooks** for policy side-effects and hard blocks like force-push

See [Sandbox Mode](sandbox.md) and [SECURITY.md](../../SECURITY.md).

## Rewriting tool input

A trusted `PreToolUse` hook with `"protocol": "claude-code"` may return an exit-0
JSON object with `updatedInput`, either at the top level or inside
`hookSpecificOutput`. The top-level object takes precedence. Other types are
ignored without discarding a sibling deny or ask decision.

```json
{ "hookSpecificOutput": { "updatedInput": { "command": "pwd", "description": "Show the working directory" } } }
```

Each accepted object replaces the complete arguments; it is not a partial merge.
Hooks run in order and subsequent hooks see the latest accepted arguments. At
most three rewrites are accepted per call; additional rewrites are ignored and
logged. Any deny/block discards the rewrites and stops execution. Observation
events, legacy hooks, and unsuccessful hooks cannot rewrite input. An `ask`
still requires interactive hook confirmation, even when it also rewrites input.

Native and MCP tools validate the final replacement before execution. Validation
failure names the hook and fails the call without falling back to the original
arguments. Permissions, WebMCP bindings, and isolation operate on the replacement.
Composite `browser_workflow` plans and `tool_search` discovery arguments do not
accept rewrites; individual MCP calls within a workflow use the ordinary tool
boundary. Calls that may be rewritten use conservative concurrency classification.

Project hooks still require the existing project-config trust opt-in. Set
`hooks.allow_input_rewrite` to `false` to disable rewriting. A managed config can
force this off; user/project settings and later managed files cannot re-enable it.
The default permits rewrites from hooks already admitted by the trust policy.

The tool part stores `hookRewrite: { hooks, before, after }`. `hooks` contains
command basenames only; `before` and `after` are redacted JSON text, each capped at
4 KiB with a truncation marker. The tool card shows "rewritten by hook" and stays
visible with tool details hidden. A hook that supplies an accepted replacement
publishes `hook.completed` with outcome `rewritten`; a later deny may still stop
the call. Events never include argument values.

See [Project auto-accept](project-auto-accept.md) for the separate opt-in approval mode.
Hook confirmations remain interactive even when that mode is enabled.
