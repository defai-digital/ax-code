# Lifecycle Hooks

Status: Active  
Scope: current-state  
Last reviewed: 2026-08-23
Owner: ax-code runtime

Lifecycle hooks let you run shell commands on agent events without rebuilding the runtime. They complement permission rules and the isolation sandbox: **hooks are deterministic side effects** (“always format”, “never force-push”), while prompts remain advisory.

## Events

| Event                | When                                                                                                                                                                               | Can block?                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **PreToolUse**       | Before a tool executes                                                                                                                                                             | Yes (`blockOnFailure: true`) |
| **PostToolUse**      | After a tool completes                                                                                                                                                             | No                           |
| **Stop**             | When a session turn completes (packs may run on stop via automation)                                                                                                               | No                           |
| **UserPromptSubmit** | When a user prompt is submitted, before the message is persisted                                                                                                                   | Yes (`blockOnFailure: true`) |
| **PreCompact**       | Before session compaction runs (`args`: `{ auto, overflow }`)                                                                                                                      | No                           |
| **SubagentStop**     | When a `task` subagent finishes (`args`: `{ agent, status }`)                                                                                                                      | No                           |
| **SessionStart**     | When a top-level session is created (`args`: `{ sessionID, title, time }`)                                                                                                         | No                           |
| **SessionEnd**       | When a session is removed or archived (`args`: `{ sessionID, reason }`, `reason` is `"remove"` or `"archive"`)                                                                     | No                           |
| **PostCompact**      | After a session compaction completes successfully (`args`: `{ sessionID, reason }`, `reason` is `"auto"` or `"manual"`; not fired when compaction bails, e.g. on context overflow) | No                           |
| **Interrupt**        | When a user or operator explicitly cancels a running turn (`args`: `{ sessionID }`; not fired on normal turn completion or internal cleanup)                                       | No                           |

The four session lifecycle events (`SessionStart`, `SessionEnd`, `PostCompact`, `Interrupt`) are observation-only: they fire and forget, never block the lifecycle path, and their payloads carry ids/reasons/timestamps only — never conversation text, summaries, or tool output. Subagent sessions do not fire `SessionStart` (they already surface via `SubagentStop`).

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
  `allow` proceeds; `deny` blocks with `reason`; `ask` currently also blocks
  fail-safe with the reason (default `"hook requested user confirmation"`)
  because the hook layer has no interactive permission prompt channel.
- **Any other exit** is a non-blocking error (logged, action proceeds).

Observation-only events ignore the decoder entirely — they can never block.
Entries without the `protocol` field behave exactly as before.

Environment variables available to hook commands:

- `HOOK_EVENT` — PreToolUse | PostToolUse | Stop | UserPromptSubmit | PreCompact | SubagentStop | SessionStart | SessionEnd | PostCompact | Interrupt
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

## Relationship to isolation

Hooks do **not** replace the sandbox. Use:

1. **App isolation** for portable write/network boundaries
2. **OS isolation** (the default `"auto"` backend) for kernel-enforced bash sandboxing when available
3. **Hooks** for policy side-effects and hard blocks like force-push

See [Sandbox Mode](sandbox.md) and [SECURITY.md](../../SECURITY.md).
